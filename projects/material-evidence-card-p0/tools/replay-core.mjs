import { createHash } from "node:crypto";

export const REPLAY_STATUS = Object.freeze({
  NOT_RUN: "NOT_RUN",
  PASS: "PASS",
  FAIL: "FAIL",
  UNAVAILABLE: "UNAVAILABLE"
});

export const RUNNER_STATUS = Object.freeze({
  COMPLETED: "COMPLETED",
  INFRA_ERROR: "INFRA_ERROR"
});

export const REPLAY_RUNNER_VERSION = "mec-render-replay/1.0.3";

export const PUBLICATION_EFFECT = Object.freeze({
  NOT_RUN: "ALLOW_WITH_DISCLOSED_LIMIT",
  PASS: "ALLOW",
  FAIL: "BLOCK",
  UNAVAILABLE: "ALLOW_WITH_DISCLOSED_LIMIT"
});

export function applyDeclaredPassGate({
  declaredStatus,
  observedStatus,
  effectiveStatus = observedStatus,
  runnerStatus = RUNNER_STATUS.COMPLETED,
  publicationEffect = PUBLICATION_EFFECT[observedStatus]
}) {
  const blocked = declaredStatus === REPLAY_STATUS.PASS
    && (observedStatus !== REPLAY_STATUS.PASS
      || effectiveStatus !== REPLAY_STATUS.PASS
      || runnerStatus !== RUNNER_STATUS.COMPLETED);
  return {
    blocked,
    effective_status: blocked ? REPLAY_STATUS.FAIL : effectiveStatus,
    publication_effect: blocked ? "BLOCK" : publicationEffect
  };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function semanticDigest(value) {
  return sha256(canonicalJson(value));
}

export function countElements(atoms) {
  return Object.fromEntries(
    Object.entries(atoms.reduce((counts, atom) => {
      counts[atom.el] = (counts[atom.el] || 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function parseXyz(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const declaredAtomCount = Number.parseInt(lines[0], 10);
  if (!Number.isInteger(declaredAtomCount) || declaredAtomCount < 1) {
    throw new Error("XYZ_ATOM_COUNT_INVALID");
  }

  const spacingMatch = (lines[1] || "").match(/display spacing=([0-9]+(?:\.[0-9]+)?) A/);
  const atoms = lines.slice(2).filter(line => line.trim()).map((line, index) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error(`XYZ_ATOM_INVALID:${index + 1}`);
    const coordinates = fields.slice(1).map(Number);
    if (coordinates.some(value => !Number.isFinite(value))) {
      throw new Error(`XYZ_COORDINATE_INVALID:${index + 1}`);
    }
    return { el: fields[0], x: coordinates[0], y: coordinates[1], z: coordinates[2] };
  });
  if (atoms.length !== declaredAtomCount) throw new Error("XYZ_ATOM_COUNT_MISMATCH");

  return {
    declared_atom_count: declaredAtomCount,
    comment: lines[1] || "",
    display_spacing_angstrom: spacingMatch ? Number(spacingMatch[1]) : null,
    atoms,
    element_counts: countElements(atoms)
  };
}

export function parseSidecar(text) {
  const match = String(text).trim().match(/^([a-f0-9]{64})\s+([^\s]+)$/);
  if (!match) throw new Error("SHA256_SIDECAR_INVALID");
  return { sha256: match[1], filename: match[2] };
}

export function verifyFrozenFixturePair({ currentXyz, currentSidecar, baselineXyz, baselineSidecar }) {
  const currentXyzBytes = Buffer.from(currentXyz);
  const currentSidecarBytes = Buffer.from(currentSidecar);
  const baselineXyzBytes = Buffer.from(baselineXyz);
  const baselineSidecarBytes = Buffer.from(baselineSidecar);
  const xyzPreserved = currentXyzBytes.equals(baselineXyzBytes);
  const sidecarPreserved = currentSidecarBytes.equals(baselineSidecarBytes);
  return {
    status: xyzPreserved && sidecarPreserved ? REPLAY_STATUS.PASS : REPLAY_STATUS.FAIL,
    xyz_preserved: xyzPreserved,
    sidecar_preserved: sidecarPreserved,
    current_xyz_sha256: sha256(currentXyzBytes),
    baseline_xyz_sha256: sha256(baselineXyzBytes),
    current_sidecar_sha256: sha256(currentSidecarBytes),
    baseline_sidecar_sha256: sha256(baselineSidecarBytes)
  };
}

export function validateFixtureGrowth({ fixtureNames, frozenFixtureNames, activeFixtureName }) {
  const unpinnedFixtureNames = fixtureNames.filter(fixtureName => !frozenFixtureNames.includes(fixtureName));
  const expectedNextFixtureName = `SYN-HEA-${String(frozenFixtureNames.length + 1).padStart(3, "0")}.xyz`;
  const frozenFixturesPresent = frozenFixtureNames.every(fixtureName => fixtureNames.includes(fixtureName));
  const additionAllowed = unpinnedFixtureNames.length === 0
    ? activeFixtureName === frozenFixtureNames.at(-1)
    : (unpinnedFixtureNames.length === 1
      && unpinnedFixtureNames[0] === expectedNextFixtureName
      && activeFixtureName === expectedNextFixtureName);
  return {
    allowed: frozenFixturesPresent && additionAllowed,
    frozen_fixtures_present: frozenFixturesPresent,
    unpinned_fixtures: unpinnedFixtureNames,
    allowed_next_fixture: expectedNextFixtureName,
    active_fixture: activeFixtureName,
    addition_allowed: additionAllowed
  };
}

export function parseEmbeddedAtoms(viewerSource) {
  const match = String(viewerSource).match(/const atoms\s*=\s*(\[[^\n]+\]);/);
  if (!match) throw new Error("VIEWER_EMBEDDED_ATOMS_MISSING");
  const atoms = JSON.parse(match[1]);
  if (!Array.isArray(atoms) || !atoms.length) throw new Error("VIEWER_EMBEDDED_ATOMS_INVALID");
  return atoms;
}

export function parseBondCutoff(viewerSource) {
  const source = String(viewerSource);
  const constantMatch = source.match(/const BOND_CUTOFF\s*=\s*([0-9]+(?:\.[0-9]+)?)/);
  const inlineMatch = source.match(/if\(d<([0-9]+(?:\.[0-9]+)?)\)bonds\.push/);
  const cutoff = Number(constantMatch?.[1] || inlineMatch?.[1]);
  if (!Number.isFinite(cutoff) || cutoff <= 0) throw new Error("VIEWER_BOND_CUTOFF_INVALID");
  return cutoff;
}

export function buildBondPairs(atoms, cutoff) {
  if (!Array.isArray(atoms) || !Number.isFinite(cutoff) || cutoff <= 0) {
    throw new Error("BOND_PAIR_INPUT_INVALID");
  }
  const pairs = [];
  for (let left = 0; left < atoms.length; left += 1) {
    for (let right = left + 1; right < atoms.length; right += 1) {
      const a = atoms[left];
      const b = atoms[right];
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < cutoff) pairs.push([left, right]);
    }
  }
  return pairs;
}

export function uniformTranslation(viewerAtoms, xyzAtoms, tolerance = 1e-9) {
  if (viewerAtoms.length !== xyzAtoms.length) throw new Error("VIEWER_XYZ_ATOM_COUNT_MISMATCH");
  const translation = ["x", "y", "z"].map(axis => viewerAtoms[0][axis] - xyzAtoms[0][axis]);
  for (let index = 0; index < viewerAtoms.length; index += 1) {
    if (viewerAtoms[index].el !== xyzAtoms[index].el) throw new Error("VIEWER_XYZ_ELEMENT_ORDER_MISMATCH");
    for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
      const axis = ["x", "y", "z"][axisIndex];
      const difference = viewerAtoms[index][axis] - xyzAtoms[index][axis];
      if (Math.abs(difference - translation[axisIndex]) > tolerance) {
        throw new Error("VIEWER_XYZ_NON_UNIFORM_TRANSLATION");
      }
    }
  }
  return translation.map(value => Number(value.toFixed(12)));
}

function check(name, passed, detail) {
  return { name, status: passed ? REPLAY_STATUS.PASS : REPLAY_STATUS.FAIL, detail };
}

export function verifyReleaseIdentity({ manifest, indexText, viewerText, xyzBytes, sidecarText, expectedRunner = null }) {
  const checks = [];
  let parsed;
  let sidecar;
  let viewerAtoms;
  let bondCutoff;
  let translation;

  try {
    parsed = parseXyz(xyzBytes);
    sidecar = parseSidecar(sidecarText);
    viewerAtoms = parseEmbeddedAtoms(viewerText);
    bondCutoff = parseBondCutoff(viewerText);
    translation = uniformTranslation(viewerAtoms, parsed.atoms);
  } catch (error) {
    return {
      status: REPLAY_STATUS.FAIL,
      classification_code: error instanceof Error ? error.message : String(error),
      checks
    };
  }

  const computedSha256 = sha256(xyzBytes);
  const fixtureFilename = manifest.structure_file.split("/").at(-1);
  const componentCounts = Object.fromEntries(
    Object.entries(manifest.nominal_atomic_composition.components)
      .map(([element, record]) => [element, record.display_atom_count])
      .sort(([left], [right]) => left.localeCompare(right))
  );

  checks.push(check("MANIFEST_FIXTURE_PATH", fixtureFilename === `${manifest.fixture_id}.xyz`, { fixtureFilename }));
  checks.push(check("SIDECAR_FILENAME", sidecar.filename === fixtureFilename, { sidecarFilename: sidecar.filename }));
  checks.push(check("XYZ_SHA256", computedSha256 === manifest.structure_sha256 && computedSha256 === sidecar.sha256, {
    expected: manifest.structure_sha256,
    sidecar: sidecar.sha256,
    computed: computedSha256
  }));
  checks.push(check("XYZ_ATOM_COUNT", parsed.declared_atom_count === manifest.atom_count, {
    manifest: manifest.atom_count,
    parsed: parsed.declared_atom_count
  }));
  checks.push(check("COMPOSITION_COUNTS", canonicalJson(parsed.element_counts) === canonicalJson(componentCounts), {
    manifest: componentCounts,
    parsed: parsed.element_counts
  }));
  checks.push(check("VIEWER_ATOM_COUNT", viewerAtoms.length === parsed.atoms.length, { viewer: viewerAtoms.length, xyz: parsed.atoms.length }));
  checks.push(check("VIEWER_BOND_CUTOFF", Number.isFinite(bondCutoff) && bondCutoff > 0, { bond_cutoff: bondCutoff }));
  checks.push(check("VIEWER_XYZ_TRANSLATION", true, { translation_angstrom: translation }));
  checks.push(check("INDEX_FIXTURE_ID", indexText.includes(manifest.fixture_id), { fixture_id: manifest.fixture_id }));
  checks.push(check("INDEX_STRUCTURE_SHA256", indexText.includes(manifest.structure_sha256), { sha256: manifest.structure_sha256 }));
  const renderStatus = manifest.artifact_checks?.render_replay?.status;
  const allowedRenderStatuses = Object.values(REPLAY_STATUS);
  checks.push(check("ARTIFACT_STATUS_ENUM", canonicalJson(manifest.artifact_check_status_enum) === canonicalJson(allowedRenderStatuses), {
    declared: manifest.artifact_check_status_enum,
    required: allowedRenderStatuses
  }));
  checks.push(check("RENDER_REPLAY_STATUS_ENUM", allowedRenderStatuses.includes(renderStatus), {
    status: renderStatus,
    allowed: allowedRenderStatuses
  }));
  if (expectedRunner) {
    checks.push(check("RENDER_REPLAY_RUNNER_VERSION", manifest.artifact_checks?.render_replay?.runner === expectedRunner, {
      declared: manifest.artifact_checks?.render_replay?.runner || null,
      expected: expectedRunner
    }));
  }
  const evidenceReceipt = manifest.artifact_checks?.render_replay?.evidence_receipt;
  const sha256Pattern = /^[a-f0-9]{64}$/;
  const commitPattern = /^[a-f0-9]{40}$/;
  const passEvidenceValid = renderStatus !== REPLAY_STATUS.PASS || (
    isRecord(evidenceReceipt)
    && evidenceReceipt.receipt_schema === "MEC_RENDER_REPLAY_RECEIPT_V1"
    && evidenceReceipt.observed_status === REPLAY_STATUS.PASS
    && /^mec-render-replay\/\d+\.\d+\.\d+$/.test(evidenceReceipt.runner)
    && /^\d+$/.test(evidenceReceipt.github_run_id)
    && Number.isInteger(evidenceReceipt.github_run_attempt)
    && evidenceReceipt.github_run_attempt > 0
    && commitPattern.test(evidenceReceipt.checkout_commit_sha)
    && commitPattern.test(evidenceReceipt.candidate_head_sha)
    && /^\d+$/.test(evidenceReceipt.artifact_id)
    && typeof evidenceReceipt.artifact_name === "string"
    && evidenceReceipt.artifact_name.length > 0
    && evidenceReceipt.exact_commit_rerun_required === true
    && sha256Pattern.test(evidenceReceipt.artifact_archive_sha256)
    && sha256Pattern.test(evidenceReceipt.receipt_sha256)
    && sha256Pattern.test(evidenceReceipt.canonical_payload_sha256)
  );
  checks.push(check("RENDER_REPLAY_PASS_EVIDENCE", passEvidenceValid, {
    required: renderStatus === REPLAY_STATUS.PASS,
    evidence_receipt: evidenceReceipt || null
  }));
  const indexRenderStatusMatches = typeof renderStatus === "string"
    && (indexText.includes(`RENDER REPLAY: ${renderStatus}`)
      || indexText.includes(`render replay 為 ${renderStatus}`));
  checks.push(check("INDEX_RENDER_REPLAY_STATUS", indexRenderStatusMatches, { status: renderStatus }));

  const failed = checks.find(item => item.status === REPLAY_STATUS.FAIL);
  return {
    status: failed ? REPLAY_STATUS.FAIL : REPLAY_STATUS.PASS,
    classification_code: failed ? failed.name : "IDENTITY_VERIFIED",
    checks,
    parsed,
    viewer_atoms: viewerAtoms,
    bond_cutoff: bondCutoff,
    translation_angstrom: translation,
    computed_structure_sha256: computedSha256
  };
}

export function normalizeNumber(value) {
  const normalized = Math.abs(value) < 5e-10 ? 0 : value;
  return Number(normalized).toFixed(9);
}

export function buildSemanticPayload(runtime) {
  return {
    viewer_build: runtime.viewer_build,
    replay_contract: runtime.replay_contract,
    source_mode: runtime.source_mode,
    runtime_structure_hash_verified: runtime.runtime_structure_hash_verified,
    transformation: runtime.transformation,
    camera: {
      preset: runtime.camera.preset,
      rx: normalizeNumber(runtime.camera.rx),
      ry: normalizeNumber(runtime.camera.ry),
      zoom: normalizeNumber(runtime.camera.zoom)
    },
    representation: runtime.representation,
    mode: runtime.mode,
    spin: runtime.spin,
    animation_loop: runtime.animation_loop,
    post_ready_layout_guard: runtime.post_ready_layout_guard || null,
    atom_count: runtime.atom_count,
    element_counts: runtime.element_counts,
    ordered_atoms: runtime.ordered_atoms.map(atom => ({
      el: atom.el,
      x: normalizeNumber(atom.x),
      y: normalizeNumber(atom.y),
      z: normalizeNumber(atom.z)
    })),
    bond_pairs: runtime.bond_pairs,
    bond_cutoff: normalizeNumber(runtime.bond_cutoff),
    draw_counts: runtime.draw_counts,
    projection_canvas: {
      css_width: normalizeNumber(runtime.canvas_observation.css_width),
      css_height: normalizeNumber(runtime.canvas_observation.css_height)
    },
    projected_atoms: runtime.projected_atoms.map(atom => ({
      index: atom.index,
      el: atom.el,
      x: normalizeNumber(atom.x),
      y: normalizeNumber(atom.y),
      z: normalizeNumber(atom.z),
      scale: normalizeNumber(atom.scale)
    }))
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function validatePostReadyLayout(baseline, observed, guard) {
  const errors = [];
  if (!isRecord(baseline) || !isRecord(observed) || !isRecord(guard)) {
    return { valid: false, errors: ["POST_READY_LAYOUT_SHAPE_INVALID"] };
  }
  const numericFields = ["css_width", "css_height", "pixel_width", "pixel_height", "dpr"];
  if (numericFields.some(field => !isFiniteNumber(baseline[field]))) errors.push("POST_READY_LAYOUT_BASELINE_INVALID");
  if (["css_width", "css_height", "pixel_width", "pixel_height", "replay_dpr_x", "replay_dpr_y", "device_pixel_ratio", "expected_pixel_width", "expected_pixel_height"]
    .some(field => !isFiniteNumber(observed[field]))) errors.push("POST_READY_LAYOUT_OBSERVATION_INVALID");
  if (!isFiniteNumber(guard.max_css_drift_device_px) || guard.max_css_drift_device_px < 0) {
    errors.push("POST_READY_LAYOUT_TOLERANCE_INVALID");
  }
  if (errors.length) return { valid: false, errors };

  const cssWidthDrift = Math.abs(observed.css_width - baseline.css_width) * baseline.dpr;
  const cssHeightDrift = Math.abs(observed.css_height - baseline.css_height) * baseline.dpr;
  if (guard.backing_store_must_match === true
    && (observed.pixel_width !== baseline.pixel_width || observed.pixel_height !== baseline.pixel_height)) {
    errors.push("POST_READY_BACKING_STORE_CHANGED");
  }
  if (observed.expected_pixel_width !== baseline.pixel_width || observed.expected_pixel_height !== baseline.pixel_height) {
    errors.push("POST_READY_EXPECTED_BACKING_CHANGED");
  }
  if (guard.dpr_must_match === true
    && (observed.replay_dpr_x !== baseline.dpr || observed.replay_dpr_y !== baseline.dpr)) {
    errors.push("POST_READY_DPR_CHANGED");
  }
  if (cssWidthDrift > guard.max_css_drift_device_px || cssHeightDrift > guard.max_css_drift_device_px) {
    errors.push("POST_READY_CSS_DRIFT_EXCEEDED");
  }
  return {
    valid: errors.length === 0,
    errors,
    css_drift_device_px: { width: cssWidthDrift, height: cssHeightDrift }
  };
}

export function summarizeReplayAttempts(attempts, semanticDigestEqual) {
  const failedAttempt = attempts.find(attempt => attempt.status !== REPLAY_STATUS.PASS);
  if (failedAttempt) {
    return { status: failedAttempt.status, classification_code: failedAttempt.classification_code };
  }
  if (!semanticDigestEqual) {
    return { status: REPLAY_STATUS.FAIL, classification_code: "SEMANTIC_DIGEST_MISMATCH" };
  }
  return { status: REPLAY_STATUS.PASS, classification_code: "REPLAY_VERIFIED" };
}

export function validateRuntimeReceipt(runtime, expectedAtoms, { nativeMode = false } = {}) {
  const errors = [];
  const expectedSchema = nativeMode ? "MEC_PAGE_OBSERVATION_V1" : "MEC_LEGACY_PAGE_OBSERVATION_V1";
  if (!isRecord(runtime)) return { valid: false, errors: ["RECEIPT_NOT_OBJECT"] };

  if (runtime.receipt_schema !== expectedSchema) errors.push("RECEIPT_SCHEMA_INVALID");
  if (runtime.observation_status !== "READY") errors.push("OBSERVATION_STATUS_INVALID");
  for (const field of ["viewer_build", "replay_contract", "source_mode", "transformation", "representation"]) {
    if (typeof runtime[field] !== "string" || !runtime[field]) errors.push(`${field.toUpperCase()}_INVALID`);
  }
  if (typeof runtime.runtime_structure_hash_verified !== "boolean") errors.push("RUNTIME_HASH_AUTHORITY_TYPE_INVALID");
  if (!Number.isInteger(runtime.mode)) errors.push("MODE_INVALID");
  if (typeof runtime.spin !== "boolean") errors.push("SPIN_INVALID");
  if (typeof runtime.animation_loop !== "boolean") errors.push("ANIMATION_LOOP_INVALID");
  if (nativeMode && (!isRecord(runtime.post_ready_layout_guard)
    || runtime.post_ready_layout_guard.max_css_drift_device_px !== 0.5
    || runtime.post_ready_layout_guard.backing_store_must_match !== true
    || runtime.post_ready_layout_guard.dpr_must_match !== true)) {
    errors.push("POST_READY_LAYOUT_GUARD_INVALID");
  }
  if (!isNonNegativeInteger(runtime.atom_count)) errors.push("ATOM_COUNT_INVALID");

  if (!isRecord(runtime.camera)) {
    errors.push("CAMERA_INVALID");
  } else {
    if (typeof runtime.camera.preset !== "string" || !runtime.camera.preset) errors.push("CAMERA_PRESET_INVALID");
    for (const axis of ["rx", "ry", "zoom"]) {
      if (!isFiniteNumber(runtime.camera[axis])) errors.push(`CAMERA_${axis.toUpperCase()}_INVALID`);
    }
  }

  if (!Array.isArray(runtime.ordered_atoms) || runtime.ordered_atoms.length !== expectedAtoms.length) {
    errors.push("ORDERED_ATOMS_SHAPE_INVALID");
  } else {
    runtime.ordered_atoms.forEach((atom, index) => {
      if (!isRecord(atom) || typeof atom.el !== "string" || ["x", "y", "z"].some(axis => !isFiniteNumber(atom[axis]))) {
        errors.push(`ORDERED_ATOM_INVALID:${index}`);
      }
    });
  }

  if (!isRecord(runtime.element_counts)
    || Object.values(runtime.element_counts).some(value => !isNonNegativeInteger(value))) {
    errors.push("ELEMENT_COUNTS_INVALID");
  }

  if (!Array.isArray(runtime.bond_pairs)) {
    errors.push("BOND_PAIRS_INVALID");
  } else {
    runtime.bond_pairs.forEach((pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2
        || pair.some(atomIndex => !Number.isInteger(atomIndex) || atomIndex < 0 || atomIndex >= expectedAtoms.length)
        || pair[0] >= pair[1]) {
        errors.push(`BOND_PAIR_INVALID:${index}`);
      }
    });
  }
  if (!isFiniteNumber(runtime.bond_cutoff) || runtime.bond_cutoff <= 0) errors.push("BOND_CUTOFF_INVALID");

  if (!isRecord(runtime.draw_counts)
    || ["atom_draw_count", "bond_draw_count", "bounds_edge_draw_count"]
      .some(field => !isNonNegativeInteger(runtime.draw_counts[field]))) {
    errors.push("DRAW_COUNTS_INVALID");
  }

  const canvas = runtime.canvas_observation;
  if (!isRecord(canvas)
    || ["css_width", "css_height", "pixel_width", "pixel_height", "dpr"]
      .some(field => !isFiniteNumber(canvas[field]) || canvas[field] <= 0)
    || !Number.isInteger(canvas.pixel_width)
    || !Number.isInteger(canvas.pixel_height)) {
    errors.push("CANVAS_OBSERVATION_INVALID");
  }

  if (!Array.isArray(runtime.projected_atoms) || runtime.projected_atoms.length !== expectedAtoms.length) {
    errors.push("PROJECTED_ATOMS_SHAPE_INVALID");
  } else {
    const distinctCoordinates = new Set();
    runtime.projected_atoms.forEach((atom, index) => {
      const atomValid = isRecord(atom)
        && atom.index === index
        && atom.el === expectedAtoms[index]?.el
        && ["x", "y", "z", "scale"].every(field => isFiniteNumber(atom[field]))
        && atom.scale > 0;
      if (!atomValid) {
        errors.push(`PROJECTED_ATOM_INVALID:${index}`);
        return;
      }
      distinctCoordinates.add(`${atom.x.toFixed(6)},${atom.y.toFixed(6)}`);
      if (isRecord(canvas)
        && isFiniteNumber(canvas.css_width)
        && isFiniteNumber(canvas.css_height)
        && !(atom.x >= 0 && atom.x <= canvas.css_width && atom.y >= 0 && atom.y <= canvas.css_height)) {
        errors.push(`PROJECTED_ATOM_OUT_OF_BOUNDS:${index}`);
      }
    });
    if (distinctCoordinates.size !== expectedAtoms.length) errors.push("PROJECTED_ATOMS_NOT_DISTINCT");
  }

  return { valid: errors.length === 0, errors };
}

export function classifyReplayObservation(observation) {
  if (observation.infrastructure_error) {
    return {
      status: REPLAY_STATUS.NOT_RUN,
      runner_status: RUNNER_STATUS.INFRA_ERROR,
      classification_code: observation.infrastructure_error,
      publication_effect: "BLOCK"
    };
  }
  if (observation.explicit_skip) {
    return { status: REPLAY_STATUS.NOT_RUN, runner_status: RUNNER_STATUS.COMPLETED, classification_code: "EXPLICITLY_SKIPPED", publication_effect: PUBLICATION_EFFECT.NOT_RUN };
  }
  if (observation.launch_attempted && !observation.browser_launched) {
    return { status: REPLAY_STATUS.UNAVAILABLE, runner_status: RUNNER_STATUS.COMPLETED, classification_code: observation.launch_error_code || "BROWSER_LAUNCH_FAILED", publication_effect: PUBLICATION_EFFECT.UNAVAILABLE };
  }
  if (!observation.browser_launched) {
    return {
      status: REPLAY_STATUS.NOT_RUN,
      runner_status: RUNNER_STATUS.INFRA_ERROR,
      classification_code: "LAUNCH_STATE_MISSING",
      publication_effect: "BLOCK"
    };
  }

  const failure = [
    [observation.ready_timeout, "READY_TIMEOUT"],
    [observation.post_observation_invalidated, "POST_OBSERVATION_STATE_INVALIDATED"],
    [observation.page_errors?.length, "PAGE_ERROR"],
    [observation.console_errors?.length, "CONSOLE_ERROR"],
    [observation.page_receipt_invalid, "PAGE_RECEIPT_INVALID"],
    [observation.asset_errors?.length, "ASSET_ERROR"],
    [observation.blank_canvas, "BLANK_CANVAS"],
    [observation.camera_mismatch, "CAMERA_MISMATCH"],
    [observation.representation_mismatch, "REPRESENTATION_MISMATCH"],
    [observation.viewer_build_mismatch, "VIEWER_BUILD_MISMATCH"],
    [observation.replay_contract_mismatch, "REPLAY_CONTRACT_MISMATCH"],
    [observation.source_mode_mismatch, "SOURCE_MODE_MISMATCH"],
    [observation.transformation_mismatch, "TRANSFORMATION_MISMATCH"],
    [observation.runtime_hash_authority_mismatch, "RUNTIME_HASH_AUTHORITY_MISMATCH"],
    [observation.layout_guard_mismatch, "LAYOUT_GUARD_MISMATCH"],
    [observation.replay_ui_mismatch, "REPLAY_UI_STATE_MISMATCH"],
    [observation.spin_enabled, "SPIN_NOT_DISABLED"],
    [observation.unexpected_animation_loop, "ANIMATION_LOOP_ACTIVE"],
    [observation.atom_mismatch, "RUNTIME_ATOM_MISMATCH"],
    [observation.bond_mismatch, "RUNTIME_BOND_MISMATCH"],
    [observation.bond_cutoff_mismatch, "BOND_CUTOFF_MISMATCH"],
    [observation.count_mismatch, "RUNTIME_COUNT_MISMATCH"],
    [observation.draw_mismatch, "RUNTIME_DRAW_COUNT_MISMATCH"],
    [observation.canvas_mismatch, "CANVAS_OBSERVATION_MISMATCH"],
    [observation.post_observation_layout_mismatch, "POST_OBSERVATION_LAYOUT_MISMATCH"],
    [observation.projection_mismatch, "PROJECTION_MISMATCH"],
    [observation.semantic_digest_match === false, "SEMANTIC_DIGEST_MISMATCH"]
  ].find(([condition]) => Boolean(condition));

  if (failure) {
    return { status: REPLAY_STATUS.FAIL, runner_status: RUNNER_STATUS.COMPLETED, classification_code: failure[1], publication_effect: PUBLICATION_EFFECT.FAIL };
  }
  return { status: REPLAY_STATUS.PASS, runner_status: RUNNER_STATUS.COMPLETED, classification_code: "REPLAY_VERIFIED", publication_effect: PUBLICATION_EFFECT.PASS };
}

export function aggregateStatuses(statuses) {
  if (statuses.includes(REPLAY_STATUS.FAIL)) return REPLAY_STATUS.FAIL;
  if (statuses.includes(REPLAY_STATUS.UNAVAILABLE)) return REPLAY_STATUS.UNAVAILABLE;
  if (statuses.includes(REPLAY_STATUS.NOT_RUN)) return REPLAY_STATUS.NOT_RUN;
  return REPLAY_STATUS.PASS;
}
