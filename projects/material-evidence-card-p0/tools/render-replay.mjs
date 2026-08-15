import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PUBLICATION_EFFECT,
  REPLAY_RUNNER_VERSION,
  REPLAY_STATUS,
  RUNNER_STATUS,
  aggregateStatuses,
  applyDeclaredPassGate,
  buildBondPairs,
  buildSemanticPayload,
  canonicalJson,
  classifyReplayObservation,
  countElements,
  semanticDigest,
  sha256,
  summarizeReplayAttempts,
  validatePostReadyLayout,
  validateRuntimeReceipt,
  verifyReleaseIdentity
} from "./replay-core.mjs";

const RUNNER_VERSION = REPLAY_RUNNER_VERSION;
const VIEWPORT = Object.freeze({ width: 1440, height: 1100 });
const DEVICE_SCALE_FACTOR = 1;
const READY_TIMEOUT_MS = 8_000;
const ATTEMPT_COUNT = 2;
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(projectDir, "../..");
const projectPath = "projects/material-evidence-card-p0";
const require = createRequire(import.meta.url);

const HISTORICAL_TARGETS = Object.freeze([
  {
    fixture_id: "SYN-HEA-004",
    commit: "a26cf75ba065bc3e821522ea556102d0e62e3901",
    adapter: "LEGACY_PAUSE_RESET_V1"
  },
  {
    fixture_id: "SYN-HEA-005",
    commit: "c816e879dcf4f79832a1918a5a52da3f8096d03e",
    adapter: "LEGACY_PAUSE_RESET_V1"
  },
  {
    fixture_id: "SYN-HEA-006",
    commit: "a6f218c9cb560def2c90fcd858c8e84eca1fe7ca",
    adapter: "LEGACY_PAUSE_RESET_V1"
  }
]);

function parseArgs(argv) {
  const options = {
    output_dir: path.join(projectDir, "replay-artifacts"),
    explicit_skip: false,
    force_unavailable: process.env.MEC_REPLAY_FORCE_UNAVAILABLE === "1",
    force_infra_error: process.env.MEC_REPLAY_FORCE_INFRA_ERROR === "1",
    environment_unavailable: process.env.MEC_REPLAY_BROWSER_INSTALL_FAILED === "1",
    frozen_policy: false,
    active_only: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skip") options.explicit_skip = true;
    else if (argument === "--force-unavailable") options.force_unavailable = true;
    else if (argument === "--force-infra-error") options.force_infra_error = true;
    else if (argument === "--policy=frozen-v1") options.frozen_policy = true;
    else if (argument === "--active-only") options.active_only = true;
    else if (argument === "--output-dir") options.output_dir = path.resolve(argv[++index]);
    else throw new Error(`UNKNOWN_ARGUMENT:${argument}`);
  }
  return options;
}

async function writeReceipt(outputDir, receipt) {
  await mkdir(outputDir, { recursive: true });
  const receiptPath = path.join(outputDir, "render-replay-receipt.json");
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeFile(receiptPath, bytes);
  await writeFile(`${receiptPath}.sha256`, `${sha256(bytes)}  ${path.basename(receiptPath)}\n`, "utf8");
  return receiptPath;
}

function exitCodeFor(status, frozenPolicy, runnerStatus = RUNNER_STATUS.COMPLETED, effectiveStatus = status) {
  if (runnerStatus === RUNNER_STATUS.INFRA_ERROR) return 2;
  if (effectiveStatus === REPLAY_STATUS.FAIL) return 1;
  if (status === REPLAY_STATUS.PASS) return 0;
  if (frozenPolicy && [REPLAY_STATUS.UNAVAILABLE, REPLAY_STATUS.NOT_RUN].includes(status)) return 0;
  if (status === REPLAY_STATUS.FAIL) return 1;
  if (status === REPLAY_STATUS.UNAVAILABLE) return 3;
  if (status === REPLAY_STATUS.NOT_RUN) return 4;
  return 2;
}

function checkoutCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return process.env.GITHUB_SHA || "WORKTREE_FILE_HASH_BUNDLE";
  }
}

function launchErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|browser executable/i.test(message)) return "BROWSER_BINARY_MISSING";
  if (/missing dependencies|shared libraries|error while loading shared libraries/i.test(message)) return "OS_DEPENDENCY_MISSING";
  if (/sandbox|permission denied|operation not permitted/i.test(message)) return "BROWSER_SANDBOX_DENIED";
  return "BROWSER_LAUNCH_FAILED";
}

function gitShow(commit, relativePath) {
  return execFileSync("git", ["show", `${commit}:${projectPath}/${relativePath}`], {
    cwd: repoRoot,
    maxBuffer: 10 * 1024 * 1024
  });
}

