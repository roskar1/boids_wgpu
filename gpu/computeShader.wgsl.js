// gpu/computeShader.wgsl.js

export const WORKGROUP_SIZE = 256;


export const COMPUTE_SHADER_CODE =
`
	struct computeInput {
		@builtin(global_invocation_id) id: vec3u,
	};
			
	struct sceneUniforms {
		mouseX : f32,
		mouseY : f32,
		zoom : f32,
		offsetX : f32,
		offsetY : f32,
	};

	struct Boid {
		x : u32,
		y : u32,
		xv : f32,
		yv : f32,
	};

	struct cellIndexHelperStruct {
		cell : u32,
		indexWithinCell : u32,
	};

	struct cellStorageHelperStruct {
		cellStartIndex : u32,
		cellEndIndex : u32,
		count : u32,
	};

	struct cellContents { //Dynamically sized arrays must be at the end of structs in wgsl
		// count : u32,
		particles: array<Boid>,
	};

	// Temporary grid size
	const gridEdgeCount = 16;
	const totalCellCount = gridEdgeCount * gridEdgeCount;


	// So these can be workgroup buffers
	//var<storage, read_write> cellCounters: array<u32, totalCellCount>;
	//var<storage, read_write> cellStorage: array<cellStorageHelperStruct, totalCellCount>;

	var<workgroup> cellCounters: array<atomic<u32>, totalCellCount>;
	var<workgroup> cellStorage: array<cellStorageHelperStruct, totalCellCount>;

	// There a entries in this array equal to the total amount of cells. 
	// In each entry there is a dynamically sized array. The sum of 
	// the sizes of these arrays is equal to the number of objects.
			
	// This must be a storage buffer
	// Use offsets to 
	//var<storage, read_write> cellContentsArray: array<cellContents, totalCellCount>;

		
	// vec2f
	@group(0) @binding(0) var<storage, read> inputPositions: array<vec2u>;
	@group(0) @binding(1) var<storage, read_write> outputPositions: array<vec2u>;

	@group(0) @binding(2) var<storage, read> inputVelocities: array<vec2f>;
	@group(0) @binding(3) var<storage, read_write> outputVelocities: array<vec2f>;


	// vec4 implementation - optimal size for registers
	// @group(0) @binding(0) var<storage, read> inputParticles: array<Boid>;
	// @group(0) @binding(1) var<storage, read_write> outputParticles: array<Boid>;


	@group(0) @binding(4) var<uniform> SceneUniforms: sceneUniforms;
	@group(0) @binding(5) var<storage, read_write> cellIndices: array<cellIndexHelperStruct>;
	@group(0) @binding(6) var<storage, read_write> cellContentsArray: array<Boid, totalCellCount>;


	@compute
	@workgroup_size(256, 1, 1) // 1D workgroup
	fn computeMain(input: computeInput) {
		// All this does is update positions by a constant factor
		let i = input.id.x;
		outputPositions[i] = vec2u(vec2f(inputPositions[i]) + inputVelocities[i]);

		//outputPositions[i] = vec2u(inputPositions[i] + 1);

		outputVelocities[i] = inputVelocities[i];

		// Update Velocities to point towards mouse
		//outputVelocities[i] = vec2f(
		//	(SceneUniforms.mouseX - f32(inputPositions[i].x)) / 10000.0, 
		//	(SceneUniforms.mouseY - f32(inputPositions[i].y)) / 10000.0
		//);
	}

	/*
	// Do this once per boid
	@compute
	@workgroup_size(${WORKGROUP_SIZE}, 1, 1)
	fn count(input: computeInput) {
		let i = input.id.x;
		let cell = getCell(inputPositions[i]);

		cellIndices[i].cell = cell;
		cellIndices[i].indexWithinCell = atomicLoad(&cellCounters[cell]);
		atomicAdd(&cellCounters[cell], 1u); // Atomic add to avoid race
	}

	// Do this once per cell
	// If workgroup size is the number of cells this could work
	@compute
	@workgroup_size(${WORKGROUP_SIZE}, 1, 1)
	fn alloc(input: computeInput) {
		let i = input.id.x;
		var prefixSum: u32 = 0u;
		// The variable i here represents the cell id and not the boid
		let cellCount = atomicLoad(&cellCounters[i]);

		cellStorage[i].cellStartIndex = prefixSum;
		cellStorage[i].cellEndIndex = prefixSum + cellCount;
		cellStorage[i].count = cellCount;
		prefixSum += cellCount;
	}

	// Do this once per boid
	@compute
	@workgroup_size(${WORKGROUP_SIZE}, 1, 1)
	fn fill(input: computeInput) {
		let i = input.id.x;
		let cell = getCell(inputPositions[i]);
		let offset = cellStorage[cell].cellStartIndex + cellIndices[i].indexWithinCell;

		cellContentsArray[offset] = 
			Boid(
				inputPositions[i].x,
				inputPositions[i].y,
				inputVelocities[i].x,
				inputVelocities[i].y
			);
		}

	fn getCell(v: vec2u) -> u32 {
		let xPosition = v.x;
		let yPosition = v.y;

		// Use only log safe values for this
		let xCell = xPosition >> (32 - u32(log2(gridEdgeCount)));
		let yCell = yPosition >> (32 - u32(log2(gridEdgeCount)));

		return xCell + (yCell * gridEdgeCount);
	}	
	*/

	fn rand_sine(p: vec2f) -> f32 {
		return fract(sin(dot(p, vec2f(12.9898, 4.1414))) * 43758.5453);
	}
`;
