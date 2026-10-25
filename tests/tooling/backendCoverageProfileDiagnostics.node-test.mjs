import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  realpath,
  rm,
  link,
  symlink,
  rename,
  truncate,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Readable, Writable } from "node:stream";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";

const workflow = YAML.parse(
  await readFile(
    new URL("../../.github/workflows/coverage.yml", import.meta.url),
    "utf8",
  ),
);
const steps = workflow.jobs["backend-coverage"].steps;
const generate = steps.find(
  (step) => step.name === "Generate lcov coverage report",
);
const run = generate.run;
const inline = (name) => {
  const found = run.match(new RegExp(`<<'${name}'\\n([\\s\\S]*?)\\n${name}`));
  assert.ok(found, `Actual inline ${name} module required`);
  return found[1];
};
const moduleOf = (source) =>
  import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
const { collectCoverageProfiles } = await moduleOf(inline("PROFILE_COLLECTOR"));
const { captureCoverage } = await moduleOf(inline("PROFILE_CAPTURE"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const name = "src-tauri-51204-11478591308303779965_0.profraw";

async function fixture(t, names = [name]) {
  const parent = await realpath(os.tmpdir());
  const directory = await mkdtemp(
    path.join(parent, "coverage-diagnostic-test-"),
  );
  t.after(async () => {
    assert.equal(await realpath(directory), directory);
    assert.equal(path.dirname(directory), parent);
    await rm(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, "backend-profile-diagnostics.abcdefgh");
  const evidence = path.join(root, "evidence");
  const target = path.join(directory, "target", "llvm-cov-target");
  await mkdir(evidence, { recursive: true });
  await mkdir(target, { recursive: true });
  const bytes = Buffer.alloc(256, 19); // Synthetic corrupt bytes, never a Rust claim.
  for (const file of names) await writeFile(path.join(target, file), bytes);
  const list = Buffer.from(
    names.map((file) => path.join(target, file)).join("\n") + "\n",
  );
  await writeFile(path.join(target, "src-tauri-profraw-list"), list);
  const tail = names
    .map(
      (file) =>
        `warning: ${path.join(target, file)}: invalid instrumentation profile data (file header is corrupt)`,
    )
    .join("\n");
  await writeFile(path.join(evidence, "coverage-tail.log"), tail);
  return {
    directory,
    root,
    target,
    evidence,
    bytes,
    list,
    file: path.join(target, names[0]),
  };
}

test("actual inline collector retains diagnosed corrupt bytes, header, list and original failure", async (t) => {
  const f = await fixture(t);
  const goodName = "src-tauri-51205-111_0.profraw";
  const good = Buffer.from(
    "a separate unclassified profile remains a strict merge input",
  );
  await writeFile(path.join(f.target, goodName), good);
  const fullList = Buffer.concat([
    f.list,
    Buffer.from(path.join(f.target, goodName) + "\n"),
  ]);
  await writeFile(path.join(f.target, "src-tauri-profraw-list"), fullList);
  const result = await collectCoverageProfiles(f.root, f.target, 17);
  assert.equal(result.complete, true);
  assert.equal(result.cargoExit, 17);
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].sha256, digest(f.bytes));
  assert.equal(
    result.profiles[0].headerHex,
    f.bytes.subarray(0, 64).toString("hex"),
  );
  assert.equal(result.profiles[0].bytes, f.bytes.length);
  assert.deepEqual(await readFile(path.join(f.evidence, name)), f.bytes);
  assert.deepEqual(
    await readFile(path.join(f.evidence, "profraw-list.txt")),
    fullList,
  );
  assert.deepEqual(
    await readFile(path.join(f.target, "src-tauri-profraw-list")),
    fullList,
  );
  assert.deepEqual(await readFile(f.file), f.bytes);
  assert.deepEqual(await readFile(path.join(f.target, goodName)), good);
  await assert.rejects(readFile(path.join(f.evidence, goodName)), /ENOENT/);
  assert.ok(
    result.list.files.includes(goodName),
    "No valid merge input is filtered/deleted",
  );
  assert.equal(
    JSON.parse(await readFile(path.join(f.evidence, "collection.json"), "utf8"))
      .cargoExit,
    17,
  );
});

test("actual collector denies unknown, outside and non-listed diagnostic paths without exposing them", async (t) => {
  for (const kind of ["unknown", "outside", "not-listed", "different-error"]) {
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      const secret =
        kind === "unknown"
          ? path.join(f.target, "private-token.profraw")
          : kind === "outside"
            ? path.join(f.directory, name)
            : path.join(f.target, "src-tauri-999-222_0.profraw");
      await writeFile(
        path.join(f.evidence, "coverage-tail.log"),
        kind === "different-error"
          ? "warning: arbitrary private-token error is not a profile diagnosis"
          : `warning: ${secret}: invalid instrumentation profile data (file header is corrupt)`,
      );
      const result = await collectCoverageProfiles(f.root, f.target, 1);
      assert.equal(result.complete, false);
      assert.equal(
        result.failure,
        kind === "different-error" ? "DIAGNOSTIC_UNAVAILABLE" : "PATH_DENIED",
      );
      assert.equal(result.profiles.length, 0);
      assert.doesNotMatch(
        JSON.stringify(result),
        /private-token|credential|outside/,
      );
      assert.deepEqual(await readFile(f.file), f.bytes);
    });
  }
});

