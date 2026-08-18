const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const STAGE_PATH = path.join(REPO_ROOT, ".github", "workflows", "windows-release-stage.yml");
const PUBLISH_PATH = path.join(REPO_ROOT, ".github", "workflows", "windows-release-publish.yml");

async function workflows() {
  return {
    stage: await fsp.readFile(STAGE_PATH, "utf8"),
    publish: await fsp.readFile(PUBLISH_PATH, "utf8"),
  };
}

test("Windows release workflows are separate manual-only gates with shared non-cancelling concurrency", async () => {
  const { stage, publish } = await workflows();
  for (const source of [stage, publish]) {
    assert.match(source, /^on:\r?\n\s+workflow_dispatch:/m);
    assert.doesNotMatch(source, /^\s+(push|pull_request|release|schedule):/m);
    assert.match(source, /group: hsl-windows-stable-release/);
    assert.match(source, /cancel-in-progress: false/);
  }
  assert.match(stage, /options:\s*\r?\n\s+- dry-run\s*\r?\n\s+- stage/);
  assert.match(stage, /default: dry-run/);
  assert.match(publish, /confirmation:/);
  assert.match(publish, /environment: windows-release/);
});

test("build is Windows 2025 + Node 22 read-only and privileged jobs never install/build", async () => {
  const { stage, publish } = await workflows();
  const buildJob = stage.slice(stage.indexOf("  build:"), stage.indexOf("  stage:"));
  const stageJob = stage.slice(stage.indexOf("  stage:"));
  assert.match(buildJob, /runs-on: windows-2025/);
  assert.match(buildJob, /node-version: "22"/);
  assert.match(buildJob, /permissions:\s*\r?\n\s+contents: read/);
  assert.doesNotMatch(buildJob, /contents: write/);
  assert.match(buildJob, /npm ci/);
  assert.match(buildJob, /npm test/);
  assert.match(buildJob, /npm run dist:win/);
  assert.match(buildJob, /npm run smoke:packaged/);
  assert.match(stageJob, /permissions:\s*\r?\n\s+contents: write/);
  assert.doesNotMatch(stageJob, /npm ci|electron-builder|npm run dist:win/);
  assert.match(publish, /contents: write/);
  assert.match(publish, /actions: read/);
  assert.doesNotMatch(publish, /npm ci|electron-builder|npm run dist:win/);
});

test("all Actions are official and pinned to verified full SHAs", async () => {
  const { stage, publish } = await workflows();
  const expected = new Set([
    "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  ]);
  const uses = [...`${stage}\n${publish}`.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 7);
  for (const action of uses) {
    assert.match(action, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
    assert.equal(expected.has(action), true, `Action no verificada: ${action}`);
  }
});

test("workflow artifacts preserve exact provenance and publication remains a second operation", async () => {
  const { stage, publish } = await workflows();
  assert.match(stage, /if-no-files-found: error/);
  assert.match(stage, /compression-level: 0/);
  assert.match(stage, /retention-days: 30/);
  assert.match(stage, /overwrite: false/);
  assert.match(stage, /artifact-ids: \$\{\{ needs\.build\.outputs\.artifact-id \}\}/);
  assert.match(stage, /stage --mode dry-run/);
  assert.match(stage, /stage --mode stage/);
  assert.match(publish, /run-id: \$\{\{ steps\.locate\.outputs\.stage-run-id \}\}/);
  assert.match(publish, /artifact-ids: \$\{\{ steps\.locate\.outputs\.artifact-id \}\}/);
  assert.match(publish, /windows-release-github\.js publish/);
  assert.doesNotMatch(`${stage}\n${publish}`, /--publish always/);
  const packageJson = await fsp.readFile(path.join(REPO_ROOT, "local", "hsl-local-app", "package.json"), "utf8");
  assert.match(packageJson, /electron-builder[^\n]+--publish never/);
  assert.equal(JSON.parse(packageJson).version, "0.2.0");
});