async function materializeHistoricalTarget(target, tempRoot) {
  const targetDir = path.join(tempRoot, target.fixture_id);
  const files = [
    "index.html",
    "styles.css",
    "viewer.js",
    "manifest.json",
    `fixture/${target.fixture_id}.xyz`,
    `fixture/${target.fixture_id}.xyz.sha256`
  ];
  for (const relativePath of files) {
    const destination = path.join(targetDir, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, gitShow(target.commit, relativePath));
  }
  return targetDir;
}

function activeWorktreeCommit() {
  const baseCommit = checkoutCommit();
  try {
    const dirty = execFileSync(
      "git",
      ["status", "--porcelain", "--", projectPath, ".github/workflows/material-evidence-card-replay.yml"],
      { cwd: repoRoot, encoding: "utf8" }
    ).trim();
    return { commit: dirty ? "WORKTREE_FILE_HASH_BUNDLE" : baseCommit, checkout_base_commit: baseCommit };
  } catch {
    return { commit: "WORKTREE_FILE_HASH_BUNDLE", checkout_base_commit: baseCommit };
  }
}

async function targetPlan(options) {
  const activeManifest = JSON.parse(await readFile(path.join(projectDir, "manifest.json"), "utf8"));
  const activeCommit = activeWorktreeCommit();
  const historical = options.active_only ? [] : HISTORICAL_TARGETS;
  return [
    ...historical,
    {
      fixture_id: activeManifest.fixture_id,
      commit: activeCommit.commit,
      checkout_base_commit: activeCommit.checkout_base_commit,
      candidate_head_commit: process.env.MEC_REPLAY_HEAD_SHA || null,
      adapter: "NATIVE_REPLAY_V1"
    }
  ];
}

async function prepareTargets(targets, tempRoot) {
  const prepared = [];
  for (const target of targets) {
    const targetDir = target.adapter.startsWith("LEGACY")
      ? await materializeHistoricalTarget(target, tempRoot)
      : projectDir;
    prepared.push({ target, targetDir, subjectData: await loadSubject(targetDir, target) });
  }
  return prepared;
}

