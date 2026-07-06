// main.js

//-----------------------------------------------------------------------------
// WebGPU Setup
//-----------------------------------------------------------------------------
let canvas;
let device;
let context;
let canvasFormat;
let screenLog;
let screenLogZoom;

// Unified init function
async function init() {

	try {
		console.log("0. Configuring canvas...");

		canvas = document.querySelector("#myCanvas");
		console.log("Canvas element found:", canvas); 
		console.log("DOM State:", document.readyState);

		if (!navigator.gpu) { 
			throw new Error("WebGPU not supported."); 
			console.log(1); 
		}

		console.log("1. Configuring device and adapter...");
		////////// Promise ////////////////////////////////////////////////////

		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			throw new Error("No appropriate GPU adapter found.");
		}
		///////// Promise /////////////////////////////////////////////////////
		device = await adapter.requestDevice();

		context = canvas.getContext("webgpu"); 

		// Formats
		canvasFormat = navigator.gpu.getPreferredCanvasFormat();
		context.configure({ device: device, format: canvasFormat });


		console.log("2. Configuring event listeners...");

		// GPU Error listenener
		device.addEventListener('uncapturederror', (event) => {
			console.error('A WebGPU error occurred:', event.error.message);
		});		

		// Canvas resize listener
		resizeCanvas(); // Initially resize canvas
		window.addEventListener('resize', resizeCanvas);
	
		// Mouse move listener
		screenLog = document.querySelector("#screen-log");
		document.addEventListener("mousemove", onMouseMove);

		// Mouse zoom listener
		screenLogZoom = document.querySelector("#screen-log-zoom");
		canvas.onwheel = zoom;

		// Mouse pan listener
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("mouseup", onMouseUp);


		//console.log("Slept for 2 seconds");


		initMisc();
		initVertexShader();
		initComputeShader();
		initData();


	} catch (error) {
		console.error("Initialization failed\n", error);
		//process.exit(1);
	}
}


//-----------------------------------------------------------------------------
// Global Variable Setup
//-----------------------------------------------------------------------------
// Simulation globals
const kNumObjects = 1000000; //2100000
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


//-----------------------------------------------------------------------------
// Useful Functions
//-----------------------------------------------------------------------------
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

