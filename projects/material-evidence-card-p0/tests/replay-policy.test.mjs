import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  REPLAY_STATUS,
  RUNNER_STATUS,
  applyDeclaredPassGate,
  buildBondPairs,
  buildSemanticPayload,
  canonicalJson,
  classifyReplayObservation,
  parseBondCutoff,
  parseEmbeddedAtoms,
  semanticDigest,
  validateFixtureGrowth,
  validatePostReadyLayout,
  validateRuntimeReceipt,
  verifyFrozenFixturePair,
  verifyReleaseIdentity
} from "../tools/replay-core.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(projectDir, "../..");
const expectedAtoms = Object.freeze([
  { el: "Fe", x: 0, y: 0, z: 0 },
  { el: "Cr", x: 1, y: 1, z: 1 }
]);

function validRuntime() {
  return {
    receipt_schema: "MEC_PAGE_OBSERVATION_V1",
    observation_status: "READY",
    viewer_build: "material-evidence-card/test",
    replay_contract: "SEMANTIC_VIEW_RECREATION_NOT_PIXEL_IDENTITY",
    source_mode: "EMBEDDED_COORDINATES",
    runtime_structure_hash_verified: false,
    transformation: "FIXED_TRANSLATION_ONLY",
    camera: { preset: "INITIAL_ISOMETRIC", rx: -0.52, ry: 0.67, zoom: 1 },
    representation: "BALL_AND_STICK",
    mode: 0,
    spin: false,
    animation_loop: false,
    post_ready_layout_guard: {
      max_css_drift_device_px: 0.5,
      backing_store_must_match: true,
      dpr_must_match: true
    },
    atom_count: 2,
    element_counts: { Cr: 1, Fe: 1 },
    ordered_atoms: expectedAtoms.map(atom => ({ ...atom })),
    bond_cutoff: 2.62,
    bond_pairs: [[0, 1]],
    draw_counts: { atom_draw_count: 2, bond_draw_count: 1, bounds_edge_draw_count: 12 },
    projected_atoms: [
      { index: 0, el: "Fe", x: 25, y: 30, z: -0.4, scale: 1.02 },
      { index: 1, el: "Cr", x: 60, y: 45, z: 0.7, scale: 0.98 }
    ],
    canvas_observation: { css_width: 100, css_height: 80, pixel_width: 100, pixel_height: 80, dpr: 1 }
  };
}

test("canonical semantic digest does not depend on object insertion order", () => {
  const left = { camera: { ry: 0.67, rx: -0.52 }, atoms: ["Fe", "Cr"] };
  const right = { atoms: ["Fe", "Cr"], camera: { rx: -0.52, ry: 0.67 } };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(semanticDigest(left), semanticDigest(right));
});

test("artifact status stays four-state while runner infrastructure is separate", () => {
  assert.deepEqual(Object.values(REPLAY_STATUS).sort(), ["FAIL", "NOT_RUN", "PASS", "UNAVAILABLE"]);
  assert.equal(classifyReplayObservation({ launch_attempted: true, browser_launched: false }).status, REPLAY_STATUS.UNAVAILABLE);
  assert.equal(classifyReplayObservation({ explicit_skip: true }).status, REPLAY_STATUS.NOT_RUN);
  assert.equal(classifyReplayObservation({ browser_launched: true, ready_timeout: true }).status, REPLAY_STATUS.FAIL);
  assert.equal(classifyReplayObservation({ browser_launched: true, blank_canvas: true }).status, REPLAY_STATUS.FAIL);
  assert.equal(classifyReplayObservation({ browser_launched: true, semantic_digest_match: false }).status, REPLAY_STATUS.FAIL);
  assert.equal(classifyReplayObservation({ browser_launched: true, post_observation_invalidated: true }).classification_code, "POST_OBSERVATION_STATE_INVALIDATED");
  assert.equal(classifyReplayObservation({ browser_launched: true, post_observation_layout_mismatch: true }).classification_code, "POST_OBSERVATION_LAYOUT_MISMATCH");
  assert.equal(classifyReplayObservation({ browser_launched: true, diagnostic_errors: ["SCREENSHOT_FAILED"] }).status, REPLAY_STATUS.PASS);
  assert.equal(classifyReplayObservation({ browser_launched: true, page_receipt_invalid: true }).classification_code, "PAGE_RECEIPT_INVALID");
  assert.equal(classifyReplayObservation({ browser_launched: true, source_mode_mismatch: true }).classification_code, "SOURCE_MODE_MISMATCH");
  assert.equal(classifyReplayObservation({ browser_launched: true, transformation_mismatch: true }).classification_code, "TRANSFORMATION_MISMATCH");
  assert.equal(classifyReplayObservation({ browser_launched: true, runtime_hash_authority_mismatch: true }).classification_code, "RUNTIME_HASH_AUTHORITY_MISMATCH");
  const infrastructure = classifyReplayObservation({ infrastructure_error: "RECEIPT_WRITE_FAILED" });
  assert.equal(infrastructure.status, REPLAY_STATUS.NOT_RUN);
  assert.equal(infrastructure.runner_status, RUNNER_STATUS.INFRA_ERROR);
  assert.equal(infrastructure.publication_effect, "BLOCK");
});

