import { compileProgram, type Program } from "../../gfx/shader/program";
import type { Gl } from "../context";
import { SHADERS } from "../shaders/shaders";
import { setLookUniforms } from "../look/look";
import { sunDirection } from "../sun";
import type { World } from "../world";
import type { View3d } from "../terrain";
import type { WaterMesh } from "./data";

/** Opaque as a share (0 to 1) where the water has no depth to speak of and where it is deeper than its clarity. */
const WATER_OPACITY_SHALLOW = 0.8;
const WATER_OPACITY_DEEP = 0.95;
/** How many pixels across the shore's fade is, whatever the slope of the bank and the angle it is seen at; and the least depth it spans, in metres. */
const WATER_SHORE_PIXELS = 1.5;
const WATER_SHORE_MIN = 0.004;
/** The lowest a view ray is taken to be, as its share of vertical, when the depth bias is worked out: a shallower view would multiply it without limit and push the water through a bank crest. */
const WATER_BIAS_MIN_SLOPE = 0.4;

const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
uniform mat4 uViewProj;
uniform float uScale;
uniform vec3 uWaterEye;
uniform float uBias;
out vec2 vXZ;
out vec3 vWorld;
out vec3 vNormal;
void main(){
 vXZ=position.xz;
 vWorld=vec3(position.x,position.y*uScale,position.z);
 vNormal=normalize(vec3(normal.x*uScale,normal.y,normal.z*uScale));
 // Drawn nearer the eye along the vertex's own view ray: the same place on the screen, only nearer in depth, so the coarse ground
 // mesh cannot hide the water's edge, and nothing looks raised. A shallow view needs more of it for the same height error.
 vec3 toEye=uWaterEye-vWorld;
 float len=length(toEye);
 vec3 dir=toEye/max(len,1e-4);
 float pull=min(uBias/max(abs(dir.y),${WATER_BIAS_MIN_SLOPE.toFixed(2)}),0.25*len);
 gl_Position=uViewProj*vec4(vWorld+dir*pull,1.0);
}`;
const fragment =
  SHADERS.ground.fragment.slice(
    0,
    SHADERS.ground.fragment.lastIndexOf("void main()"),
  ) +
  `
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uWaterEye;
uniform vec3 uWaterTint;
uniform vec3 uWaterShallow;
uniform float uWaterClarity;
uniform vec3 uWaterSky;
uniform float uWaterRipples;
uniform float uWaterClip;
void main(){
 float shade,occlusion,coverage,bed;vec2 speckle,detail;
 gameGround(vXZ,shade,speckle,detail,occlusion,coverage,bed);
 float footprint=max(length(dFdx(vXZ)),length(dFdy(vXZ)));
 // How deep the water is here, from the exact heights and not the ground mesh (which is coarse far away and cuts across the bank): the
 // shore is where it is 0, and the water goes from clear and light to dark and opaque as it deepens. Worked out first: the shore's fade
 // is a pixel or two wide whatever the slope, from the depth's change across a pixel, and a derivative must not follow a discard
 vec2 ground=heightAt(vXZ);
 float depth=ground.y>0.5?vWorld.y/uScale-ground.x:1.0;
 float shore=smoothstep(0.0,max(${WATER_SHORE_PIXELS.toFixed(2)}*fwidth(depth),${WATER_SHORE_MIN.toFixed(3)}),depth);
 // A mesh cut at its shore is drawn whole; an older one is a carrier that the painted outline clips
 if(uWaterClip<0.5)coverage=1.0;
 if(coverage<=0.001)discard;
 float body=1.0-exp(-max(depth,0.0)/max(uWaterClarity,0.01));
 float opacity=mix(${WATER_OPACITY_SHALLOW.toFixed(3)},${WATER_OPACITY_DEEP.toFixed(3)},body)*shore*coverage;
 if(opacity<=0.002)discard;
 float ripple=1.0-smoothstep(0.6,3.0,footprint);
 vec2 wave=vec2(cos(dot(vXZ,vec2(0.45,0.2))),sin(dot(vXZ,vec2(-0.15,0.6))));
 vec3 n=normalize(vNormal+vec3(wave.x*uWaterRipples*ripple,0.0,wave.y*uWaterRipples*ripple));
 vec3 view=normalize(uWaterEye-vWorld);
 float fresnel=0.04+0.76*pow(1.0-max(dot(n,view),0.0),5.0);
 float sun=pow(max(dot(reflect(-uSunDir,n),view),0.0),160.0)*0.35;
 outColor=vec4(mix(mix(uWaterShallow,uWaterTint,body),uWaterSky,fresnel)+vec3(sun),opacity);
}`;

/** The water program's sources, for the tests that read them. */
export const WATER_SHADERS = { vertex, fragment };

/**
 * The most a flat face of the ground mesh can stand above the true ground, or below it, for each square metre of its squares (spacing squared),
 * in metres of height: 2 cm at 1 m spacing, 8 cm at 2 m. The water is pulled nearer the eye by about that much (not raised: see the vertex shader).
 */
const GROUND_FACE_ERROR_PER_SQUARE_METRE = 0.02;

export class WaterPass {
  data: WaterMesh | null = null;
  private uploaded: WaterMesh | null = null;
  private generation = -1;
  private program: Program | null = null;
  private draws: {
    vao: WebGLVertexArrayObject;
    buffers: WebGLBuffer[];
    count: number;
    /** Whether the painted outline clips this lake: only a mesh not cut at its shore, and with no excess, is a carrier to clip. */
    clip: boolean;
  }[] = [];
  set(data: WaterMesh) {
    this.data = data;
  }
  free(g: Gl | null) {
    if (g && g.generation === this.generation) {
      for (const d of this.draws) {
        g.gl.deleteVertexArray(d.vao);
        d.buffers.forEach((b) => g.gl.deleteBuffer(b));
      }
      if (this.program) g.gl.deleteProgram(this.program.program);
    }
    this.draws = [];
    this.program = null;
    this.uploaded = null;
  }
  draw(g: Gl, world: World, v: View3d) {
    if (!this.data || !v.game) return;
    const { gl } = g;
    if (this.generation !== g.generation || this.uploaded !== this.data) {
      this.free(g);
      this.generation = g.generation;
      this.program = compileProgram(gl, vertex, fragment, "water");
      for (const lake of this.data.lakes) {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        const buffers: WebGLBuffer[] = [];
        [lake.positions, lake.normals].forEach((values, i) => {
          const b = gl.createBuffer()!;
          buffers.push(b);
          gl.bindBuffer(gl.ARRAY_BUFFER, b);
          gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(values),
            gl.STATIC_DRAW,
          );
          gl.enableVertexAttribArray(i);
          gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 0, 0);
        });
        const b = gl.createBuffer()!;
        buffers.push(b);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
        gl.bufferData(
          gl.ELEMENT_ARRAY_BUFFER,
          new Uint32Array(lake.indices),
          gl.STATIC_DRAW,
        );
        this.draws.push({ vao, buffers, count: lake.indices.length, clip: !lake.cut && !(lake.excess > 0) });
      }
      this.uploaded = this.data;
    }
    const p = this.program!;
    gl.useProgram(p.program);
    world.height.bind(g, p); // the exact ground the water's depth is measured from
    world.surfaces.bindClasses(g, p);
    world.surfaces.bindGround(g, p);
    setLookUniforms(gl, p, world.look);
    gl.uniformMatrix4fv(p.u.uViewProj, false, v.viewProj);
    gl.uniform1f(p.u.uScale, v.scale);
    // The ground is drawn as a mesh that is coarser the further the camera is, and its flat faces cut across the bank; the shore is cut where
    // the water is just above the ground, so without a bias in depth the faces would hide the water's edge again.
    const finest = v.meshes[v.meshes.length - 1]?.spacing ?? 0;
    gl.uniform1f(p.u.uBias, GROUND_FACE_ERROR_PER_SQUARE_METRE * finest * finest * v.scale);
    gl.uniform3fv(p.u.uWaterEye, v.eye);
    gl.uniform3fv(p.u.uWaterSky, world.look.sky);
    gl.uniform3fv(p.u.uWaterTint, world.look.water?.tint ?? [0.025, 0.1, 0.12]);
    gl.uniform3fv(p.u.uWaterShallow, world.look.water?.shallow ?? [0.1, 0.36, 0.36]); // missing when the server that sent the look is older than this page
    gl.uniform1f(p.u.uWaterClarity, world.look.water?.clarity ?? 1);
    gl.uniform1f(p.u.uWaterRipples, world.look.water?.ripples ?? 0.008);
    gl.uniform3f(p.u.uSunDir, ...sunDirection(world.sun));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    for (const d of this.draws) {
      gl.bindVertexArray(d.vao);
      gl.uniform1f(p.u.uWaterClip, d.clip ? 1 : 0);
      gl.drawElements(gl.TRIANGLES, d.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
