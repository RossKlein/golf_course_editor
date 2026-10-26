# `src/gfx`

## Purpose

A thin WebGL2 layer: the one context, textures, shader programs, and the maths and culling a renderer needs. It knows nothing about golf, and imports no UI package. The game will reuse it as it is.

## Belongs here

- `device/`: the shared context, what this GPU can do, and a generation number that changes when the context is replaced
- `resource/`: `LazyTexture` (uploaded when first bound, and again after a lost context) and `uploadImage`
- `shader/`: `preprocess` (`#include` and defines for `.glsl` files) and `Program`, which finds its own uniforms after linking
- `math/`: `mat4` and the view frustum with box tests

## Does not belong here

- Anything that knows a height grid, a surface, a hole or the course's look: that is `terrain/`
- Shader files of a particular pass (they live with the pass)

## Rules

- No hand-kept uniform lists: a program reads them from the linked program.
- A GPU object made for an old context is recognised by its generation and made again, never reused.
- Pure parts (the preprocessor, frustum tests, the texture's generation logic against a stub context) have tests; the GPU calls are checked with `checkShaders()` in the page's console.
