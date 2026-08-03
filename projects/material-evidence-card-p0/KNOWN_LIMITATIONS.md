# Known limitations — v0.0.1-p0

- The viewer uses embedded Cartesian coordinates; it does not parse the XYZ file at runtime.
- The transparent frame is a display bound, not a crystallographic unit cell.
- No lattice matrix, fractional-coordinate basis, periodic-boundary semantics, or conventional/primitive cell definition is provided.
- No fixed +X/+Y/+Z camera presets, in-page source download, or copy-full-hash control is implemented yet.
- Parse and hash checks passed during packaging; browser replay was `UNAVAILABLE` in the managed release environment and is not claimed as PASS.
- `P0.1` conformance is not claimed.
