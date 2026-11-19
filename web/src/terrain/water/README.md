# Water rendering

`data.ts` validates the exported v1 water mesh. `water.ts` owns the WebGL pass and GPU lifetime. The scene requests preview geometry from the server; this layer imports no editor or network code. A lake mesh cut at its shore (`cut`) is drawn whole; an older carrier is clipped by the ground shader's spline coverage. Heights and normals are authored by the build, with flat surfaces by default. See docs/water-editor.md for controls, serialization and build behavior.
