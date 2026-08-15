import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPLAY_RUNNER_VERSION,
  REPLAY_STATUS,
  parseSidecar,
  parseXyz,
  sha256,
  validateFixtureGrowth,
  verifyFrozenFixturePair,
  verifyReleaseIdentity
} from "./replay-core.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(projectDir, "../..");
const fixtureDir = path.join(projectDir, "fixture");
const frozenFixtureReleases = Object.freeze([
  ["SYN-HEA-001.xyz", "da60ad91b2435c541cbb02259274129b05459030"],
  ["SYN-HEA-002.xyz", "87f8e462b90c920efe44b06448dcfcdd06a72c16"],
  ["SYN-HEA-003.xyz", "d65cca67b98abb5a0fdcbb0a73e57a15b1e05fc0"],
  ["SYN-HEA-004.xyz", "a26cf75ba065bc3e821522ea556102d0e62e3901"],
  ["SYN-HEA-005.xyz", "c816e879dcf4f79832a1918a5a52da3f8096d03e"],
  ["SYN-HEA-006.xyz", "a6f218c9cb560def2c90fcd858c8e84eca1fe7ca"]
]);

async function loadText(relativePath) {
  return readFile(path.join(projectDir, relativePath), "utf8");
}

function gitShowFixture(commit, fixtureName, sidecar = false) {
  const suffix = sidecar ? ".sha256" : "";
  return execFileSync(
    "git",
    ["show", `${commit}:projects/material-evidence-card-p0/fixture/${fixtureName}${suffix}`],
    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
  );
}

const manifest = JSON.parse(await loadText("manifest.json"));
const fixtureNames = (await readdir(fixtureDir))
  .filter(name => /^SYN-HEA-\d{3}\.xyz$/.test(name))
  .sort();

const expectedSequence = fixtureNames.map((_, index) => `SYN-HEA-${String(index + 1).padStart(3, "0")}.xyz`);
const checks = [{
  name: "SEQUENTIAL_FIXTURE_IDS",
  status: JSON.stringify(fixtureNames) === JSON.stringify(expectedSequence) ? REPLAY_STATUS.PASS : REPLAY_STATUS.FAIL,
  detail: { fixtureNames, expectedSequence }
}];

for (const fixtureName of fixtureNames) {
  const xyzBytes = await readFile(path.join(fixtureDir, fixtureName));
  const sidecar = parseSidecar(await readFile(path.join(fixtureDir, `${fixtureName}.sha256`), "utf8"));
  const parsed = parseXyz(xyzBytes);
  const computed = sha256(xyzBytes);
  checks.push({
    name: `FIXTURE_IDENTITY:${fixtureName}`,
    status: sidecar.filename === fixtureName && sidecar.sha256 === computed && parsed.atoms.length === parsed.declared_atom_count
      ? REPLAY_STATUS.PASS
      : REPLAY_STATUS.FAIL,
    detail: { expected: sidecar.sha256, computed, atom_count: parsed.atoms.length }
  });
}

const preservationDetails = [];
for (const [fixtureName, releaseCommit] of frozenFixtureReleases) {
  try {
    const pair = verifyFrozenFixturePair({
      currentXyz: await readFile(path.join(fixtureDir, fixtureName)),
      currentSidecar: await readFile(path.join(fixtureDir, `${fixtureName}.sha256`)),
      baselineXyz: gitShowFixture(releaseCommit, fixtureName),
      baselineSidecar: gitShowFixture(releaseCommit, fixtureName, true)
    });
    preservationDetails.push({ fixture_name: fixtureName, release_commit: releaseCommit, ...pair });
  } catch (error) {
    preservationDetails.push({
      fixture_name: fixtureName,
      release_commit: releaseCommit,
      status: REPLAY_STATUS.FAIL,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
const frozenFixtureNames = frozenFixtureReleases.map(([fixtureName]) => fixtureName);
const activeFixtureName = manifest.structure_file.split("/").at(-1);
const fixtureGrowth = validateFixtureGrowth({ fixtureNames, frozenFixtureNames, activeFixtureName });
checks.push({
  name: "PREVIOUS_FIXTURES_PRESERVED",
  status: preservationDetails.every(item => item.status === REPLAY_STATUS.PASS)
    && fixtureGrowth.allowed
    ? REPLAY_STATUS.PASS
    : REPLAY_STATUS.FAIL,
  detail: {
    frozen_fixtures: preservationDetails,
    ...fixtureGrowth
  }
});

const activeXyz = await readFile(path.join(projectDir, manifest.structure_file));
const activeSidecar = await readFile(path.join(projectDir, `${manifest.structure_file}.sha256`), "utf8");
const activeIdentity = verifyReleaseIdentity({
  manifest,
  indexText: await loadText("index.html"),
  viewerText: await loadText("viewer.js"),
  xyzBytes: activeXyz,
  sidecarText: activeSidecar,
  expectedRunner: REPLAY_RUNNER_VERSION
});
checks.push({ name: "ACTIVE_RELEASE_IDENTITY", status: activeIdentity.status, detail: activeIdentity.classification_code });
const activeIndexText = await loadText("index.html");
checks.push({
  name: "ACTIVE_UI_TRANSFORMATION",
  status: activeIndexText.includes("Fixed translation + render only")
    && !activeIndexText.includes("Center + render only")
    ? REPLAY_STATUS.PASS
    : REPLAY_STATUS.FAIL,
  detail: { expected: "Fixed translation + render only" }
});

const readmeText = await loadText("README.md");
checks.push({
  name: "MANIFEST_README_RELEASE",
  status: readmeText.includes(`RELEASE: ${manifest.release}`) ? REPLAY_STATUS.PASS : REPLAY_STATUS.FAIL,
  detail: manifest.release
});

const reuseText = await loadText("REUSE.toml");
const workflowText = await readFile(path.join(repoRoot, ".github/workflows/material-evidence-card-replay.yml"), "utf8");
const requiredReuseMappings = ["fixture/*.xyz", "fixture/*.xyz.sha256", "package.json", "package-lock.json", "tools/*.mjs", "tests/*.mjs"];
checks.push({
  name: "LICENSE_CLASSIFICATION",
  status: requiredReuseMappings.every(mapping => reuseText.includes(`\"${mapping}\"`))
    && workflowText.includes("SPDX-License-Identifier: MIT")
    ? REPLAY_STATUS.PASS
    : REPLAY_STATUS.FAIL,
  detail: { required_reuse_mappings: requiredReuseMappings, workflow_spdx: "MIT" }
});

try {
  execFileSync(process.execPath, ["--check", path.join(projectDir, "viewer.js")], { stdio: "pipe" });
  checks.push({ name: "JAVASCRIPT_SYNTAX", status: REPLAY_STATUS.PASS, detail: process.version });
} catch (error) {
  checks.push({ name: "JAVASCRIPT_SYNTAX", status: REPLAY_STATUS.FAIL, detail: error.stderr?.toString() || String(error) });
}

const status = checks.some(item => item.status === REPLAY_STATUS.FAIL) ? REPLAY_STATUS.FAIL : REPLAY_STATUS.PASS;
process.stdout.write(`${JSON.stringify({ validator: "release-validator/0.13", status, checks }, null, 2)}\n`);
if (status !== REPLAY_STATUS.PASS) process.exitCode = 1;
