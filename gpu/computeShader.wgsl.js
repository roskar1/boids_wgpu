// gpu/computeShader.wgsl.js

export const WORKGROUP_SIZE = 256;
export const COUNT_WORKGROUP_SIZE = 32;
export const ALLOC_WORKGROUP_SIZE = 64;

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
		cellAmount: f32,
		numBoids: f32,
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
		startIndex : u32,
		endIndex : u32,
		count : u32,
	};

	const U_INT_MAX = 4294967295;
	const cellCount : u32 = 1024;

	@group(0) @binding(0) var<storage, read> inputPositions: array<vec2u>;
	@group(0) @binding(1) var<storage, read_write> outputPositions: array<vec2u>;
	@group(0) @binding(2) var<storage, read> inputVelocities: array<vec2f>;
	@group(0) @binding(3) var<storage, read_write> outputVelocities: array<vec2f>;


	@group(0) @binding(4) var<uniform> SceneUniforms: sceneUniforms;
	@group(0) @binding(5) var<storage, read_write> cellIndices: array<cellIndexHelperStruct>;
	@group(0) @binding(6) var<storage, read_write> cellCounters: array<atomic<u32>>;


	//new 
	@group(0) @binding(7) var<storage, read_write> cellData: array<cellStorageHelperStruct>;

	










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


	@compute
	@workgroup_size(${COUNT_WORKGROUP_SIZE}, 1, 1)
	fn count(input: computeInput) {
		// Occurs once per boid
		let thid : u32 = input.id.x;

		if (thid >= arrayLength(&inputPositions)) {
			return;
		}

		let cell : u32 = getCell(inputPositions[thid]);
		let num : u32 = atomicAdd(&cellCounters[cell], 1u); // Atomic add to avoid race
		
		cellIndices[thid].cell = cell;
		cellIndices[thid].indexWithinCell = num;
	}

	


	
	fn getCell(v: vec2u) -> u32 {
		let xPosition: u32 = v.x;
		let yPosition: u32 = v.y;
		
		let gridEdgeCount: f32 = SceneUniforms.cellAmount;

		let xCell: u32 = select(xPosition >> (32u - u32(log2(gridEdgeCount))), 0u, gridEdgeCount == 1);
		let yCell: u32 = select(yPosition >> (32u - u32(log2(gridEdgeCount))), 0u, gridEdgeCount == 1);
		
		return xCell + (yCell * u32(gridEdgeCount));
	}	



	/*
	@compute
	@workgroup_size(${COUNT_WORKGROUP_SIZE}, 1, 1)
	fn alloc(input: computeInput) {
		// All this does is perform the prefix sum operation and puts the 
		// running total in place of the density in the cellCounters array
		let i = input.id.x;
		let totalCellCount : f32 = SceneUniforms.cellAmount * SceneUniforms.cellAmount;

		// running total
		// This variable needs to be an atomic placed in an array or workgroup buffer for access to all threads
		var prefixSum : u32 = 0u;

		var cellDensity = atomicLoad(&cellCounters[j]);
				
		// Assign startIndex to the current value of prefix sum
		cellData[j].startIndex = prefixSum;
		prefixSum += cellDensity;
		cellData[j].endIndex = prefixSum - 1; //the minus 1 is because of 0 based indexing
		cellData[j].count = cellDensity;

		//atomicAdd(&cellCounters[j], atomicLoad(&cellCounters[j - 1]));
		}
	}
	*/


	// Size of array: 8192 bytes
	// temporary array for the prefix sum computation
	var<workgroup> temp: array<u32, cellCount * 2>;


	// Kogge-Stone (1973) Inclusive Scan Algorithm Implementation

	@compute
	@workgroup_size(${ALLOC_WORKGROUP_SIZE}, 1, 1)
	fn naive_scan(input: computeInput) {
		let thid : u32 = input.id.x;
		var pout : u32 = 0u; 
		var pin : u32 = 1u;
		let n : u32 = arrayLength(&cellCounters);
		let count: u32 = atomicLoad(&cellCounters[thid]);

		if (thid < n) {
			temp[pout * n + thid] = count;
		}

		workgroupBarrier();

		for (var offset: u32 = 1; offset < n; offset *= 2) {
			pout = 1 - pout;
			pin = 1 - pin;

			if (thid >= offset) {
				temp[pout * n + thid] = temp[pin * n + thid] + temp[pin * n + thid - offset];
			} else {
				temp[pout * n + thid] = temp[pin * n + thid];
			}

			workgroupBarrier();
		}

		// Write output
		if (thid < n) { // thread guard
			cellData[thid].endIndex = temp[pout * n + thid];
			cellData[thid].startIndex = temp[pout * n + thid] - count;
			cellData[thid].count = count;
		}
	}



	// Blelloch (1990) Sum Scan Algorithm Implementation

	var<workgroup> temp_2: array<u32, cellCount>;

	@compute
	@workgroup_size(${ALLOC_WORKGROUP_SIZE}, 1, 1)
	fn prescan(input: computeInput) {
	
		// Setup
		let thid : u32 = input.id.x;
		var offset : u32 = 1u;
		let n = cellCount; 
		
		let idx1: u32 = 2u * thid;
		let idx2: u32 = 2u * thid + 1u;

		temp_2[idx1] = atomicLoad(&cellCounters[idx1]);
		temp_2[idx2] = atomicLoad(&cellCounters[idx2]);












		// Up-Sweep
		for (var d : u32 = n >> 1u; d > 0u; d >>= 1u) {
			workgroupBarrier();
			if (thid < d) {
				let ai : u32 = offset * (2u * thid + 1u) - 1u;
				let bi : u32 = offset * (2u * thid + 2u) - 1u;
				temp_2[bi] += temp_2[ai];
			}
			offset *= 2u;
		}

		// Clear root
		if (thid == 0u) {
			temp_2[n - 1] = 0u;
		}

		workgroupBarrier();












		// Down-Sweep
		for (var d : u32 = 1; d < n; d *= 2u) {
			offset >>= 1u;
			workgroupBarrier();
			if (thid < d) {
				let ai : u32 = offset * (2u * thid + 1u) - 1u;
				let bi : u32 = offset * (2u * thid + 2u) - 1u;
				let t : u32 = temp_2[ai];
				temp_2[ai] = temp_2[bi];
				temp_2[bi] += t;
			}
		}
		workgroupBarrier();














		// write output
		if (idx1 < n) {
			cellData[idx1].startIndex = temp_2[idx1];
		}
		if (idx2 < n) {
			cellData[idx2].startIndex = temp_2[idx2];
		}

		/*
		cellData[2 * thid].startIndex = temp_2[2 * thid];
		cellData[2 * thid + 1].startIndex = temp_2[2 * thid + 1];
		*/

		cellData[2 * thid].count = atomicLoad(&cellCounters[2 * thid]);
		// This writes out of bounds of the cellData array and reads out of bounds of the cellCounters array
		//cellData[2 * thid + 1].count = atomicLoad(&cellCounters[2 * thid + 1]);
	}







	@compute
	@workgroup_size(1, 1, 1)
	// Single Threaded Alloc
	fn salloc(input: computeInput) {
		let i = input.id.x;
		let totalCellCount : f32 = SceneUniforms.cellAmount * SceneUniforms.cellAmount;
		var prefixSum : u32 = 0u;


		for (var j = 0; j < i32(totalCellCount); j++) {
			var cellDensity : u32 = atomicLoad(&cellCounters[j]);
				
			cellData[j].startIndex = prefixSum;
			prefixSum += cellDensity;
			// use -1 for 0-based indexing
			// use clamp function to ensure no negative indices and no outside of array indices
			cellData[j].endIndex = clamp((prefixSum - 1), 0u, u32(SceneUniforms.numBoids - 1));
			cellData[j].count = cellDensity;
		}

		/*
		for (var j : i32 = 1; j < i32(totalCellCount); j++) {
			//atomicAdd(&cellCounters[j], atomicLoad(&cellCounters[j - 1]));

		}
		*/
	}
























	/*

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

	*/








	/*

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
