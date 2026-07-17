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
	const gridEdgeCount = 16; //<-----------------------------------------------
	const totalCellCount = gridEdgeCount * gridEdgeCount;
	const U_INT_MAX = 4294967295;

	@group(0) @binding(0) var<storage, read> inputPositions: array<vec2u>;
	@group(0) @binding(1) var<storage, read_write> outputPositions: array<vec2u>;

	@group(0) @binding(2) var<storage, read> inputVelocities: array<vec2f>;
	@group(0) @binding(3) var<storage, read_write> outputVelocities: array<vec2f>;


	@group(0) @binding(4) var<uniform> SceneUniforms: sceneUniforms;

	@group(0) @binding(5) var<storage, read_write> cellIndices: array<cellIndexHelperStruct>;
	// Old binding 6
	//@group(0) @binding(6) var<storage, read_write> cellContentsArray: array<Boid, totalCellCount>;

	// new binding (6): shared cellCounters
	@group(0) @binding(6) var<storage, read_write> cellCounters: array<atomic<u32>, totalCellCount>;


















	// So these can be workgroup buffers
	//var<storage, read_write> cellCounters: array<u32, totalCellCount>;
	//var<storage, read_write> cellStorage: array<cellStorageHelperStruct, totalCellCount>;


	// workgroup storage is shared by all threads in a workgroup. Therefore it 
	// it is incredibly fast but limited in size. In an ideal world, we could 
	// have each workgroup
	//var<workgroup> cellCounters: array<atomic<u32>, totalCellCount>;
	//var<workgroup> cellStorage: array<cellStorageHelperStruct, totalCellCount>;

	// vec4 implementation - optimal size for registers
	// @group(0) @binding(0) var<storage, read> inputParticles: array<Boid>;
	// @group(0) @binding(1) var<storage, read_write> outputParticles: array<Boid>;



	// CELLINDICES is yet another massive array which stores and entry for each 
	// boid that contains
	// 1. the cell that boid is found in (4 bytes)
	// 2. the place in the cell(index)   (4 bytes)

	// This buffer can be data optimized as the cell is limited to the variable
	// totalCellCount which by default is a number between 1 and 256. 



	// CELLCONTENTSARRAY is another massive storage binding containing a boid
	// entry of [16 bytes] for every single one of the 1-64 million boids. 
	// I believe it could be replaced by an index of each boid. Picture this,
	// The input positions array remains unchanged while a buffer of indices in 
	// sorted order is maintained. While the input positions may look like this:
	// [0, 1, 2, 3, 4, ... ],
	// The cellcontentsarray will look like this:
	// [3, 4, 2, 0, 1, ... ].
	// Each value is an index of the boid. In an arbitrary example with startIndex
	// of 0 and endIndex of 2 for cell 1, boids 3, 4, and 2 are found in that cell spatially, 
	// The update call then loops from startIndex to endIndex of cellContents, 
	// for each boid, accessing the boids at those indices in cellContents that 
	// are found in the ping-ponging buffers


	@compute 
	@workgroup_size(${WORKGROUP_SIZE}, 1, 1)
	fn computeMainFloat32(input: computeInput) {
		let i = input.id.x;
		// Convert to float
		let newPosition : vec2f = vec2f(inputPositions[i]) + inputVelocities[i];
		// Wrap around and convert back to u32
		outputPositions[i] = vec2u(fmod_f32(newPosition, U_INT_MAX));
		outputVelocities[i] = inputVelocities[i];
	}

	// Override modulo to floored modulo function for unsigned canvas wrapping
	fn fmod_f32(v : vec2f, y : f32) -> vec2f {
		return vec2f(
			((v.x % y) + y) % y,
			((v.y % y) + y) % y
		);
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
		//share cell counters with vertex shader for opacity measurements
	}















	// Do this once per cell
	// If workgroup size is the number of cells this could work
	@compute
	@workgroup_size(${WORKGROUP_SIZE}, 1, 1)
	fn alloc(input: computeInput) {
		let i = input.id.x;
		//var prefixSum: u32 = 0u;
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
