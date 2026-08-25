// Vector for workgroup dimensions
export const WG_SIZE = 256;

export const SCAN_SHADER = 
`
	enable subgroups;
	
	// input data is simple atomic u32 for cell Count
	// output data is the start index(exclusive)
	
	// Design decision: we are capping opacity grids to 16 million or 65,536 *
	// 256 or a 4096 by 4096 grid. Why? preventing linearization bugs and 
	// recognizing device rendering limits


	// max size of block sums is 65k which means three passes is necessary
	// If totalCellCount is below 256(16 by 16), one pass with block sums as 
	// block sums. If totalCellCount is below 65536(256 by 256), two pass with 
	// the first pass block sums as input to the second pass and block_sums_sums
	// as the output. If totalCellCount is above 65536 (max 4096 by 4096), 
	// three passes is required with the third pass taking block_sums_sums as 
	// input and block_sums_sums_sums as output. 

	//*Sizes are in elements not bytes. Multiply by 4 to get bytes.
	
	// Stage        g_idata						g_odata									block_sums
	// Single Pass(16 * 16)
	// scan 0		cellCounters(size: 256)*	cellData(size: 256)						block_sums_L1(size: 1)

	// Double Pass(256 * 256)
	// scan 0       cellCounters(size: 65k)		cellData(size: 65k)						block_sums_L1(size: 256)
	// scan 1       block_sums_L1(size: 256)	s_block_sums_L1(size: 256)				dummy_buffer(size: 1)
	//  add 0      -							cellData(size: 65k)						sblock_sums_L1(size: 256)

	// Triple Pass(4096 * 4096)
	// scan 0       cellCounters(size: 16m)		cellData(size: 16m)					block_sums_L1(size: 65k)
	// scan 1       block_sums_L1(size: 65k)	s_block_sums_L1(size: 65k)			block_sums_L2(size: 256)
	// scan 2       block_sums_L2(size: 256)    s_block_sums_L2(size: 256)			dummy_buffer(size: 1)
	//  add 1		-							sblock_sums_L1(size: 65k)			sblock_sums_L2(size: 256)
	//  add 0		-							cellData(size: 16m)					sblock_sums_L1(size: 65k)
	
	// since atomic<u32> and u32 occupy the same byte space, they can be 
	// converted without hassle

	@group(0) @binding(0) var<storage, read_write> g_idata: array<u32>;
	@group(0) @binding(1) var<storage, read_write> g_odata: array<u32>;
	@group(0) @binding(2) var<storage, read_write> block_sums: array<u32>;

	var <workgroup> sg_sums: array<u32, ${WG_SIZE}>;

	@compute
	@workgroup_size(${WG_SIZE})
	fn scan (
		@builtin(global_invocation_id) g_id: vec3u, // thread id
		@builtin(local_invocation_id) l_id: vec3u, // workgroup local thread id
		@builtin(workgroup_id) wg_id: vec3u, // workgroup index
		@builtin(num_workgroups) num_wg: vec3u, // number of workgroups
		@builtin(subgroup_size) sg_size: u32, 
		@builtin(subgroup_invocation_id) sg_lane: u32, // subgroup thread id
		@builtin(subgroup_id) sg_id: u32, // workgroup subgroup id
		@builtin(num_subgroups) num_sg: u32, // API support for num subgroups
	) {
		let n: u32 = arrayLength(&g_idata);
		let thid: u32 = g_id.x;
		let wid: u32 = wg_id.x;
		let in_range: bool = thid < n;
		var val: u32 = 0u;

		if (in_range) {
			val = g_idata[thid];
		}

		let sg_prefix: u32 = subgroupExclusiveAdd(val);

		// total sum of the subgroup
		let sg_sum: u32 = subgroupAdd(val);

		// write subgroup sum to workgroup memory
		if (sg_lane == 0u) {
			sg_sums[sg_id] = sg_sum;
		}
		workgroupBarrier();


		/*
		// whole first subgroup scans the subgroups
		if (sg_id == 0u) {
			let val_sg = select(0u, sg_sums[sg_lane], sg_lane < num_sg);
			let scanned = subgroupExclusiveAdd(val_sg);
			if (sg_lane < num_sg) {
				sg_sums[sg_lane] = scanned;
			}
			if (sg_lane == 0u && wid < arrayLength(&block_sums)) {
				block_sums[wid] = scanned + subgroupAdd(val_sg);
			}
		}
		*/	


		// thread scan
		if (l_id.x == 0u) {
			var sg_sum_total: u32 = 0u;
			for (var i = 0u; i < num_sg; i += 1u) {
				let tmp: u32 = sg_sums[i];
				sg_sums[i] = sg_sum_total;
				sg_sum_total = sg_sum_total + tmp;
			}

			let n_blocks: u32 = arrayLength(&block_sums);
			
			// again, bounds check on block_sum array
			if (wid < n_blocks) {
				block_sums[wid] = sg_sum_total;
			}
		}
		
		workgroupBarrier();


		// Only write the start index to output. 
		if (in_range) {
			g_odata[thid] = sg_sums[sg_id] + sg_prefix;
		}
	}


	// write back function adds each block sum to the respective input data 

	@compute
	@workgroup_size(${WG_SIZE}, 1, 1)
	fn add (
		@builtin(global_invocation_id) g_id: vec3u, // thread id
		@builtin(workgroup_id) wg_id: vec3u, // workgroup index
	) {
		let n: u32 = arrayLength(&g_odata);
		let thid: u32 = g_id.x;

		if (thid >= n) {
			return;
		}

		let wid: u32 = wg_id.x;

		if (wid > 0u) {
			g_odata[thid] += block_sums[wid - 1u];
		}
	}

`;