test("actual collector denies hardlinks, oversized data, mutation and a finite deadline", async (t) => {
  for (const kind of ["hardlink", "oversize", "mutation", "deadline"]) {
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      if (kind === "hardlink")
        await link(f.file, path.join(f.directory, "owned-second-link"));
      if (kind === "oversize") await truncate(f.file, 32 * 1024 ** 2 + 1);
      const options =
        kind === "mutation"
          ? {
              afterOpen: async (file) => {
                if (file === f.file)
                  await writeFile(file, Buffer.alloc(512, 20));
              },
            }
          : kind === "deadline"
            ? {
                now: (() => {
                  let tick = 0;
                  return () => tick++ * 60_000;
                })(),
              }
            : {};
      if (kind === "deadline") {
        await assert.rejects(
          collectCoverageProfiles(f.root, f.target, 1, options),
          /DEADLINE/,
        );
      } else {
        const result = await collectCoverageProfiles(
          f.root,
          f.target,
          1,
          options,
        );
        assert.equal(result.complete, false);
        assert.equal(
          result.failure,
          {
            hardlink: "LINK_DENIED",
            oversize: "FILE_BOUND",
            mutation: "FILE_CHANGED",
          }[kind],
        );
        assert.equal(result.profiles[0].retained, false);
      }
      if (kind === "hardlink")
        assert.deepEqual(await readFile(f.file), f.bytes);
    });
  }
});

test("collector rejects target junctions and does not follow foreign storage", async (t) => {
  const f = await fixture(t);
  const saved = path.join(f.directory, "saved-target");
  const foreign = path.join(f.directory, "foreign");
  await mkdir(foreign);
  await writeFile(path.join(foreign, "marker"), "preserve");
  await rename(f.target, saved);
  try {
    await symlink(
      foreign,
      f.target,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Symlink privilege unavailable");
      return;
    }
    throw error;
  }
  const result = await collectCoverageProfiles(f.root, f.target, 1);
  assert.equal(result.failure, "LINK_DENIED");
  assert.equal(result.profiles.length, 0);
  assert.equal(
    await readFile(path.join(foreign, "marker"), "utf8"),
    "preserve",
  );
  assert.deepEqual(await readFile(path.join(saved, name)), f.bytes);
});

test("collector bounds the diagnosed file count before copying any raw profiles", async (t) => {
  const names = Array.from(
    { length: 17 },
    (_, i) => `src-tauri-${100 + i}-111_0.profraw`,
  );
  const f = await fixture(t, names);
  const result = await collectCoverageProfiles(f.root, f.target, 1);
  assert.equal(result.complete, false);
  assert.equal(result.failure, "DIAGNOSTIC_BOUND");
  assert.equal(result.profiles.length, 0);
});

test("aggregate 64MiB evidence budget includes tail and list before another profile is copied", async (t) => {
  const names = [name, "src-tauri-999-222_0.profraw"];
  const f = await fixture(t, names);
  for (const file of names)
    await truncate(path.join(f.target, file), 32 * 1024 ** 2);
  const result = await collectCoverageProfiles(f.root, f.target, 1);
  assert.equal(result.complete, false);
  assert.equal(result.failure, "FILE_BOUND");
  assert.equal(result.profiles[0].retained, true);
  assert.equal(result.profiles[1].retained, false);
  assert.equal(result.retainedProfileBytes, 32 * 1024 ** 2);
  await assert.rejects(readFile(path.join(f.evidence, names[1])), /ENOENT/);
});