test("a declared PASS blocks publication unless the exact candidate also observes PASS", () => {
  const unavailable = applyDeclaredPassGate({
    declaredStatus: REPLAY_STATUS.PASS,
    observedStatus: REPLAY_STATUS.UNAVAILABLE,
    effectiveStatus: REPLAY_STATUS.UNAVAILABLE,
    publicationEffect: "ALLOW_WITH_DISCLOSED_LIMIT"
  });
  assert.equal(unavailable.blocked, true);
  assert.equal(unavailable.effective_status, REPLAY_STATUS.FAIL);
  assert.equal(unavailable.publication_effect, "BLOCK");

  const pass = applyDeclaredPassGate({
    declaredStatus: REPLAY_STATUS.PASS,
    observedStatus: REPLAY_STATUS.PASS,
    effectiveStatus: REPLAY_STATUS.PASS,
    publicationEffect: "ALLOW"
  });
  assert.equal(pass.blocked, false);
  assert.equal(pass.effective_status, REPLAY_STATUS.PASS);
  assert.equal(pass.publication_effect, "ALLOW");
});

test("runtime receipt rejects malformed or non-spatial observations", () => {
  assert.deepEqual(validateRuntimeReceipt(validRuntime(), expectedAtoms, { nativeMode: true }), { valid: true, errors: [] });

  const nanCamera = validRuntime();
  nanCamera.camera.rx = Number.NaN;
  assert.equal(validateRuntimeReceipt(nanCamera, expectedAtoms, { nativeMode: true }).valid, false);

  const missingAtoms = validRuntime();
  delete missingAtoms.ordered_atoms;
  assert.equal(validateRuntimeReceipt(missingAtoms, expectedAtoms, { nativeMode: true }).valid, false);

  const duplicateProjection = validRuntime();
  duplicateProjection.projected_atoms[1].x = duplicateProjection.projected_atoms[0].x;
  duplicateProjection.projected_atoms[1].y = duplicateProjection.projected_atoms[0].y;
  assert.ok(validateRuntimeReceipt(duplicateProjection, expectedAtoms, { nativeMode: true }).errors.includes("PROJECTED_ATOMS_NOT_DISTINCT"));

  const outsideCanvas = validRuntime();
  outsideCanvas.projected_atoms[1].x = 101;
  assert.ok(validateRuntimeReceipt(outsideCanvas, expectedAtoms, { nativeMode: true }).errors.includes("PROJECTED_ATOM_OUT_OF_BOUNDS:1"));
});

test("semantic digest binds projection but excludes backing-store DPR metadata", () => {
  const first = validRuntime();
  const highDpr = validRuntime();
  highDpr.canvas_observation.pixel_width = 200;
  highDpr.canvas_observation.pixel_height = 160;
  highDpr.canvas_observation.dpr = 2;
  assert.equal(semanticDigest(buildSemanticPayload(first)), semanticDigest(buildSemanticPayload(highDpr)));

  const moved = validRuntime();
  moved.projected_atoms[0].x += 0.25;
  assert.notEqual(semanticDigest(buildSemanticPayload(first)), semanticDigest(buildSemanticPayload(moved)));
});

