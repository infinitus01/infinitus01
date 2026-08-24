# Material Evidence Card P0

A personal portfolio prototype exploring how interactive material visualization can be connected to composition identity, artifact checks, reproducibility metadata, and explicit scientific claim boundaries.

This project follows [`MATERIAL_EVIDENCE_CARD_SPEC_v1.0.md`](MATERIAL_EVIDENCE_CARD_SPEC_v1.0.md). Every recurring synthetic showcase must use the same field names, state model, and publication gates.

## Release status

```text
RELEASE: v0.0.11-p0
PURPOSE: PERSONAL_PORTFOLIO_DEMO
SPECIFICATION: MATERIAL_EVIDENCE_CARD_SPEC_v1.0
ACTIVE_FIXTURE: SYN-HEA-010
RECIPE_CLASS: SYNTHETIC_FIXTURE
SCIENTIFIC_HYPOTHESIS_STATUS: NONE
SCIENTIFIC_VALIDATION: NOT_ASSESSED
SCIENTIFIC_CLAIM_STATUS: NONE
DECISION_USABLE: FALSE
P0.1_CONFORMANCE: NOT_CLAIMED
```

This release does **not** establish crystallographic interpretation, phase stability, material performance, manufacturability, experimental validation, optimization, or material recommendations.

## Required record order

1. `FIXTURE_ID`
2. `RECIPE_CLASS`
3. `NOMINAL_ATOMIC_COMPOSITION`
4. `SOURCE_PROVENANCE`
5. `ARTIFACT_IDENTITY`
6. `ARTIFACT_CHECKS`
7. `SPATIAL_DISPLAY_BOUNDARY`
8. `SCIENTIFIC_BOUNDARY`
9. `DOWNLOADS_OR_FILE_PATHS`
10. `KNOWN_LIMITS`

## Active record summary

| Field | Value |
|---|---|
| Fixture ID | `SYN-HEA-010` |
| Recipe class | `SYNTHETIC_FIXTURE` |
| Nominal atomic composition | `Fe 62.5 at.% · Ni 25 at.% · Cr 12.5 at.%` |
| Display notation | `Fe62.5Ni25Cr12.5 (at.%)` — non-authoritative |
| Composition derivation | `10 Fe : 4 Ni : 2 Cr` from 16 synthetic display atoms |
| Atomic-percent total | `100.0` with tolerance `1e-09` |
| Fixture origin | `GENERATED_IN_PROJECT` |
| Scientific hypothesis | `NONE` |
| Scientific validation | `NOT_ASSESSED` |
| Scientific claim status | `NONE` |
| Decision usable | `FALSE` |

The displayed ratio is a **synthetic nominal atomic composition**, not a validated alloy formulation. Per-element counts, basis, and derivation in `manifest.json` are authoritative; compact notation is display-only.

## Published fixtures

Published fixture files and hashes are immutable within this portfolio series.

| Fixture | Nominal atomic composition | Display-atom counts | SHA-256 |
|---|---|---|---|
| `SYN-HEA-001` | `Fe 50 at.% · Ni 25 at.% · Cr 25 at.%` | `8 : 4 : 4` | `7c72fef00bf33b72ec312bb8d1badf269da5299885997b2bd5b6e0c4a369306a` |
| `SYN-HEA-002` | `Fe 37.5 at.% · Ni 37.5 at.% · Cr 25 at.%` | `6 : 6 : 4` | `be25b48ae2703ced6b74363afcf41c28306ba5d7eaf79f73c3674024525866f5` |
| `SYN-HEA-003` | `Fe 25 at.% · Ni 50 at.% · Cr 25 at.%` | `4 : 8 : 4` | `3ca11e0f108409e162db27859c0fd61902b8c4839c2a7facb80a5d52a4d226e7` |
| `SYN-HEA-004` | `Fe 25 at.% · Ni 25 at.% · Cr 50 at.%` | `4 : 4 : 8` | `565ea0b005c0985d6359493febc450ac737ebc16e49c366fe16bffb23c16c9fe` |
| `SYN-HEA-005` | `Fe 12.5 at.% · Ni 37.5 at.% · Cr 50 at.%` | `2 : 6 : 8` | `8c4e51c815c2f9e0721a29c2434b4b4e713e69e6730c5b8c4a5be1e2a2350764` |
| `SYN-HEA-006` | `Fe 37.5 at.% · Ni 12.5 at.% · Cr 50 at.%` | `6 : 2 : 8` | `8702099895d63a2bff064be60b10ce9d910c06dbf5767a322769b0a90524ccf7` |
| `SYN-HEA-007` | `Fe 12.5 at.% · Ni 50 at.% · Cr 37.5 at.%` | `2 : 8 : 6` | `0266f90104bc582278fdb742583c1eb0e52713fb8f646b037f3c4b0ee76e0679` |
| `SYN-HEA-008` | `Fe 50 at.% · Ni 12.5 at.% · Cr 37.5 at.%` | `8 : 2 : 6` | `d0d813aefbeafb52578e500a282cee13e7ef939d967d26f128b785c7ba0e52c5` |
| `SYN-HEA-009` | `Fe 25 at.% · Ni 62.5 at.% · Cr 12.5 at.%` | `4 : 10 : 2` | `ff88e00d0c97b02205e7a2bef22f6391c9d287fbb713b60976fe81a055c97255` |
| `SYN-HEA-010` | `Fe 62.5 at.% · Ni 25 at.% · Cr 12.5 at.%` | `10 : 4 : 2` | `af3438c5ca2a8e53fb6ad34d1f7a19ca05da48d76a6488a27dfc9f00f0a16268` |