test("actual bounded tail capture forwards every console byte with backpressure", async (t) => {
  const f = await fixture(t);
  const log = path.join(f.directory, "tail.log");
  const original = Buffer.alloc(2 * 1024 ** 2 + 17, 42);
  const chunks = [];
  const destination = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      setImmediate(callback);
    },
  });
  await captureCoverage(
    Readable.from([original.subarray(0, 100), original.subarray(100)]),
    destination,
    log,
  );
  assert.deepEqual(Buffer.concat(chunks), original);
  assert.deepEqual(await readFile(log), original.subarray(-(1024 ** 2)));
  assert.equal(destination.writableEnded, false);
  destination.end();
});

test("actual workflow shell preserves Cargo failure even when diagnostic collection fails", async (t) => {
  const f = await fixture(t);
  const runnerTemp = path.join(f.directory, "real-runner-temp");
  const alias = path.join(f.directory, "runner-temp-alias");
  await mkdir(runnerTemp);
  try {
    await symlink(
      runnerTemp,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Symlink privilege unavailable");
      return;
    }
    throw error;
  }
  const shell =
    process.platform === "win32"
      ? "C:/Program Files/Git/bin/bash.exe"
      : "/bin/bash";
  const script = path.join(f.directory, "owned-workflow.sh");
  await writeFile(
    script,
    `cargo() { printf '%s\\n' 'synthetic original cargo output'; return 17; }\n${run}`,
  );
  const env = {
    ...process.env,
    RUNNER_TEMP: alias.replaceAll("\\", "/"),
    GITHUB_OUTPUT: path.join(f.directory, "outputs").replaceAll("\\", "/"),
  };
  const result = spawnSync(shell, ["--noprofile", "--norc", script], {
    cwd: f.directory,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 2 * 1024 ** 2,
  });
  if (result.error?.code === "ENOENT") {
    t.skip("Existing Bash unavailable; no shell installed");
    return;
  }
  assert.equal(result.status, 17, result.stderr);
  assert.match(result.stdout, /synthetic original cargo output/);
  assert.match(result.stdout, /original cargo exit=17/);
  assert.match(result.stdout, /collector exit=1/);
  assert.match(result.stderr, /COVERAGE_PROFILE_DIAGNOSTICS_UNAVAILABLE/);
});

test("workflow keeps strict merge, every test and both coverage ratchets", () => {
  assert.match(
    run,
    /cargo llvm-cov --workspace --lcov --output-path coverage\.lcov 2>&1 \| node/,
  );
  assert.match(run, /result=\("\$\{PIPESTATUS\[@\]\}"\)/);
  assert.match(run, /exit "\$cargo_status"/);
  assert.match(run, /\/usr\/bin\/timeout --signal=KILL 60s node/);
  assert.doesNotMatch(
    run,
    /failure-mode|ignore-filename|--exclude|profraw-only|llvm-cov clean|llvm-profdata merge|LLVM_PROFILE_FILE=/,
  );
  const job = workflow.jobs["backend-coverage"];
  assert.equal(job.env.WORKSPACE_COVERAGE_THRESHOLD, "25.5");
  assert.equal(job.env.CRITICAL_RUNTIME_COVERAGE_THRESHOLD, "40");
  const artifact = steps.find(
    (step) => step.name === "Retain bounded failed-profile evidence",
  );
  assert.match(artifact.if, /^failure\(\) &&/);
  assert.equal(
    artifact.with.path,
    "${{ steps.coverage.outputs.profile_diagnostics }}",
  );
  assert.ok(
    steps
      .find((step) => step.name === "Test physical-line LCOV checker")
      .run.includes("backendCoverageProfileDiagnostics.node-test.mjs"),
  );
  assert.equal(
    steps.find((step) => step.name === "Upload lcov artifact").if,
    "always()",
  );
  assert.match(
    steps.find(
      (step) => step.name === "Enforce physical-line coverage ratchets",
    ).run,
    /--critical-threshold/,
  );
});