function renderScreenText() {
	screenLog.innerText = 
	`Mouse Canvas Position X/Y: ${fMouseX}, ${fMouseY}
	Mouse GPU Position X/Y: ${GPUX}, ${GPUY} 
	Mouse World Position X/Y: ${worldX}, ${worldY}
	Mouse Zoom: ${scale}
	`;
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


//-----------------------------------------------------------------------------
// Misc. Globals
//-----------------------------------------------------------------------------
let sceneUniforms;
let uniformBuffer;


//-----------------------------------------------------------------------------
// Miscellaneous Initialization
//-----------------------------------------------------------------------------
function initMisc() {
	
	console.log("3. Initializing Miscellaneous variables...");

	//0: mouseX, 1: mouseY, 2: mouseZoom, 3: fOffsetX, 4: fOffsetY
	sceneUniforms = new Float32Array(5);
	sceneUniforms[2] = scale;

	// This stores SceneUniforms
	uniformBuffer = device.createBuffer({
		label: "Stores mouse position, scale and offsets",
		size: sceneUniforms.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
}


//-----------------------------------------------------------------------------
// Vertex Shader Globals
//-----------------------------------------------------------------------------
let vertexBindGroupLayout;
let vertexBuffer;
let vertexPipeline;
import { VERTEX_SHADER_CODE } from './gpu/vertexShader.wgsl.js';


//-----------------------------------------------------------------------------
// Vertex Shader Initialization
//-----------------------------------------------------------------------------
function initVertexShader() {
	
	console.log("4. Initializing Vertex Shader...");
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
		 1,  0.0,
		-1,  0.5,
		-1, -0.5,
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
}


//-----------------------------------------------------------------------------
// Compute shader globals
//-----------------------------------------------------------------------------
let computeBindGroupLayout;
let computePipelineLayout;
let computePipeline;
import { COMPUTE_SHADER_CODE } from './gpu/computeShader.wgsl.js';

console.log("Shader Code Loaded:", COMPUTE_SHADER_CODE);
//-----------------------------------------------------------------------------
// Compute Shader Initialization
//-----------------------------------------------------------------------------
function initComputeShader() {

	console.log("5. Initializing Compute Shader...");
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
}


//-----------------------------------------------------------------------------
// Data Initialization Globals
//-----------------------------------------------------------------------------
let vertexBindGroups;
let computeBindGroups;


//-----------------------------------------------------------------------------
// Data Initialization
//-----------------------------------------------------------------------------
function initData() {

	console.log("5. Initializing Boid Data...");
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
		initialVelocities[i] = rand(-1, 1);
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


//-----------------------------------------------------------------------------
// Bind Groups
//-----------------------------------------------------------------------------
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

}




























/*
//-----------------------------------------------------------------------------
// Layout construction
//-----------------------------------------------------------------------------
const computeBindGroupLayout = device.createBindGroupLayout({
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

const vertexBindGroupLayout = device.createBindGroupLayout({
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

const computePipelineLayout = device.createPipelineLayout({
	label: "Compute Pipeline Layout",
	bindGroupLayouts: [ computeBindGroupLayout ],	
});

//-----------------------------------------------------------------------------
// Vertex buffer triangle data setup
//-----------------------------------------------------------------------------
	const vertices = new Float32Array([
		 1,  0.0,
		-1,  0.5,
		-1, -0.5,
	]);
	
	const vertexBuffer = device.createBuffer({
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

//-----------------------------------------------------------------------------
// Vertex/Fragment Shader
//-----------------------------------------------------------------------------

import {VERTEX_SHADER_CODE } from './gpu/vertexShader.wgsl.js';

const vertexModule = device.createShaderModule({
	label: "Hardcoded Triangle Shader",
	code: VERTEX_SHADER_CODE
});

//-----------------------------------------------------------------------------
// Vertex/Fragment Pipeline
//-----------------------------------------------------------------------------
const vertexPipeline = device.createRenderPipeline({
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

//-----------------------------------------------------------------------------
// Data Initialization
//-----------------------------------------------------------------------------
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

for (let i = 0; i < size; ++i) {
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
	initialVelocities[i] = rand(-1, 1);
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

//-----------------------------------------------------------------------------
// Bind Groups
//-----------------------------------------------------------------------------
const computeBindGroups = [
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

const vertexBindGroups = [
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


//-----------------------------------------------------------------------------
// Compute Shader
//-----------------------------------------------------------------------------
import { COMPUTE_SHADER_CODE } from './gpu/computeShader.wgsl.js';

const computeModule = device.createShaderModule({
	label: "Compute Shader",
	code: COMPUTE_SHADER_CODE
});

//-----------------------------------------------------------------------------
// Compute Shader Pipeline
//-----------------------------------------------------------------------------
const computePipeline = device.createComputePipeline({
	label: "Compute Shader Pipeline",
	layout: computePipelineLayout,
	compute: {
		module: computeModule,
		entryPoint: "computeMain",
	},
});
*/




//-----------------------------------------------------------------------------
// Render Pass Descripter
//----------------------------------------------------------------------------
const renderPassDescriptor = {
	label: "Canvas renderPass",
	colorAttachments: [{
		clearValue: [0, 0, 0, 1],
		loadOp: "clear",
		storeOp: "store",
	}],
};


//-----------------------------------------------------------------------------
// Render pipeline Global Variables
//-----------------------------------------------------------------------------
let step = 0;
let multisampleTexture;


//-----------------------------------------------------------------------------
// Render
//-----------------------------------------------------------------------------
function render() {

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


	// Normal Render Stuff
	const encoder = device.createCommandEncoder();
		
	const pass = encoder.beginRenderPass(renderPassDescriptor);

	pass.setPipeline(vertexPipeline);
	pass.setBindGroup(0, vertexBindGroups[step % 2]);
	pass.setVertexBuffer(0, vertexBuffer);
	pass.draw(3, kNumObjects);

	pass.end();
		
	device.queue.submit([encoder.finish()]);
}


//-----------------------------------------------------------------------------
// Compute
//-----------------------------------------------------------------------------
function compute() {
	const encoder = device.createCommandEncoder({
		label: "Compute Encoder",
	});
	const pass = encoder.beginComputePass({
		label: "Compute Pass",
	});
	pass.setPipeline(computePipeline);
	// pass.setBindGroup(0, computeBindGroup);
	pass.setBindGroup(0, computeBindGroups[step % 2]);
	const workGroupCount = Math.ceil(kNumObjects / WORKGROUP_SIZE);
	
	pass.dispatchWorkgroups(workGroupCount);
	pass.end();

	device.queue.submit([encoder.finish()]);
}


//-----------------------------------------------------------------------------
// Game Loop
//-----------------------------------------------------------------------------

function renderLoop(timestamp) {
	requestAnimationFrame(renderLoop);

	if (MOUSE_DOWN) {
		pan();
	}
	updateSceneUniforms();

	renderScreenText();

	compute();
	render();
	step++;
}


//-----------------------------------------------------------------------------
// Entry Point
//-----------------------------------------------------------------------------

init();
requestAnimationFrame(renderLoop);


// end
