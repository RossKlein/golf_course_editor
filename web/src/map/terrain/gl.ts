import { currentDevice, device, type Device } from "../../gfx/device/device";
import { compileProgram, tryProgram, type Program } from "../../gfx/shader/program";
import { SHADERS } from "./shaders";

/** The device plus the programs the terrain views always use. */
export type Gl = Device & {
  flat: Program;
  /** The 3D programs, which can fail to build without taking the flat map with them. */
  mesh: Program | null;
};

let made: Gl | null = null;

/** The one WebGL2 context all terrain views draw with, with the terrain programs built on it. */
export function context(): Gl {
  const d = device();
  if (made && made.generation === d.generation) return made;
  const { gl } = d;
  made = {
    ...d,
    flat: compileProgram(gl, SHADERS.flat.vertex, SHADERS.flat.fragment, "terrain"),
    mesh: tryProgram(() => compileProgram(gl, SHADERS.ground.vertex, SHADERS.ground.fragment, "terrain 3D")),
  };
  return made;
}

/** The context if there is one, without making it. */
export function currentContext(): Gl | null {
  const d = currentDevice();
  return d && made && made.generation === d.generation ? made : null;
}

/**
 * Compile every shader program on the shared context and return the errors, none when they all build. Programs are normally
 * built the first time a view needs them, so this is how a change to any shader is checked without visiting every view
 * (the page offers it as checkShaders() in the console).
 */
export function checkShaders(): string[] {
  const { gl } = device();
  const errors: string[] = [];
  for (const [name, source] of Object.entries(SHADERS)) {
    try {
      gl.deleteProgram(compileProgram(gl, source.vertex, source.fragment, name).program);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return errors;
}
