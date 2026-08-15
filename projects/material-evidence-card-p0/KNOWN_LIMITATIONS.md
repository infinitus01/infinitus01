# Known limitations — v0.0.7-p0+replay.2

- The viewer uses embedded Cartesian coordinates; it does not parse the XYZ file at runtime.
- The transparent frame is a display bound, not a crystallographic unit cell.
- No lattice matrix, fractional-coordinate basis, periodic-boundary semantics, or conventional/primitive cell definition is provided.
- No fixed +X/+Y/+Z camera presets, in-page source download, or copy-full-hash control is implemented yet.
- Parse and hash checks passed during packaging. The original `v0.0.7-p0` browser observation remains `UNAVAILABLE`; the patched viewer remains `NOT_RUN` until an external CI receipt is available, and no replay `PASS` is claimed in source yet.
- Historical `SYN-HEA-004` through `006` replay uses a pause/reset legacy adapter against each exact release commit. A retrospective result does not rewrite the release-time manifest.
- Canvas screenshot hashes are diagnostic only; cross-browser and cross-GPU pixel identity is not claimed.
- `P0.1` conformance is not claimed.
