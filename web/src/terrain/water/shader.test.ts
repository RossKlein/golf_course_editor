import { describe, expect, it } from "vitest";
import { WATER_SHADERS } from "./water";

// What the water shader must do, read from its source (a GPU is needed to see it work; the user judges how it looks).
describe("the water shader", () => {
  const { vertex, fragment } = WATER_SHADERS;

  it("measures the water's depth from the exact heights, not from the ground mesh, and fades the shore out where it is 0", () => {
    expect(fragment).toMatch(/vec2 ground=heightAt\(vXZ\)/);
    expect(fragment).toMatch(/depth=ground\.y>0\.5\?vWorld\.y\/uScale-ground\.x/);
    expect(fragment).toMatch(/smoothstep\(0\.0,max\([0-9.]+\*fwidth\(depth\),[0-9.]+\),depth\)/); // a pixel or two wide, whatever the slope
    const main = fragment.slice(fragment.lastIndexOf("void main()")); // the ground's own code above it has discards of its own
    expect(main.indexOf("fwidth(depth)")).toBeLessThan(main.indexOf("discard;")); // read before any discard
    expect(fragment).toMatch(/if\(opacity<=0\.002\)discard/);
  });

  it("goes from the shallow colour to the tint, and from clear to opaque, with the same share of the depth", () => {
    expect(fragment).toMatch(/body=1\.0-exp\(-max\(depth,0\.0\)\/max\(uWaterClarity/);
    expect(fragment).toMatch(/mix\(uWaterShallow,uWaterTint,body\)/);
    expect(fragment).toMatch(/mix\([0-9.]+,[0-9.]+,body\)/);
    expect(fragment).toMatch(/outColor=vec4\([^;]*,opacity\)/);
  });

  it("still clips a mesh that is not cut, and draws a cut one whole", () => {
    expect(fragment).toMatch(/if\(uWaterClip<0\.5\)coverage=1\.0/);
  });

  it("is nearer the eye in depth only: pulled along its own view ray, never raised", () => {
    expect(vertex).toMatch(/gl_Position=uViewProj\*vec4\(vWorld\+dir\*pull,1\.0\)/);
    expect(vertex).not.toMatch(/position\.y\s*\+/); // no lift of the height
  });
});
