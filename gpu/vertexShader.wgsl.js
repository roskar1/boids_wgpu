// gpu/vertexShader.wgsl.js

export const VERTEX_SHADER_CODE =
`
	const UINTMAX : f32 = 4294967295;
	const S_INT_MAX = 2147483647;
	const numBoids = 5000000; // 1 mil

	struct VertexInput {
		@builtin(instance_index) instanceIndex: u32,
		@builtin(vertex_index) vertexIndex: u32,
		@location(0) pos: vec2f,
	};

	struct VertexInputSmall {
		@builtin(instance_index) instanceIndex: u32,
	};

	struct VertexOutput {
		@builtin(position) position: vec4f,
		@location(0) color: vec4f,
	};

	struct sceneUniforms {
		mouseX : f32,
		mouseY : f32,
		zoom : f32,
		offsetX : f32,
		offsetY : f32,
	};


	@group(0) @binding(0) var<storage, read> positions: array<vec2u>;
	@group(0) @binding(1) var<storage, read> velocities: array<vec2f>;
	@group(0) @binding(2) var<uniform> SceneUniforms: sceneUniforms;
	@group(0) @binding(3) var<storage> cellCounters: array<u32>;

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {

		let position : vec2f = worldToScreen(positions[input.instanceIndex]);
		let velocity : vec2f = velocities[input.instanceIndex];

		// Get the direction of the velocity vector and construct rotation matrix
		// The magnitude of the velocity does not matter

		// Normalized Velocity
		var u : vec2f = normalize(velocity);
		//let rotate : mat2x2f = mat2x2f();

		let rotate : mat2x2f = mat2x2f(
			-u.y,  u.x, 
			-u.x, -u.y
		);


		// Offset is already negative or positive correctly based on right/left
		var panVector : vec2f = vec2f(SceneUniforms.offsetX, SceneUniforms.offsetY);

		// color
		/*
		var color = array<vec4f, 3>(
			vec4f(1, 0, 0, 1),
			vec4f(0, 1, 0, 1),
			vec4f(0, 0, 1, 1),
		);
		*/
			
		var vsOutput: VertexOutput;

		vsOutput.position = vec4f
		(
			((rotate * input.pos / 2500) + (position + panVector)) * SceneUniforms.zoom,
			0.0, 
			1.0
		);

		// Color
		//vsOutput.color = color[input.vertexIndex];
		vsOutput.color = vec4f(1.0, 1.0, 1.0, 1.0);
	
		return vsOutput;
	}

	@vertex
	fn vertexGridPass(input: VertexInput) -> VertexOutput {
	
		let gridEdge : u32 = 16;
		// u32 division is automatically truncated towards 0
		let scaleFactor : u32 = u32(UINTMAX) / gridEdge;

		let i : u32 = input.instanceIndex;

		let X = i % gridEdge;
		let Y = i / gridEdge;

		// The number 15k here represents the density represented by the maximum opacity
		var density = 2 * (numBoids / f32(gridEdge * gridEdge));
		var opacity: f32 = clamp(f32(cellCounters[i]) / density, 0, 1.0);

		var offset: vec2u = (vec2u(X, Y)) * scaleFactor;
		var offsetWorld: vec2f = worldToScreen(offset);

		var panVector : vec2f = vec2f(SceneUniforms.offsetX, SceneUniforms.offsetY);

		var vsOutput: VertexOutput;
		vsOutput.position = vec4f
		(
			(((input.pos + 1.0) / f32(gridEdge)) + (offsetWorld + panVector)) * SceneUniforms.zoom,
			0.0,
			1.0
		);
		vsOutput.color = vec4f(opacity, opacity, opacity, 0.4);

		return vsOutput;
	}

	@vertex
	fn vertexMainSmall(input: VertexInputSmall) -> VertexOutput {

		let position : vec2f = worldToScreen(positions[input.instanceIndex]);
		var panVector : vec2f = /*position + */ vec2f(SceneUniforms.offsetX, SceneUniforms.offsetY);
		var vsOutput: VertexOutput;
		vsOutput.position = vec4f
		(
			(panVector + position) * SceneUniforms.zoom,
			0.0,
			1.0
		);

		vsOutput.color = vec4f(1.0, 1.0, 1.0, 1.0);
		
		return vsOutput;
	}

	fn worldToScreen(v : vec2u) -> vec2f {
		// returns a float vector between -1 and 1
		return (vec2f(v) / (UINTMAX / 2.0)) - 1.0;
	}

	fn worldToScreenHalf(v : vec2i) -> vec2f {
		let new_vector : vec2f = vec2f(f32(v.x), f32(v.y));

		return (new_vector / (S_INT_MAX / 2.0)) - 1.0;

	}

	@fragment
	fn fragmentMain(fsInput: VertexOutput) -> @location(0) vec4f {
		//return vec4f(1.0, 1.0, 1.0, 1.0);
		// Color
		return fsInput.color;
	}	
`;
