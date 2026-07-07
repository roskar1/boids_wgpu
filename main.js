// main.js

// Top-level mandated imports
import { VERTEX_SHADER_CODE } from './gpu/vertexShader.wgsl.js?v=2';
import { COMPUTE_SHADER_CODE } from './gpu/computeShader.wgsl.js';


// Rolling average implemented as a fixed-size array circular buffer
class NonNegativeRollingAverage {
	// # hashtag is private class field
	#total = 0;
	#samples = [];
	#cursor = 0;
	#numSamples;
	constructor(numSamples = 30) {
		this.#numSamples = numSamples;
	}

	addSample(v) {
		if (!Number.isNaN(v) && Number.isFinite(v) && v >= 0) {
			this.#total += v - (this.#samples[this.#cursor] || 0);
			this.#samples[this.#cursor] = v;
			this.#cursor = (this.#cursor + 1) % this.#numSamples;
		}
	}

	get() {
		return this.#total / this.#samples.length;
	}
}










// New refactor: wrap everything in async main
async function main() {

	
	//-------------------------------------------------------------------------
	// WebGPU Setup
	//-------------------------------------------------------------------------

	// document and window are two notable namespaces
	const canvas = document.querySelector('#myCanvas');
	
	// Ensure browser can support WebGPU before proceeding
	if (!navigator.gpu) {
		throw new Error("WebGPU not supported on this browser.");
	}

	// The adapter is used to build the device object
	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) {
		throw new Error("No appropriate GPUAdapter found.");
	}

	// Ensure the adapter has time features to track GPU time
	const canTimestamp = adapter.features.has('timestamp-query');
	const device = await adapter.requestDevice({
		requiredFeatures: [
			...(canTimestamp ? ['timestamp-query'] : []),
		],
	});

	// The context is used for anti-aliasing
	const context = canvas.getContext("webgpu");

	// The canvas format is used in fragment shader and canvas configuration
	const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
	context.configure({ device: device, format: canvasFormat });
		
	// Canvas resize listener
	resizeCanvas(); // Initially resize canvas
	window.addEventListener('resize', resizeCanvas);
	
	// Mouse move listener
	const screenLog = document.querySelector("#screen-log");
	document.addEventListener("mousemove", onMouseMove);

	// Mouse zoom listener
	const screenLogZoom = document.querySelector("#screen-log-zoom");
	canvas.onwheel = zoom;

	// Mouse pan listener
	document.addEventListener("mousedown", onMouseDown);
	document.addEventListener("mouseup", onMouseUp);


	//-----------------------------------------------------------------------------
	// Global Variable Setup
	//-----------------------------------------------------------------------------

	// Simulation globals
	const kNumObjects = 3000000; //2100000
	const WORKGROUP_SIZE = 256;

	// Mouse position globals
	let fMouseX = 0;
	let fMouseY = 0;
	let GPUX = 0;
	let GPUY = 0;
	let worldX = 0;
	let worldY = 0;

	// Mouse pan globals
	let fStartPanX = 0;
	let fStartPanY = 0;
	let fOffsetX = 0;
	let fOffsetY = 0;

	// Mouse zoom globals
	let scale = 1;
	let fMouseBeforeZoomX = 0;
	let fMouseBeforeZoomY = 0;
	let fMouseAfterZoomX = 0;
	let fMouseAfterZoomY = 0;

	// Variable globals
	const uintMax = 4294967295; // 32 bit int max
	const sintMax = 2147483647;
	const sintMin = -2147483648;

	// Flags
	let MOUSE_DOWN = false;

	// Rendering text	
	let bootstrapTime;

	//-------------------------------------------------------------------------
	// Useful Functions
	//-------------------------------------------------------------------------

	// Performance Menu Function Attributes:
	// Graphics card: 
	// Window resolution: xxx x xxx (1.4 mill pixels)
	// bootstrap: xxx (us)
	// render: xxx (ms)
	// compute: xxx (ms)

	const gpuAverage = new NonNegativeRollingAverage();
	const computeAverage = new NonNegativeRollingAverage();
	const vertexAverage = new NonNegativeRollingAverage();



	// gputime variable is returned in nanoseconds. Dived by 1000 to get
	// microseconds, and 10000 for miliseconds
	function renderScreenText() {
		screenLog.innerText = 
		`gpu ${canTimestamp ? `${gpuAverage.get().toFixed(1)} ms (${(1 / (gpuAverage.get() / 1000)).toFixed(0)} fps)` : 'N/A'} 
		\t update\t ${canTimestamp ? `${computeAverage.get().toFixed(1)} ms` : 'N/A'} 
		\t render\t ${canTimestamp ? `${vertexAverage.get().toFixed(1)} ms` : 'N/A'} 
		`;
	}
	// map mouse to [0, 2]
	function canvasToGPUX_Absolute(x) {
		return ((x / canvas.width) * 2) / scale;
	}
	
	function canvasToGPUY_Absolute(y) {
		return ((y / canvas.height) * 2) / scale;
	}

	// map mouse to [-1, 1]
	function canvasToGPUX(x) {
		return (((x / canvas.width) * 2) - 1) / scale;
	}

	function canvasToGPUY(y) {
		return (((y / canvas.height) * 2) - 1) / scale;
	}		
	
	function onMouseMove(e) {
		fMouseX = e.clientX;
		fMouseY = e.clientY;
	
		// This is screen to world
		worldX = Math.round(uintMax * (e.clientX / canvas.width) - sintMax);
		worldY = Math.round(uintMax * (e.clientY / canvas.height) - sintMax);
	
		sceneUniforms[0] = GPUX;
		sceneUniforms[1] = GPUY;
	}
	
	function zoom(e) {
		// Capture mouse before zoom
		fMouseBeforeZoomX = canvasToGPUX(fMouseX);
		fMouseBeforeZoomY = canvasToGPUY(fMouseY);
	
		// Update and pass scale into shader
		e.preventDefault(); // Prevents traditional scroll
		scale += e.deltaY * (-0.0001 * scale);
	
		// Restrict Scale
		scale = Math.min(Math.max(0.1, scale), 256);
		sceneUniforms[2] = scale;
	
		// Capture mouse after zoom
		fMouseAfterZoomX = canvasToGPUX(fMouseX);
		fMouseAfterZoomY = canvasToGPUY(fMouseY);
	
		// Update offsets
		fOffsetX -= fMouseBeforeZoomX - fMouseAfterZoomX;
		fOffsetY += fMouseBeforeZoomY - fMouseAfterZoomY;
	
		sceneUniforms[3] = fOffsetX;
		sceneUniforms[4] = fOffsetY;
	
		// Upload data to buffer
		//device.queue.writeBuffer(uniformBuffer, 0, sceneUniforms);
	}

	function pan() {
		// Compute new offset
		fOffsetX += canvasToGPUX_Absolute(fMouseX - fStartPanX);
		fOffsetY -= canvasToGPUY_Absolute(fMouseY - fStartPanY);
		
		sceneUniforms[3] = fOffsetX;
		sceneUniforms[4] = fOffsetY;
	
		// Update start pan for next frame
		fStartPanX = fMouseX;
		fStartPanY = fMouseY;
	}
	
	function updateSceneUniforms() {
		device.queue.writeBuffer(uniformBuffer, 0, sceneUniforms);
	}
	
	function onMouseDown(e) {
		// This function is only called once at the start of a pan event
			// Initialize start pan to be used in pan function
		fStartPanX = fMouseX;
		fStartPanY = fMouseY;	
		MOUSE_DOWN = true;
	}
	
	function onMouseUp(e) {
		MOUSE_DOWN = false;
	}

	function resizeCanvas() {
		//if (!this.canvas) return; // ensures canvas exists before resizing
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
	}

	function rand(min = 0, max = 1) {
		return min + (Math.random() * (max - min));
	}

	//-------------------------------------------------------------------------
	// InitMisc
	//-------------------------------------------------------------------------

	//console.log("3. Initializing Miscellaneous variables...");

	//0: mouseX, 1: mouseY, 2: mouseZoom, 3: fOffsetX, 4: fOffsetY
	const sceneUniforms = new Float32Array(5);
	sceneUniforms[2] = scale;

	// This stores SceneUniforms
	const uniformBuffer = device.createBuffer({
		label: "Stores mouse position, scale and offsets",
		size: sceneUniforms.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});

	// Timestamp info
	// A technique known as object destructuring and Immediately Invoked 
	// Function Expression (IIFE)
	const { querySet, resolveBuffer, resultBuffer } = (() => {
		if (!canTimestamp) {
			return {};
		}

		// An array of query results
		const querySet = device.createQuerySet({
			type: 'timestamp',
			count: 4,
		});

		// Buffer to convert the querySet into accessible data
		const resolveBuffer = device.createBuffer({
			size: querySet.count * 8,
			usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
		});

		// Mappable buffer to read the results
		const resultBuffer = device.createBuffer({
			size: resolveBuffer.size,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});

		return { querySet, resolveBuffer, resultBuffer };
	})();

	//-------------------------------------------------------------------------
	// Init Vertex
	//-------------------------------------------------------------------------

	let vertexBindGroupLayout;
	let vertexBuffer;
	let vertexPipeline;
	

	// Layouts
	vertexBindGroupLayout = device.createBindGroupLayout({
		label: "Vertex Bind Group Layout New",
		entries: [{
			binding: 0, // Positions
			visibility: GPUShaderStage.VERTEX,
			buffer: { type: "read-only-storage" }
		}, {
			binding: 1, // Velocities
			visibility: GPUShaderStage.VERTEX,
			buffer: { type: "read-only-storage" }
		}, {
			binding: 2, // Mouse Details
			visibility: GPUShaderStage.VERTEX,
			buffer: {}
		}]
	});

	const vertexPipelineLayout = device.createPipelineLayout({
		label: "Vertex Pipeline Layout",
		bindGroupLayouts: [ vertexBindGroupLayout ],
	});

	// Vertex Buffer
	const vertices = new Float32Array([
		 0.0, -1.0,
		-0.5,  1.0,
		 0.5,  1.0,
	]);
	
	vertexBuffer = device.createBuffer({
		label: "Cell Vertices",
		size: vertices.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(vertexBuffer, 0, vertices); //location 0
	
	const vertexBufferLayout = {
		arrayStride: 8,
		attributes: [{
			format: "float32x2",
			offset: 0,
			shaderLocation: 0,
		}],
	};

	const vertexModule = device.createShaderModule({
		label: "Hardcoded Triangle Shader",
		code: VERTEX_SHADER_CODE
	});

	vertexPipeline = device.createRenderPipeline({
		label: "Vertex Pipeline",
		layout: vertexPipelineLayout,
		vertex: {
			module: vertexModule,
			entryPoint: "vertexMain",
			buffers: [vertexBufferLayout]
		},
		fragment: {
			module: vertexModule,
			entryPoint: "fragmentMain",
			targets: [{
				format: canvasFormat
			}],
		},
		multisample: {
			count: 4,
		},
	});

	

	//-------------------------------------------------------------------------
	// Init Compute
	//-------------------------------------------------------------------------

	let computeBindGroupLayout;
	let computePipelineLayout;
	let computePipeline;


	// Layouts
	computeBindGroupLayout = device.createBindGroupLayout({
		label: "Compute Bind Group Layout",
		entries: [{
			binding: 0, // input position
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "read-only-storage" }
		}, {
			binding: 1, // output position
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }
		}, {
			binding: 2, // input velocity
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "read-only-storage" }
		}, {
			binding: 3, // output velocity
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }
		}, {
			binding: 4, // Mouse GPU Pos
			visibility: GPUShaderStage.COMPUTE,
			buffer: {}
		}, {
			binding: 5, // Helper Buffer for cell data
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }
		}, {
			binding: 6, // Buffer for boid storage
			visibility: GPUShaderStage.COMPUTE,
			buffer: { type: "storage" }
		}]
	});

	computePipelineLayout = device.createPipelineLayout({
		label: "Compute Pipeline Layout",
		bindGroupLayouts: [ computeBindGroupLayout ],	
	});

	const computeModule = device.createShaderModule({
		label: "Compute Shader",
		code: COMPUTE_SHADER_CODE
	});

	computePipeline = device.createComputePipeline({
		label: "Compute Shader Pipeline",
		layout: computePipelineLayout,
		compute: {
			module: computeModule,
			entryPoint: "computeMain",
		},
	});

	//-------------------------------------------------------------------------
	// Init Data
	//-------------------------------------------------------------------------

	let vertexBindGroups;
	let computeBindGroups;

	
	// The size of each array is 2 * numBoids thus,
	const size = kNumObjects * 2; // 2 * 4

	// New Datatype
	const initialPositions = new Uint32Array(size);

	const positionStorageBuffers = [
		device.createBuffer({
			label: "Position Buffer A",
			size: initialPositions.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage. COPY_DST,
		}), 
		device.createBuffer({
			label: "Position Buffer B",
			size: initialPositions.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage. COPY_DST,
		})
	];

	for	(let i = 0; i < size; ++i) {
		initialPositions[i] = rand(0, uintMax);
	}
	
	device.queue.writeBuffer(positionStorageBuffers[0], 0, initialPositions);

	// Initialize Velocities
	const initialVelocities = new Float32Array(kNumObjects * 2);

	const velocityStorageBuffers = [
		device.createBuffer({
			label: "Velocity Buffer A",
			size: initialVelocities.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		}), 
		device.createBuffer({
			label: "Velocity Buffer B",
			size: initialVelocities.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		})
	];

	for (let i = 0; i < size; ++i) {
		// New Datatype velocities needs to be large considering the random generation
		initialVelocities[i] = rand(-100000, 100000);
	}

	device.queue.writeBuffer(velocityStorageBuffers[0], 0, initialVelocities);


	// Helper Buffers for compute stage
	const cellIndices = new Uint32Array(size);


	const cellIndicesHelperBuffer = device.createBuffer({
		label: "Helper Buffer to store cell indices for each boid",
		size: cellIndices.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
	});
		
	device.queue.writeBuffer(cellIndicesHelperBuffer, 0, cellIndices);

	// helper buffer for sorting the boids
	// contains vec4 of 32 bit items
	const cellContents = new Uint32Array(size * 2);

	const cellContentsHelperBuffer = device.createBuffer({
		label: "Helper Buffer to store cell contents for each cell",
		size: cellContents.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
	});

	device.queue.writeBuffer(cellContentsHelperBuffer, 0, cellContents);


	// Bind Groups
	computeBindGroups = [
		device.createBindGroup({
			label: "Compute bind group A",
			layout: computeBindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: positionStorageBuffers[0] }
			}, {
				binding: 1,
				resource: { buffer: positionStorageBuffers[1] }
			}, {
				binding: 2,
				resource: { buffer: velocityStorageBuffers[0] }
			}, {
				binding: 3,
				resource: { buffer: velocityStorageBuffers[1] }
			}, {
				binding: 4,
				resource: { buffer: uniformBuffer } 
			}, {
				binding: 5,
				resource: { buffer: cellIndicesHelperBuffer }
			}, {
				binding: 6,
				resource: { buffer: cellContentsHelperBuffer }
			}],
		}),
		device.createBindGroup({
			label: "Compute bind group B",
			layout: computeBindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: positionStorageBuffers[1] }
			}, {
				binding: 1,
				resource: { buffer: positionStorageBuffers[0] }
			}, {
				binding: 2,
				resource: { buffer: velocityStorageBuffers[1] }
			}, {
				binding: 3,
				resource: { buffer: velocityStorageBuffers[0] }
			}, {
				binding: 4,
				resource: { buffer: uniformBuffer }
			}, {
				binding: 5,
				resource: { buffer: cellIndicesHelperBuffer }
			}, {
				binding: 6,
				resource: { buffer: cellContentsHelperBuffer }
			}],
		}),
	];

	vertexBindGroups = [
		device.createBindGroup({
			label: "Vertex Bind Group A",
			layout: vertexBindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: positionStorageBuffers[0] }
			}, {
				binding: 1,
				resource: { buffer: velocityStorageBuffers[0] }
			}, {
				binding: 2,
				resource: { buffer: uniformBuffer }
			}],
		}), 
		device.createBindGroup({
			label: "Vertex Bind Group B", 
			layout: vertexBindGroupLayout,
			entries: [{
				binding: 0,
				resource: { buffer: positionStorageBuffers[1] }
			}, {
				binding: 1,
				resource: { buffer: velocityStorageBuffers[1] }
			}, {
				binding: 2,
				resource: { buffer: uniformBuffer }
			}],
		})
	];

	
	// If the feature exists, we'll add a timestampWrites section to the 
	// descriptor
	const renderPassDescriptor = {
		label: "Canvas renderPass",
		colorAttachments: [{
			clearValue: [0, 0, 0, 1],
			loadOp: "clear",
			storeOp: "store",
		}],
		...(canTimestamp && { // Conditional object property!
			timestampWrites: {
				querySet,
				beginningOfPassWriteIndex: 0,
				endOfPassWriteIndex: 1,
			},
		}),
	};

	const computePassDescriptor = {
		label: "Simulation Compute Pass",
		...(canTimestamp && {
			timestampWrites: {
				querySet,
				beginningOfPassWriteIndex: 2,
				endOfPassWriteIndex: 3,
			}
		}),
	};

	//-------------------------------------------------------------------------
	// Frame function
	//-------------------------------------------------------------------------


	let step = 0;
	let multisampleTexture;
	let then = 0;
	let gpuTime = 0;
	let computeTime = 0;
	let vertexTime = 0;

	// Combined Render and Compute
	// The reason we unified this is because submitting multiple command 
	// encoders is inefficient and can cause the vertex shader to operate on 
	// unprocessed data. 
	function frame(now) {


		// Compute
		const encoder = device.createCommandEncoder();
		const computePass = encoder.beginComputePass(computePassDescriptor);
		computePass.setPipeline(computePipeline);
		computePass.setBindGroup(0, computeBindGroups[step % 2]);
		const workgroupCount = Math.ceil(kNumObjects / WORKGROUP_SIZE);
		computePass.dispatchWorkgroups(workgroupCount);
		computePass.end();
	
		// Update buffer pointers
		step++;
	
		// Render
		// Anti-aliasing Stuff
		// Grab the current texture from the canvas
		const canvasTexture = context.getCurrentTexture();
	
		// If the multisample texture doesn't exist or is the wrong size, then make]
		// a new one
		if (!multisampleTexture ||
			multisampleTexture.width !== canvasTexture.width ||
			multisampleTexture.height !== canvasTexture.height) {
	
			// If we have an existing multisample texture, destroy it.
			if (multisampleTexture) {
				multisampleTexture.destroy();
			}
	
				// Create a new multisample texture that matches canvas size
				multisampleTexture = device.createTexture({
				format: canvasTexture.format,
				usage: GPUTextureUsage.RENDER_ATTACHMENT,
				size: [canvasTexture.width, canvasTexture.height],
				sampleCount: 4,
			});
		}

		renderPassDescriptor.colorAttachments[0].view = 
			multisampleTexture.createView();
	
		renderPassDescriptor.colorAttachments[0].resolveTarget = 
			canvasTexture.createView();
		const renderPass = encoder.beginRenderPass(renderPassDescriptor);
		renderPass.setPipeline(vertexPipeline);
		renderPass.setBindGroup(0, vertexBindGroups[step % 2]);
		renderPass.setVertexBuffer(0, vertexBuffer);
		renderPass.draw(3, kNumObjects);
	
		renderPass.end()

		// This takes the results of the query and puts them in the buffer
		if (canTimestamp) {
			// setQuerySetInput
			// 0: The querySet
			// 1: The first index of where to start resolving
			// 2: The number of entries to resolve
			// 3: A buffer to resolve to
			// 4: an offset to store the result to 
			encoder.resolveQuerySet(querySet, 0, querySet.count, resolveBuffer, 0);
			if (resultBuffer.mapState === 'unmapped') {
				encoder.copyBufferToBuffer(resolveBuffer, 0, resultBuffer, 0, resultBuffer.size);
			}
		}
	
		device.queue.submit([encoder.finish()]);
	
		// There is no guarantee when mapAsync will resolve. Most likely a 
		// reading on the times will only arrive every other frame
		if (canTimestamp && resultBuffer.mapState === 'unmapped') {
			resultBuffer.mapAsync(GPUMapMode.READ).then(() => {
				const times = new BigUint64Array(resultBuffer.getMappedRange());
				// index 2 is beginning of compute, index 1 is end of render
				gpuTime = Number(times[1] - times[2]);
				computeTime = Number(times[3] - times[2]);
				vertexTime = Number(times[1] - times[0]);
				gpuAverage.addSample(gpuTime / 1000000);
				computeAverage.addSample(computeTime / 1000000);
				vertexAverage.addSample(vertexTime / 1000000);
				resultBuffer.unmap();
			});
		}
	
	}



	function renderLoop(timestamp) {

		if (MOUSE_DOWN) {
			pan();
		}
		updateSceneUniforms();

		renderScreenText();
		
		frame();

		//console.log(`Step: ${step}`);
		requestAnimationFrame(renderLoop);
	}



	requestAnimationFrame(renderLoop);

}

main();

// end
