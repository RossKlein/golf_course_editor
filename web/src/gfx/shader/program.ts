/** A linked program with its uniform locations, found from the program itself: there is no list of names to keep in step. */
export type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

export function compileProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, name: string): Program {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`${name} shader: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name} shader: ${gl.getProgramInfoLog(p)}`);

  const found: Record<string, WebGLUniformLocation | null> = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    if (info) found[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  // a uniform the compiler removed because the shader never uses it has no location; setting it is a harmless no-op
  const u = new Proxy(found, { get: (t, key) => (typeof key === "string" && key in t ? t[key] : null) });
  return { program: p, u };
}

/** A program that is allowed to fail: the error goes to the console and the caller gets null. */
export function tryProgram(make: () => Program): Program | null {
  try {
    return make();
  } catch (e) {
    console.error(e);
    return null;
  }
}
