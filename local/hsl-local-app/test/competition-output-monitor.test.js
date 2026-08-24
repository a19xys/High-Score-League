const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createCompetitionOutputMonitor } = require("../src/competition-output-monitor");

async function fixture(t, runId) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-output-monitor-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const run = {
    runId,
    integrityDir: path.join(root, "integrity"),
    stagingCandidatesDir: path.join(root, "events", "candidates"),
    stagingCommitmentsDir: path.join(root, "events", "commitments"),
  };
  await Promise.all([
    fsp.mkdir(path.join(run.integrityDir, "app"), { recursive: true }),
    fsp.mkdir(run.stagingCandidatesDir, { recursive: true }),
    fsp.mkdir(run.stagingCommitmentsDir, { recursive: true }),
  ]);
  const watchers = new Map();
  const fileWatchers = new Map();
  const monitor = await createCompetitionOutputMonitor(run, {
    nowIso: "2026-08-21T10:00:00.000Z",
    outputWatchImpl(directoryPath, _options, callback) {
      const watcher = new EventEmitter();
      watcher.close = () => {};
      watchers.set(path.resolve(directoryPath), { callback, watcher });
      return watcher;
    },
    outputFileWatchImpl(filePath, _options, callback) {
      const watcher = new EventEmitter();
      watcher.close = () => {};
      fileWatchers.set(path.resolve(filePath), { callback, watcher });
      return watcher;
    },
  });
  return { fileWatchers, monitor, run, watchers };
}

async function publish(directoryPath, name, value) {
  const temporaryPath = path.join(directoryPath, `${name}.tmp`);
  await fsp.writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
  await fsp.rename(temporaryPath, path.join(directoryPath, name));
}

async function observeBoth(value, candidateScore = 20) {
  await publish(value.run.stagingCandidatesDir, "candidate_000001.json", { score: candidateScore });
  value.watchers.get(path.resolve(value.run.stagingCandidatesDir)).callback("rename", "candidate_000001.json");
  await publish(value.run.stagingCommitmentsDir, "commitment_000001.json", { candidate: { score: candidateScore } });
  value.watchers.get(path.resolve(value.run.stagingCommitmentsDir)).callback("rename", "commitment_000001.json");
  await value.monitor.scan(true);
}

test("candidate and commitment retain their first exact byte identity", async (t) => {
  const value = await fixture(t, "run_output_normal");
  await observeBoth(value);
  const state = await value.monitor.close();
  assert.deepEqual(state.violations, []);
  assert.equal(state.candidates.length, 1);
  assert.equal(state.commitments.length, 1);
  assert.match(state.candidates[0].sha256, /^[0-9a-f]{64}$/);
  assert.match(state.commitments[0].sha256, /^[0-9a-f]{64}$/);
});

for (const [name, mutate] of Object.entries({
  "candidate and commitment changed together": async (value) => {
    await fsp.writeFile(path.join(value.run.stagingCandidatesDir, "candidate_000001.json"), '{"score":99990}\n');
    await fsp.writeFile(path.join(value.run.stagingCommitmentsDir, "commitment_000001.json"), '{"candidate":{"score":99990}}\n');
  },
  "candidate deleted and recreated": async (value) => {
    const target = path.join(value.run.stagingCandidatesDir, "candidate_000001.json");
    await fsp.rm(target);
    await value.monitor.scan(true);
    await fsp.writeFile(target, '{"score":20}\n');
  },
  "commitment deleted and recreated": async (value) => {
    const target = path.join(value.run.stagingCommitmentsDir, "commitment_000001.json");
    await fsp.rm(target);
    await value.monitor.scan(true);
    await fsp.writeFile(target, '{"candidate":{"score":20}}\n');
  },
  "candidate renamed": async (value) => {
    await fsp.rename(
      path.join(value.run.stagingCandidatesDir, "candidate_000001.json"),
      path.join(value.run.stagingCandidatesDir, "candidate_000002.json"),
    );
  },
  "unexpected extra output": async (value) => {
    await fsp.writeFile(path.join(value.run.stagingCandidatesDir, "forged.json"), "{}\n");
  },
})) {
  test(`${name} makes the output authority fail closed`, async (t) => {
    const value = await fixture(t, `run_${name.replace(/\W+/g, "_")}`);
    await observeBoth(value);
    await mutate(value);
    await value.monitor.scan(true);
    assert.deepEqual((await value.monitor.close()).violations, ["integrity_unavailable"]);
  });
}

test("restoring original candidate bytes does not erase the observed violation", async (t) => {
  const value = await fixture(t, "run_output_restore");
  await observeBoth(value);
  const target = path.join(value.run.stagingCandidatesDir, "candidate_000001.json");
  const original = await fsp.readFile(target);
  await fsp.writeFile(target, '{"score":99990}\n');
  value.fileWatchers.get(path.resolve(target)).callback("change", "candidate_000001.json");
  await fsp.writeFile(target, original);
  assert.deepEqual((await value.monitor.close()).violations, ["integrity_unavailable"]);
});

test("an output present at close but never observed is unavailable", async (t) => {
  const value = await fixture(t, "run_output_unobserved");
  await publish(value.run.stagingCandidatesDir, "candidate_000001.json", { score: 20 });
  await publish(value.run.stagingCommitmentsDir, "commitment_000001.json", { candidate: { score: 20 } });
  const state = await value.monitor.close();
  assert.deepEqual(state.violations, ["integrity_unavailable"]);
  assert.deepEqual(state.candidates, []);
  assert.deepEqual(state.commitments, []);
});

test("watcher error or unexpected close is sticky", async (t) => {
  for (const signal of ["error", "close"]) {
    const value = await fixture(t, `run_output_watcher_${signal}`);
    const watcher = value.watchers.get(path.resolve(value.run.stagingCandidatesDir)).watcher;
    if (signal === "error") watcher.emit("error", new Error("simulated"));
    else watcher.emit("close");
    assert.deepEqual((await value.monitor.close()).violations, ["integrity_unavailable"]);
  }
});