## Open locally

Open `index.html` directly in a modern browser. No package installation, web server, external CDN, bundled font, or third-party JavaScript dependency is required.

## Evidence identity

- Active fixture: `fixture/SYN-HEA-010.xyz`
- SHA-256: `af3438c5ca2a8e53fb6ad34d1f7a19ca05da48d76a6488a27dfc9f00f0a16268`
- Atom count: `16`
- Coordinate basis: `CARTESIAN_ONLY`
- Crystallographic semantics: `NONE`
- Display bounds role: `VISUAL_AID_ONLY`
- Display bounds is unit cell: `FALSE`
- Visible boundary label: `CARTESIAN DISPLAY BOUNDS · VISUAL AID — NOT A UNIT CELL`

## Artifact checks

Artifact-check statuses use only:

```text
NOT_RUN
PASS
FAIL
UNAVAILABLE
```

The active manifest records:

- Sequential fixture ID: `PASS`
- Previous fixtures preserved: `PASS`
- XYZ parse: `PASS`
- SHA-256 verification: `PASS`
- Composition derivation and sum: `PASS`
- Manifest/UI identity: `PASS`
- Embedded viewer coordinate identity: `PASS`
- JavaScript syntax: `PASS`
- License classification: `PASS`
- Browser render replay: `UNAVAILABLE`

A checkmark in the UI represents only `PASS`. `false` is not used as a substitute for not run, failed, or unavailable.

The render replay contract means the same input, viewer build, recorded initial camera, and representation can recreate the semantic view. It does **not** promise cross-browser or cross-GPU pixel identity. This release does not claim a replay `PASS` because a managed browser replay environment was unavailable.

## Recurring showcase contract

Every scheduled synthetic update must:

1. create exactly one new sequential synthetic fixture;
2. preserve all previous fixture files and identities;
3. use `RECIPE_CLASS: SYNTHETIC_FIXTURE`;
4. state `NOMINAL_ATOMIC_COMPOSITION` with an explicit `ATOMIC_PERCENT` basis;
5. derive percentages from recorded synthetic display-atom counts;
6. make the percentages sum to 100 within the recorded tolerance;
7. keep `SCIENTIFIC_HYPOTHESIS_STATUS: NONE`;
8. keep `SCIENTIFIC_VALIDATION: NOT_ASSESSED`;
9. keep `SCIENTIFIC_CLAIM_STATUS: NONE`;
10. keep `DECISION_USABLE: FALSE`;
11. keep `CRYSTALLOGRAPHIC_SEMANTICS: NONE`;
12. run deterministic sequential-ID, preservation, parse, hash, composition, manifest/UI identity, JavaScript, and license checks before publication.

A public-source recipe or hypothesis candidate requires a separate human-authorized workflow and must not be silently emitted by the synthetic-fixture automation.

## Licensing

- Demo HTML, CSS, JavaScript, documentation, and manifest: MIT.
- Synthetic XYZ fixtures and their SHA-256 sidecars: CC0-1.0.
- `REUSE.toml` classifies `fixture/*.xyz` and `fixture/*.xyz.sha256` as CC0-1.0; the wildcard mapping covers `SYN-HEA-010` without changing any previous fixture classification.
- No ProofRoute name, logo, or proprietary validation/governance core is included in this release.

See `LICENSES.md`, `LICENSES/`, and `REUSE.toml` for file-level scope.

## Known limits

See `KNOWN_LIMITATIONS.md`. This P0 demonstrates an interface and evidence boundary, not a material-science validator.