test("native viewer tolerates subpixel layout jitter but guards material READY changes", async () => {
  const viewerText = await readFile(path.join(projectDir, "viewer.js"), "utf8");
  assert.match(viewerText, /const REPLAY_LAYOUT_TOLERANCE_DEVICE_PX=\.5;/);
  assert.match(viewerText, /function replayLayoutChanged\(measurement\)\{const baseline=replayReceipt\?\.canvas_observation;/);
  assert.match(viewerText, /const cssTolerance=REPLAY_LAYOUT_TOLERANCE_DEVICE_PX\/baseline\.dpr;/);
  assert.match(viewerText, /canvas\.width!==baseline\.pixel_width\|\|canvas\.height!==baseline\.pixel_height/);
  assert.match(viewerText, /measurement\.pixelWidth!==baseline\.pixel_width\|\|measurement\.pixelHeight!==baseline\.pixel_height/);
  assert.match(viewerText, /Math\.abs\(measurement\.width-baseline\.css_width\)>cssTolerance/);
  assert.match(viewerText, /Math\.abs\(measurement\.height-baseline\.css_height\)>cssTolerance/);
  const observerSource = viewerText.slice(viewerText.indexOf("new ResizeObserver"));
  assert.match(observerSource, /replayLayoutChanged\(measurement\)/);
  assert.doesNotMatch(observerSource, /Math\.abs\(W-measurement\.width\)/);
  assert.doesNotMatch(observerSource, /Math\.abs\(H-measurement\.height\)/);
});

test("post-READY layout policy gates tolerance, rounding boundaries, and backing tamper", () => {
  const baseline = { css_width: 100.25, css_height: 80, pixel_width: 100, pixel_height: 80, dpr: 1 };
  const guard = { max_css_drift_device_px: 0.5, backing_store_must_match: true, dpr_must_match: true };
  const stable = {
    css_width: 100.49,
    css_height: 80,
    pixel_width: 100,
    pixel_height: 80,
    replay_dpr: 1,
    expected_pixel_width: 100,
    expected_pixel_height: 80
  };
  assert.equal(validatePostReadyLayout(baseline, stable, guard).valid, true);

  const materialDrift = { ...stable, css_width: 101, expected_pixel_width: 101 };
  assert.ok(validatePostReadyLayout(baseline, materialDrift, guard).errors.includes("POST_READY_CSS_DRIFT_EXCEEDED"));

  const roundBoundary = {
    ...stable,
    css_width: 100.51,
    expected_pixel_width: 101
  };
  assert.ok(validatePostReadyLayout(
    { ...baseline, css_width: 100.49 },
    roundBoundary,
    guard
  ).errors.includes("POST_READY_EXPECTED_BACKING_CHANGED"));

  const backingTamper = { ...stable, pixel_width: 101 };
  assert.ok(validatePostReadyLayout(baseline, backingTamper, guard).errors.includes("POST_READY_BACKING_STORE_CHANGED"));
});

test("historical bond cutoffs are parsed from each exact viewer build", () => {
  const releases = [
    ["a26cf75ba065bc3e821522ea556102d0e62e3901", 2.71],
    ["c816e879dcf4f79832a1918a5a52da3f8096d03e", 2.60],
    ["a6f218c9cb560def2c90fcd858c8e84eca1fe7ca", 2.62]
  ];
  for (const [commit, expectedCutoff] of releases) {
    const source = execFileSync(
      "git",
      ["show", `${commit}:projects/material-evidence-card-p0/viewer.js`],
      { cwd: repoRoot, encoding: "utf8" }
    );
    const cutoff = parseBondCutoff(source);
    assert.equal(cutoff, expectedCutoff);
    assert.equal(buildBondPairs(parseEmbeddedAtoms(source), cutoff).length, 27);
  }
});

test("hash mutation is a deterministic preflight failure, not an unavailable browser", async () => {
  const manifest = JSON.parse(await readFile(path.join(projectDir, "manifest.json"), "utf8"));
  const indexText = await readFile(path.join(projectDir, "index.html"), "utf8");
  const viewerText = await readFile(path.join(projectDir, "viewer.js"), "utf8");
  const xyzPath = path.join(projectDir, manifest.structure_file);
  const original = await readFile(xyzPath);
  const mutated = Buffer.from(original.toString("utf8").replace("synthetic BCC-like", "synthetic bcc-like"), "utf8");
  const sidecarText = await readFile(`${xyzPath}.sha256`, "utf8");
  const result = verifyReleaseIdentity({ manifest, indexText, viewerText, xyzBytes: mutated, sidecarText });
  assert.equal(result.status, REPLAY_STATUS.FAIL);
  assert.equal(result.checks.find(item => item.name === "XYZ_SHA256")?.status, REPLAY_STATUS.FAIL);
});

test("UI replay status mutation fails manifest identity", async () => {
  const manifest = JSON.parse(await readFile(path.join(projectDir, "manifest.json"), "utf8"));
  const indexText = await readFile(path.join(projectDir, "index.html"), "utf8");
  const viewerText = await readFile(path.join(projectDir, "viewer.js"), "utf8");
  const xyzBytes = await readFile(path.join(projectDir, manifest.structure_file));
  const sidecarText = await readFile(path.join(projectDir, `${manifest.structure_file}.sha256`), "utf8");
  const mutatedIndex = indexText.replace("RENDER REPLAY: NOT_RUN", "RENDER REPLAY: PASS");
  const result = verifyReleaseIdentity({ manifest, indexText: mutatedIndex, viewerText, xyzBytes, sidecarText });
  assert.equal(result.status, REPLAY_STATUS.FAIL);
  assert.equal(result.checks.find(item => item.name === "INDEX_RENDER_REPLAY_STATUS")?.status, REPLAY_STATUS.FAIL);
});

test("frozen fixture preservation rejects simultaneous XYZ and sidecar replacement", () => {
  const result = verifyFrozenFixturePair({
    currentXyz: Buffer.from("replacement xyz\n"),
    currentSidecar: Buffer.from("replacement sidecar\n"),
    baselineXyz: Buffer.from("baseline xyz\n"),
    baselineSidecar: Buffer.from("baseline sidecar\n")
  });
  assert.equal(result.status, REPLAY_STATUS.FAIL);
  assert.equal(result.xyz_preserved, false);
  assert.equal(result.sidecar_preserved, false);
});

test("fixture preservation permits only the next active sequential addition", () => {
  const frozenFixtureNames = Array.from({ length: 6 }, (_, index) => `SYN-HEA-${String(index + 1).padStart(3, "0")}.xyz`);
  assert.equal(validateFixtureGrowth({
    fixtureNames: frozenFixtureNames,
    frozenFixtureNames,
    activeFixtureName: "SYN-HEA-006.xyz"
  }).allowed, true);
  assert.equal(validateFixtureGrowth({
    fixtureNames: frozenFixtureNames,
    frozenFixtureNames,
    activeFixtureName: "SYN-HEA-005.xyz"
  }).allowed, false);
  assert.equal(validateFixtureGrowth({
    fixtureNames: [...frozenFixtureNames, "SYN-HEA-007.xyz"],
    frozenFixtureNames,
    activeFixtureName: "SYN-HEA-007.xyz"
  }).allowed, true);
  assert.equal(validateFixtureGrowth({
    fixtureNames: [...frozenFixtureNames, "SYN-HEA-007.xyz"],
    frozenFixtureNames,
    activeFixtureName: "SYN-HEA-006.xyz"
  }).allowed, false);
  assert.equal(validateFixtureGrowth({
    fixtureNames: [...frozenFixtureNames, "SYN-HEA-007.xyz", "SYN-HEA-008.xyz"],
    frozenFixtureNames,
    activeFixtureName: "SYN-HEA-008.xyz"
  }).allowed, false);
});

test("manifest keeps render replay outside the frozen publication gate", async () => {
  const manifest = JSON.parse(await readFile(path.join(projectDir, "manifest.json"), "utf8"));
  const indexText = await readFile(path.join(projectDir, "index.html"), "utf8");
  assert.equal(manifest.publication_gate.render_replay, undefined);
  assert.equal(manifest.artifact_checks.render_replay.status, REPLAY_STATUS.NOT_RUN);
  assert.ok(indexText.includes("Fixed translation + render only"));
  assert.ok(!indexText.includes("Center + render only"));
});

test("runner binds subjects for unavailable/not-run and separates runner infra", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mec-negative-controls-"));
  const runner = path.join(projectDir, "tools", "render-replay.mjs");
  const receiptAt = directory => path.join(directory, "render-replay-receipt.json");
  const assertBoundTargets = receipt => {
    assert.equal(receipt.requested_targets.length, 4);
    assert.equal(receipt.targets.length, 4);
    assert.ok(receipt.targets.every(target => target.subject.commit && target.subject.file_sha256.viewer));
  };

  try {
    const unavailableDir = path.join(tempDir, "unavailable");
    const unavailable = spawnSync(process.execPath, [runner, "--force-unavailable", "--output-dir", unavailableDir], { encoding: "utf8" });
    assert.equal(unavailable.status, 3, unavailable.stderr || unavailable.stdout);
    const unavailableReceipt = JSON.parse(await readFile(receiptAt(unavailableDir), "utf8"));
    assert.equal(unavailableReceipt.render_replay.status, REPLAY_STATUS.UNAVAILABLE);
    assert.equal(unavailableReceipt.environment.browser_launch_attempted, false);
    assertBoundTargets(unavailableReceipt);

    const installFailureDir = path.join(tempDir, "install-failure");
    const installFailure = spawnSync(
      process.execPath,
      [runner, "--policy=frozen-v1", "--output-dir", installFailureDir],
      { encoding: "utf8", env: { ...process.env, MEC_REPLAY_BROWSER_INSTALL_FAILED: "1" } }
    );
    assert.equal(installFailure.status, 0, installFailure.stderr || installFailure.stdout);
    const installFailureReceipt = JSON.parse(await readFile(receiptAt(installFailureDir), "utf8"));
    assert.equal(installFailureReceipt.render_replay.classification_code, "BROWSER_INSTALL_FAILED");
    assert.equal(installFailureReceipt.environment.browser_launch_attempted, false);
    assertBoundTargets(installFailureReceipt);

    const notRunDir = path.join(tempDir, "not-run");
    const notRun = spawnSync(process.execPath, [runner, "--skip", "--output-dir", notRunDir], { encoding: "utf8" });
    assert.equal(notRun.status, 4, notRun.stderr || notRun.stdout);
    const notRunReceipt = JSON.parse(await readFile(receiptAt(notRunDir), "utf8"));
    assert.equal(notRunReceipt.render_replay.status, REPLAY_STATUS.NOT_RUN);
    assertBoundTargets(notRunReceipt);

    const infraDir = path.join(tempDir, "infra");
    const infra = spawnSync(process.execPath, [runner, "--force-infra-error", "--output-dir", infraDir], { encoding: "utf8" });
    assert.equal(infra.status, 2, infra.stderr || infra.stdout);
    const infraReceipt = JSON.parse(await readFile(receiptAt(infraDir), "utf8"));
    assert.equal(infraReceipt.render_replay.status, REPLAY_STATUS.NOT_RUN);
    assert.equal(infraReceipt.runner.status, RUNNER_STATUS.INFRA_ERROR);
    assert.equal(infraReceipt.publication_effect, "BLOCK");
    assertBoundTargets(infraReceipt);

    const allowedStatuses = new Set(Object.values(REPLAY_STATUS));
    for (const receipt of [unavailableReceipt, installFailureReceipt, notRunReceipt, infraReceipt]) {
      assert.ok(allowedStatuses.has(receipt.render_replay.status));
      assert.ok(receipt.targets.every(target => allowedStatuses.has(target.render_replay.status)));
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
