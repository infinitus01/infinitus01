# Material Evidence Card P0

A personal portfolio prototype exploring how interactive material visualization can be connected to composition identity, artifact checks, reproducibility metadata, and explicit scientific claim boundaries.

This project follows [`MATERIAL_EVIDENCE_CARD_SPEC_v1.0.md`](MATERIAL_EVIDENCE_CARD_SPEC_v1.0.md). Future Monday / Wednesday / Friday synthetic showcase updates must use the same field names, state model, and release gates.

## Release status

```text
RELEASE: v0.0.2-p0
PURPOSE: PERSONAL_PORTFOLIO_DEMO
SPECIFICATION: MATERIAL_EVIDENCE_CARD_SPEC_v1.0
RECIPE_CLASS: SYNTHETIC_FIXTURE
SCIENTIFIC_VALIDATION: NOT_ASSESSED
SCIENTIFIC_CLAIM_STATUS: NONE
DECISION_USABLE: FALSE
P0.1_CONFORMANCE: NOT_CLAIMED
```

This release does **not** establish crystallographic interpretation, phase stability, material performance, manufacturability, experimental validation, or material recommendations.

## Record summary

| Field | Value |
|---|---|
| Fixture ID | `SYN-HEA-001` |
| Recipe class | `SYNTHETIC_FIXTURE` |
| Nominal atomic composition | `Fe 50 at.% · Ni 25 at.% · Cr 25 at.%` |
| Display notation | `Fe50Ni25Cr25 (at.%)` |
| Composition derivation | `8 Fe : 4 Ni : 4 Cr` from 16 synthetic display atoms |
| Fixture origin | `GENERATED_IN_PROJECT` |
| Scientific hypothesis | `NONE` |
| Scientific validation | `NOT_ASSESSED` |
| Scientific claim status | `NONE` |

The displayed ratio is a **synthetic nominal atomic composition**, not a validated alloy formulation.

## Open locally

Open `index.html` directly in a modern browser. No package installation, web server, external CDN, bundled font, or third-party JavaScript dependency is required.

## Evidence identity

- Active fixture: `fixture/SYN-HEA-001.xyz`
- SHA-256: `7c72fef00bf33b72ec312bb8d1badf269da5299885997b2bd5b6e0c4a369306a`
- Atom count: `16`
- Coordinate basis: `CARTESIAN_ONLY`
- Crystallographic semantics: `NONE`
- Display bounds: `VISUAL_AID_ONLY — NOT A UNIT CELL`

## Artifact checks

Artifact-check statuses use only:

```text
NOT_RUN
PASS
FAIL
UNAVAILABLE
```

The current manifest records:

- XYZ parse: `PASS`
- SHA-256 verification: `PASS`
- Composition derivation: `PASS`
- Browser render replay: `UNAVAILABLE`

A checkmark in the UI represents only `PASS`. `false` is not used as a substitute for not run, failed, or unavailable.

The render replay contract means the same input, viewer build, recorded initial camera, and representation can recreate the semantic view. It does **not** promise cross-GPU pixel identity.

## Recurring showcase contract

Every scheduled Monday / Wednesday / Friday update must:

1. create one new sequential synthetic fixture;
2. preserve all previous fixture files and identities;
3. use `RECIPE_CLASS: SYNTHETIC_FIXTURE`;
4. state `NOMINAL_ATOMIC_COMPOSITION` with an explicit `ATOMIC_PERCENT` basis;
5. derive percentages from recorded synthetic display-atom counts;
6. make the percentages sum to 100 within the recorded tolerance;
7. keep `SCIENTIFIC_VALIDATION: NOT_ASSESSED`;
8. keep `SCIENTIFIC_CLAIM_STATUS: NONE`;
9. keep `CRYSTALLOGRAPHIC_SEMANTICS: NONE`;
10. run deterministic parse, hash, composition, manifest/UI identity, and JavaScript checks before publication.

A public-source recipe or hypothesis candidate requires a separate human-authorized workflow and must not be silently emitted by the synthetic-fixture automation.

## Licensing

- Demo HTML, CSS, JavaScript, documentation, and manifest: MIT.
- Synthetic XYZ fixture and its SHA-256 sidecar: CC0-1.0.
- No ProofRoute name, logo, or proprietary validation/governance core is included in this release.

See `LICENSES.md`, `LICENSES/`, and `REUSE.toml` for file-level scope.

## Known limits

See `KNOWN_LIMITATIONS.md`. This P0 demonstrates an interface and evidence boundary, not a material-science validator.