async function loadSubject(targetDir, target) {
  const manifestBytes = await readFile(path.join(targetDir, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const indexBytes = await readFile(path.join(targetDir, "index.html"));
  const stylesBytes = await readFile(path.join(targetDir, "styles.css"));
  const viewerBytes = await readFile(path.join(targetDir, "viewer.js"));
  const xyzBytes = await readFile(path.join(targetDir, manifest.structure_file));
  const sidecarBytes = await readFile(path.join(targetDir, `${manifest.structure_file}.sha256`));
  const identity = verifyReleaseIdentity({
    manifest,
    indexText: indexBytes.toString("utf8"),
    viewerText: viewerBytes.toString("utf8"),
    xyzBytes,
    sidecarText: sidecarBytes.toString("utf8"),
    expectedRunner: target.adapter === "NATIVE_REPLAY_V1" ? RUNNER_VERSION : null
  });

  return {
    manifest,
    identity,
    subject: {
      repository: "infinitus01/infinitus01",
      commit: target.commit,
      checkout_base_commit: target.checkout_base_commit || null,
      candidate_head_commit: target.candidate_head_commit || null,
      fixture_id: manifest.fixture_id,
      release: manifest.release,
      paths: {
        index: "index.html",
        styles: "styles.css",
        viewer: "viewer.js",
        manifest: "manifest.json",
        structure: manifest.structure_file,
        structure_sidecar: `${manifest.structure_file}.sha256`
      },
      file_sha256: {
        index: sha256(indexBytes),
        styles: sha256(stylesBytes),
        viewer: sha256(viewerBytes),
        manifest: sha256(manifestBytes),
        structure: sha256(xyzBytes),
        structure_sidecar: sha256(sidecarBytes)
      },
      structure_sha256: {
        expected: manifest.structure_sha256,
        computed: sha256(xyzBytes)
      }
    }
  };
}

function attachPageObservers(page) {
  const errors = { page: [], console: [], asset: [] };
  page.on("pageerror", error => errors.page.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  page.on("requestfailed", request => errors.asset.push({ url: request.url(), failure: request.failure()?.errorText || "UNKNOWN" }));
  return errors;
}

async function canvasDiagnostics(page, projectedAtoms = []) {
  return page.evaluate(points => {
    const canvasElement = document.getElementById("stage");
    const context = canvasElement?.getContext("2d");
    if (!canvasElement || !context || canvasElement.width < 1 || canvasElement.height < 1) {
      return {
        width: canvasElement?.width || 0,
        height: canvasElement?.height || 0,
        sampled_nontransparent_pixels: 0,
        projected_atom_centers_sampled: 0,
        projected_atom_centers_opaque: 0,
        blank: true
      };
    }
    const pixels = context.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
    let sampledNontransparentPixels = 0;
    for (let index = 3; index < pixels.length; index += 64) {
      if (pixels[index] !== 0) sampledNontransparentPixels += 1;
    }
    const rect = canvasElement.getBoundingClientRect();
    const scaleX = canvasElement.width / rect.width;
    const scaleY = canvasElement.height / rect.height;
    const validPoints = Array.isArray(points)
      ? points.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      : [];
    let opaqueAtomCenters = 0;
    for (const point of validPoints) {
      const x = Math.max(0, Math.min(canvasElement.width - 1, Math.round(point.x * scaleX)));
      const y = Math.max(0, Math.min(canvasElement.height - 1, Math.round(point.y * scaleY)));
      const alpha = pixels[(y * canvasElement.width + x) * 4 + 3];
      if (alpha >= 128) opaqueAtomCenters += 1;
    }
    return {
      width: canvasElement.width,
      height: canvasElement.height,
      sampled_nontransparent_pixels: sampledNontransparentPixels,
      projected_atom_centers_sampled: validPoints.length,
      projected_atom_centers_opaque: opaqueAtomCenters,
      blank: sampledNontransparentPixels < 100
        || (validPoints.length > 0 && opaqueAtomCenters !== validPoints.length)
    };
  }, projectedAtoms);
}

async function legacyRuntimeSnapshot(page, subjectData) {
  await page.locator("#spinBtn").click();
  await page.locator("#resetBtn").click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(({ viewerBuild, replayContract, expectedBondCutoff }) => {
    const rect = canvas.getBoundingClientRect();
    return {
      receipt_schema: "MEC_LEGACY_PAGE_OBSERVATION_V1",
      observation_status: "READY",
      viewer_build: viewerBuild,
      replay_contract: replayContract,
      source_mode: "EMBEDDED_COORDINATES",
      runtime_structure_hash_verified: false,
      transformation: "FIXED_TRANSLATION_ONLY",
      camera: { preset: "INITIAL_ISOMETRIC", rx, ry, zoom },
      representation: ["BALL_AND_STICK", "ATOMS_ONLY", "WIREFRAME"][mode],
      mode,
      spin,
      animation_loop: true,
      atom_count: atoms.length,
      element_counts: atoms.reduce((counts, atom) => {
        counts[atom.el] = (counts[atom.el] || 0) + 1;
        return counts;
      }, {}),
      ordered_atoms: atoms.map(({ el, x, y, z }) => ({ el, x, y, z })),
      bond_cutoff: expectedBondCutoff,
      bond_pairs: bonds.map(pair => [...pair]),
      draw_counts: { atom_draw_count: projected.length, bond_draw_count: bonds.length, bounds_edge_draw_count: edges.length },
      projected_atoms: projected.map(({ i, el, x, y, z, scale }) => ({ index: i, el, x, y, z, scale })),
      canvas_observation: {
        css_width: rect.width,
        css_height: rect.height,
        pixel_width: canvas.width,
        pixel_height: canvas.height,
        dpr: canvas.width / rect.width
      }
    };
  }, {
    viewerBuild: subjectData.manifest.artifact_checks.render_replay.viewer_build,
    replayContract: subjectData.manifest.artifact_checks.render_replay.replay_contract,
    expectedBondCutoff: subjectData.identity.bond_cutoff
  });
}

async function nativeRuntimeSnapshot(page) {
  await page.waitForFunction(() => ["READY", "ERROR"].includes(globalThis.__MEC_REPLAY__?.status), null, { timeout: READY_TIMEOUT_MS });
  const state = await page.evaluate(() => ({
    status: globalThis.__MEC_REPLAY__.status,
    error: globalThis.__MEC_REPLAY__.getError(),
    receipt: globalThis.__MEC_REPLAY__.getReceipt()
  }));
  if (state.status !== "READY") throw new Error(`PAGE_REPLAY_ERROR:${state.error?.code || "UNKNOWN"}`);
  return state.receipt;
}

function runtimeMismatch(runtime, subjectData, nativeMode) {
  const expected = subjectData.identity.viewer_atoms;
  const expectedBonds = buildBondPairs(expected, subjectData.identity.bond_cutoff);
  const camera = runtime.camera;
  const canvas = runtime.canvas_observation;
  const expectedReplay = subjectData.manifest.artifact_checks.render_replay;
  return {
    camera_mismatch: camera.preset !== "INITIAL_ISOMETRIC"
      || Math.abs(camera.rx - (-0.52)) > 1e-12
      || Math.abs(camera.ry - 0.67) > 1e-12
      || Math.abs(camera.zoom - 1) > 1e-12,
    representation_mismatch: runtime.representation !== "BALL_AND_STICK" || runtime.mode !== 0,
    viewer_build_mismatch: runtime.viewer_build !== expectedReplay.viewer_build,
    replay_contract_mismatch: runtime.replay_contract !== expectedReplay.replay_contract,
    source_mode_mismatch: runtime.source_mode !== "EMBEDDED_COORDINATES",
    transformation_mismatch: runtime.transformation !== "FIXED_TRANSLATION_ONLY",
    runtime_hash_authority_mismatch: runtime.runtime_structure_hash_verified !== false,
    layout_guard_mismatch: nativeMode && canonicalJson(runtime.post_ready_layout_guard) !== canonicalJson(expectedReplay.post_ready_layout_guard),
    spin_enabled: runtime.spin !== false,
    unexpected_animation_loop: nativeMode && runtime.animation_loop !== false,
    atom_mismatch: canonicalJson(runtime.ordered_atoms) !== canonicalJson(expected),
    bond_cutoff_mismatch: Math.abs(runtime.bond_cutoff - subjectData.identity.bond_cutoff) > 1e-12,
    count_mismatch: runtime.atom_count !== expected.length
      || canonicalJson(runtime.element_counts) !== canonicalJson(countElements(expected))
      || canonicalJson(countElements(runtime.ordered_atoms)) !== canonicalJson(countElements(expected)),
    draw_mismatch: runtime.draw_counts?.atom_draw_count !== expected.length
      || runtime.draw_counts?.bond_draw_count !== expectedBonds.length
      || runtime.draw_counts?.bounds_edge_draw_count !== 12,
    canvas_mismatch: Math.abs(canvas.pixel_width - Math.round(canvas.css_width * canvas.dpr)) > 1
      || Math.abs(canvas.pixel_height - Math.round(canvas.css_height * canvas.dpr)) > 1,
    projection_mismatch: runtime.projected_atoms.length !== expected.length,
    bond_mismatch: canonicalJson(runtime.bond_pairs) !== canonicalJson(expectedBonds)
  };
}

async function runAttempt(browser, targetDir, target, subjectData, attemptNumber, outputDir) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  const errors = attachPageObservers(page);
  const nativeMode = target.adapter === "NATIVE_REPLAY_V1";
  const url = pathToFileURL(path.join(targetDir, "index.html"));
  if (nativeMode) url.searchParams.set("replay", "1");
  let runtime;
  let readyTimeout = false;
  let runtimeError = null;
  let postObservation = null;
  let postObservationInvalidated = false;
  let runtimeValidation = null;
  const diagnosticErrors = [];

  try {
    await page.goto(url.href, { waitUntil: "load", timeout: READY_TIMEOUT_MS });
    runtime = nativeMode
      ? await nativeRuntimeSnapshot(page)
      : await legacyRuntimeSnapshot(page, subjectData);
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
    readyTimeout = /Timeout|READY_TIMEOUT/i.test(runtimeError);
  }

  if (runtime) {
    runtimeValidation = validateRuntimeReceipt(runtime, subjectData.identity.viewer_atoms, { nativeMode });
  }
  const diagnostics = await canvasDiagnostics(page, runtime?.projected_atoms).catch(() => ({
    width: 0,
    height: 0,
    sampled_nontransparent_pixels: 0,
    projected_atom_centers_sampled: 0,
    projected_atom_centers_opaque: 0,
    blank: true
  }));
  let screenshotSha256 = null;
  try {
    const screenshotPath = path.join(outputDir, `${target.fixture_id}-${target.adapter}-attempt-${attemptNumber}.png`);
    const screenshotBase64 = await page.evaluate(() => {
      const canvasElement = document.getElementById("stage");
      if (!(canvasElement instanceof HTMLCanvasElement)) throw new Error("CANVAS_SCREENSHOT_SOURCE_MISSING");
      return canvasElement.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
    });
    const screenshotBytes = Buffer.from(screenshotBase64, "base64");
    if (!screenshotBytes.length) throw new Error("CANVAS_SCREENSHOT_EMPTY");
    await writeFile(screenshotPath, screenshotBytes);
    screenshotSha256 = sha256(screenshotBytes);
  } catch (error) {
    diagnosticErrors.push(`SCREENSHOT_FAILED:${error instanceof Error ? error.message : String(error)}`);
  }

  if (nativeMode && runtime) {
    postObservation = await page.evaluate(() => {
      const spinButton = document.getElementById("spinBtn");
      const canvasElement = document.getElementById("stage");
      const rect = canvasElement?.getBoundingClientRect();
      const transform = canvasElement?.getContext("2d")?.getTransform();
      const replayDprX = transform?.a;
      const replayDprY = transform?.d;
      return {
        status: globalThis.__MEC_REPLAY__?.status || null,
        receipt: globalThis.__MEC_REPLAY__?.getReceipt?.() || null,
        error: globalThis.__MEC_REPLAY__?.getError?.() || null,
        canvas_layout: canvasElement && rect ? {
          css_width: rect.width,
          css_height: rect.height,
          pixel_width: canvasElement.width,
          pixel_height: canvasElement.height,
          replay_dpr_x: replayDprX,
          replay_dpr_y: replayDprY,
          device_pixel_ratio: globalThis.devicePixelRatio || 1,
          expected_pixel_width: Math.round(rect.width * replayDprX),
          expected_pixel_height: Math.round(rect.height * replayDprY),
          viewport_width: globalThis.innerWidth,
          viewport_height: globalThis.innerHeight,
          scroll_x: globalThis.scrollX,
          scroll_y: globalThis.scrollY
        } : null,
        ui: {
          spin_button_disabled: spinButton?.disabled === true,
          spin_button_active: spinButton?.classList.contains("active") === true,
          spin_button_text: spinButton?.textContent || null
        }
      };
    }).catch(error => ({ status: "EVALUATION_ERROR", receipt: null, ui: null, error: String(error) }));
    if (postObservation.status !== "READY" || canonicalJson(postObservation.receipt) !== canonicalJson(runtime)) {
      postObservationInvalidated = true;
      errors.page.push(`NATIVE_REPLAY_STATE_INVALIDATED_AFTER_OBSERVATION:${postObservation.error?.code || postObservation.status || "UNKNOWN"}`);
    }
  }

  let mismatches = {};
  if (runtimeValidation?.valid) {
    try {
      mismatches = runtimeMismatch(runtime, subjectData, nativeMode);
      mismatches.canvas_mismatch = mismatches.canvas_mismatch
        || diagnostics.width !== runtime.canvas_observation.pixel_width
        || diagnostics.height !== runtime.canvas_observation.pixel_height;
      mismatches.projection_mismatch = mismatches.projection_mismatch
        || diagnostics.projected_atom_centers_sampled !== runtime.projected_atoms.length;
      if (nativeMode) {
        const postLayoutValidation = validatePostReadyLayout(
          runtime.canvas_observation,
          postObservation?.canvas_layout,
          runtime.post_ready_layout_guard
        );
        mismatches.post_observation_layout_mismatch = !postLayoutValidation.valid;
        postObservation.layout_validation = postLayoutValidation;
      }
    } catch (error) {
      runtimeValidation = {
        valid: false,
        errors: [`RUNTIME_ASSERTION_ERROR:${error instanceof Error ? error.message : String(error)}`]
      };
      mismatches = {};
    }
  }
  if (runtime && !runtimeValidation?.valid) mismatches.page_receipt_invalid = true;
  if (nativeMode) {
    mismatches.replay_ui_mismatch = !postObservation?.ui?.spin_button_disabled
      || postObservation.ui.spin_button_active
      || postObservation.ui.spin_button_text !== "Replay view locked";
  }
  const semanticPayload = runtimeValidation?.valid ? {
    subject_file_sha256: subjectData.subject.file_sha256,
    structure_sha256: subjectData.subject.structure_sha256.computed,
    runtime: buildSemanticPayload(runtime)
  } : null;
  const observation = {
    browser_launched: true,
    ready_timeout: readyTimeout,
    page_errors: runtimeError ? [runtimeError, ...errors.page] : errors.page,
    console_errors: errors.console,
    asset_errors: errors.asset,
    blank_canvas: diagnostics.blank,
    post_observation_invalidated: postObservationInvalidated,
    ...mismatches
  };
  const classification = classifyReplayObservation(observation);
  await context.close();

  return {
    attempt: attemptNumber,
    ready_signal: runtimeValidation?.valid === true && runtime.observation_status === "READY",
    status: classification.status,
    classification_code: classification.classification_code,
    errors,
    diagnostic_errors: diagnosticErrors,
    runtime_error: runtimeError,
    runtime_validation: runtimeValidation,
    assertions: mismatches,
    semantic_digest: semanticPayload ? semanticDigest(semanticPayload) : null,
    canvas_diagnostics: diagnostics,
    screenshot_sha256: screenshotSha256,
    pixel_identity_gate: false,
    runtime_observation: runtime,
    post_observation: postObservation
  };
}

function unexecutedTarget(target, subjectData, requestedStatus, classificationCode) {
  const preflightPassed = subjectData.identity.status === REPLAY_STATUS.PASS;
  const renderStatus = preflightPassed ? requestedStatus : REPLAY_STATUS.NOT_RUN;
  const effectiveStatus = preflightPassed ? requestedStatus : REPLAY_STATUS.FAIL;
  return {
    observation_timing: target.adapter.startsWith("LEGACY") ? "RETROSPECTIVE" : "POST_RELEASE_PATCH",
    subject: subjectData.subject,
    adapter: target.adapter,
    preflight_checks: subjectData.identity,
    attempts: [],
    comparison: { semantic_digest_equal: null },
    render_replay: {
      status: renderStatus,
      classification_code: preflightPassed ? classificationCode : "PREFLIGHT_FAILED",
      reason: preflightPassed
        ? "Browser replay was not executed for this bound target."
        : "Deterministic identity preflight failed before browser replay."
    },
    effective_status: effectiveStatus,
    publication_effect: preflightPassed ? PUBLICATION_EFFECT[requestedStatus] : PUBLICATION_EFFECT.FAIL,
    release_time_status: target.adapter.startsWith("LEGACY") ? "UNAVAILABLE" : null,
    supersedes_release_record: false
  };
}

async function runTarget(browser, targetDir, target, outputDir, subjectData = null) {
  subjectData ||= await loadSubject(targetDir, target);
  if (subjectData.identity.status !== REPLAY_STATUS.PASS) {
    return unexecutedTarget(target, subjectData, REPLAY_STATUS.NOT_RUN, "PREFLIGHT_FAILED");
  }

  const attempts = [];
  for (let number = 1; number <= ATTEMPT_COUNT; number += 1) {
    attempts.push(await runAttempt(browser, targetDir, target, subjectData, number, outputDir));
  }
  const digestEqual = attempts.every(attempt => attempt.semantic_digest)
    && attempts.every(attempt => attempt.semantic_digest === attempts[0].semantic_digest);
  const comparisonClassification = summarizeReplayAttempts(attempts, digestEqual);
  const status = comparisonClassification.status;

  return {
    observation_timing: target.adapter.startsWith("LEGACY") ? "RETROSPECTIVE" : "POST_RELEASE_PATCH",
    subject: subjectData.subject,
    adapter: target.adapter,
    preflight_checks: subjectData.identity,
    contract: {
      camera: { preset: "INITIAL_ISOMETRIC", rx: -0.52, ry: 0.67, zoom: 1 },
      representation: "BALL_AND_STICK",
      viewport: VIEWPORT,
      device_scale_factor: DEVICE_SCALE_FACTOR,
      replay_attempts: ATTEMPT_COUNT,
      pixel_identity_claimed: false
    },
    attempts,
    comparison: { semantic_digest_equal: digestEqual, digest: digestEqual ? attempts[0].semantic_digest : null },
    render_replay: { status, classification_code: comparisonClassification.classification_code },
    effective_status: status,
    publication_effect: PUBLICATION_EFFECT[status],
    release_time_status: target.adapter.startsWith("LEGACY") ? "UNAVAILABLE" : null,
    observed_now: status,
    supersedes_release_record: false
  };
}

async function baseReceipt(environment = {}) {
  const runnerFiles = {
    render_replay: path.join(projectDir, "tools", "render-replay.mjs"),
    replay_core: path.join(projectDir, "tools", "replay-core.mjs"),
    release_validator: path.join(projectDir, "tools", "validate-release.mjs"),
    policy_tests: path.join(projectDir, "tests", "replay-policy.test.mjs"),
    package: path.join(projectDir, "package.json"),
    package_lock: path.join(projectDir, "package-lock.json"),
    workflow: path.join(repoRoot, ".github", "workflows", "material-evidence-card-replay.yml")
  };
  const runnerFileSha256 = Object.fromEntries(await Promise.all(
    Object.entries(runnerFiles).map(async ([name, filePath]) => [name, sha256(await readFile(filePath))])
  ));
  return {
    receipt_schema: "MEC_RENDER_REPLAY_RECEIPT_V1",
    generated_at: new Date().toISOString(),
    runner: { name: RUNNER_VERSION, status: RUNNER_STATUS.COMPLETED, file_sha256: runnerFileSha256 },
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      ci: Boolean(process.env.CI),
      github_sha: process.env.GITHUB_SHA || null,
      github_head_sha: process.env.MEC_REPLAY_HEAD_SHA || null,
      github_run_id: process.env.GITHUB_RUN_ID || null,
      github_run_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
      ...environment
    },
    authority_boundary: {
      scientific_validation: "NOT_ASSESSED",
      scientific_claim_status: "NONE",
      decision_usable: false,
      signature_or_render_validity_is_execution_truth: false,
      retroactive_release_status_changed: false
    },
    requested_targets: [],
    targets: [],
    declared_active_render_status: null,
    declared_status_gate: null
  };
}

async function finalize(options, receipt, {
  renderStatus,
  effectiveStatus = renderStatus,
  classificationCode,
  runnerStatus = RUNNER_STATUS.COMPLETED,
  publicationEffect = runnerStatus === RUNNER_STATUS.INFRA_ERROR || effectiveStatus === REPLAY_STATUS.FAIL
    ? "BLOCK"
    : PUBLICATION_EFFECT[renderStatus]
}) {
  const declaredGate = applyDeclaredPassGate({
    declaredStatus: receipt.declared_active_render_status,
    observedStatus: renderStatus,
    effectiveStatus,
    runnerStatus,
    publicationEffect
  });
  effectiveStatus = declaredGate.effective_status;
  publicationEffect = declaredGate.publication_effect;
  receipt.declared_status_gate = {
    declared_status: receipt.declared_active_render_status,
    observed_status: renderStatus,
    authoritative_pass_required: receipt.declared_active_render_status === REPLAY_STATUS.PASS,
    blocked: declaredGate.blocked
  };
  receipt.runner.status = runnerStatus;
  receipt.runner.classification_code = runnerStatus === RUNNER_STATUS.INFRA_ERROR ? classificationCode : null;
  receipt.render_replay = {
    status: renderStatus,
    classification_code: classificationCode,
    publication_effect: publicationEffect
  };
  receipt.effective_status = runnerStatus === RUNNER_STATUS.INFRA_ERROR ? RUNNER_STATUS.INFRA_ERROR : effectiveStatus;
  receipt.publication_effect = publicationEffect;
  receipt.canonical_payload_sha256 = semanticDigest({
    runner: receipt.runner,
    environment: receipt.environment,
    authority_boundary: receipt.authority_boundary,
    requested_targets: receipt.requested_targets,
    targets: receipt.targets,
    declared_active_render_status: receipt.declared_active_render_status,
    declared_status_gate: receipt.declared_status_gate,
    render_replay: receipt.render_replay,
    effective_status: receipt.effective_status,
    publication_effect: receipt.publication_effect
  });
  const receiptPath = await writeReceipt(options.output_dir, receipt);
  process.stdout.write(`${JSON.stringify({
    receipt: receiptPath,
    render_status: renderStatus,
    runner_status: runnerStatus,
    effective_status: receipt.effective_status,
    classification_code: classificationCode,
    publication_effect: publicationEffect
  }, null, 2)}\n`);
  if (options.frozen_policy && [REPLAY_STATUS.UNAVAILABLE, REPLAY_STATUS.NOT_RUN].includes(renderStatus)
    && publicationEffect !== "BLOCK") {
    process.stdout.write(`::warning title=Material Evidence Card replay ${renderStatus}::${classificationCode}\n`);
  }
  process.exitCode = exitCodeFor(renderStatus, options.frozen_policy, runnerStatus, effectiveStatus);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.output_dir, { recursive: true });
  const receipt = await baseReceipt();
  let browser;
  let tempRoot;
  try {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mec-replay-"));
    const targets = await targetPlan(options);
    receipt.requested_targets = targets.map(target => ({
      fixture_id: target.fixture_id,
      commit: target.commit,
      checkout_base_commit: target.checkout_base_commit || null,
      candidate_head_commit: target.candidate_head_commit || null,
      adapter: target.adapter
    }));
    const prepared = await prepareTargets(targets, tempRoot);
    receipt.declared_active_render_status = prepared.at(-1)?.subjectData.manifest.artifact_checks?.render_replay?.status || null;
    const preflightFailed = prepared.some(item => item.subjectData.identity.status !== REPLAY_STATUS.PASS);
    if (preflightFailed) {
      receipt.targets = prepared.map(({ target, subjectData }) => unexecutedTarget(
        target,
        subjectData,
        REPLAY_STATUS.NOT_RUN,
        "PREFLIGHT_FAILED"
      ));
      await finalize(options, receipt, {
        renderStatus: REPLAY_STATUS.NOT_RUN,
        effectiveStatus: REPLAY_STATUS.FAIL,
        classificationCode: "ONE_OR_MORE_TARGET_PREFLIGHTS_FAILED"
      });
      return;
    }

    const finalizeUnexecuted = async (status, classificationCode) => {
      receipt.targets = prepared.map(({ target, subjectData }) => unexecutedTarget(target, subjectData, status, classificationCode));
      await finalize(options, receipt, { renderStatus: status, classificationCode });
    };

    if (options.explicit_skip) {
      receipt.environment.browser_launch_attempted = false;
      receipt.environment.browser_launched = false;
      await finalizeUnexecuted(REPLAY_STATUS.NOT_RUN, "EXPLICITLY_SKIPPED");
      return;
    }
    if (options.force_infra_error) {
      receipt.environment.negative_control = true;
      receipt.environment.browser_launch_attempted = false;
      receipt.environment.browser_launched = false;
      receipt.targets = prepared.map(({ target, subjectData }) => unexecutedTarget(
        target,
        subjectData,
        REPLAY_STATUS.NOT_RUN,
        "FORCED_RUNNER_INFRA_ERROR_CONTROL"
      ));
      await finalize(options, receipt, {
        renderStatus: REPLAY_STATUS.NOT_RUN,
        classificationCode: "FORCED_RUNNER_INFRA_ERROR_CONTROL",
        runnerStatus: RUNNER_STATUS.INFRA_ERROR
      });
      return;
    }
    if (options.environment_unavailable) {
      receipt.environment.browser_install_attempted = true;
      receipt.environment.browser_install_succeeded = false;
      receipt.environment.browser_launch_attempted = false;
      receipt.environment.browser_launched = false;
      await finalizeUnexecuted(REPLAY_STATUS.UNAVAILABLE, "BROWSER_INSTALL_FAILED");
      return;
    }
    if (options.force_unavailable) {
      receipt.environment.negative_control = true;
      receipt.environment.browser_launch_attempted = false;
      receipt.environment.browser_launched = false;
      await finalizeUnexecuted(REPLAY_STATUS.UNAVAILABLE, "FORCED_UNAVAILABLE_CONTROL");
      return;
    }

    let chromium;
    let playwrightVersion;
    try {
      ({ chromium } = await import("playwright"));
      playwrightVersion = require("playwright/package.json").version;
    } catch (error) {
      receipt.environment.dependency_error = error instanceof Error ? error.message : String(error);
      receipt.environment.browser_launch_attempted = false;
      receipt.environment.browser_launched = false;
      receipt.targets = prepared.map(({ target, subjectData }) => unexecutedTarget(
        target,
        subjectData,
        REPLAY_STATUS.NOT_RUN,
        "PLAYWRIGHT_DEPENDENCY_UNAVAILABLE"
      ));
      await finalize(options, receipt, {
        renderStatus: REPLAY_STATUS.NOT_RUN,
        classificationCode: "PLAYWRIGHT_DEPENDENCY_UNAVAILABLE",
        runnerStatus: RUNNER_STATUS.INFRA_ERROR
      });
      return;
    }

    const launchOptions = { headless: true };
    if (process.env.MEC_REPLAY_BROWSER_PATH) launchOptions.executablePath = process.env.MEC_REPLAY_BROWSER_PATH;
    receipt.environment.browser_launch_attempted = true;
    try {
      browser = await chromium.launch(launchOptions);
      receipt.environment.playwright = playwrightVersion;
      receipt.environment.chromium = browser.version();
      receipt.environment.browser_launched = true;
    } catch (error) {
      const code = launchErrorCode(error);
      receipt.environment.playwright = playwrightVersion;
      receipt.environment.browser_launched = false;
      receipt.environment.browser_launch_error = error instanceof Error ? error.message : String(error);
      await finalizeUnexecuted(REPLAY_STATUS.UNAVAILABLE, code);
      return;
    }

    for (const { target, targetDir, subjectData } of prepared) {
      receipt.targets.push(await runTarget(browser, targetDir, target, options.output_dir, subjectData));
    }

    const renderStatus = aggregateStatuses(receipt.targets.map(target => target.render_replay.status));
    const effectiveStatus = aggregateStatuses(receipt.targets.map(target => target.effective_status));
    const code = effectiveStatus === REPLAY_STATUS.PASS
      ? "ALL_TARGETS_REPLAY_VERIFIED"
      : "ONE_OR_MORE_TARGETS_NOT_VERIFIED";
    await finalize(options, receipt, { renderStatus, effectiveStatus, classificationCode: code });
  } catch (error) {
    receipt.infrastructure_error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    await finalize(options, receipt, {
      renderStatus: REPLAY_STATUS.NOT_RUN,
      classificationCode: "RUNNER_INFRASTRUCTURE_ERROR",
      runnerStatus: RUNNER_STATUS.INFRA_ERROR
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
