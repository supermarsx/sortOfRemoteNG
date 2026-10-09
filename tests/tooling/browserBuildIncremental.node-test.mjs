import test from "node:test";
import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  applicationPayloadDirectory,
  copyTreeExclusive,
  immutableDevCache,
  runCargo,
} from "../../scripts/browser-app-build.mjs";
import {
  TARGETS,
  packageManifest,
} from "../../scripts/browser-runtime-package.mjs";

async function fixture(t, platform = "linux") {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-incremental-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = {
    root,
    target:
      platform === "windows"
        ? "x86_64-pc-windows-msvc"
        : "x86_64-unknown-linux-gnu",
    platform,
    appName: "fixture-app",
    productName: "fixture-app",
    // Explicit official selection isolates orchestration tests from any local
    // developer registration. Synthetic bytes are never accepted as a runtime.
    runtimeKind: "official",
    officialRuntimeExplicit: true,
    sdk: path.join(root, "sdk"),
    publicTarget: path.join(root, "public-target"),
    cargoTarget: path.join(root, "cargo-target"),
    payload: path.join(root, "release-payload"),
    configFile: path.join(root, "config.json"),
  };
  const planFile = path.join(root, "plan.json");
  await writeFile(planFile, JSON.stringify(plan));
  await writeFile(
    plan.configFile,
    JSON.stringify({ bundle: { resources: {} } }),
  );
  return { root, plan, planFile, env: { SORNG_CEF_BUILD_PLAN: planFile } };
}

async function inventory(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await inventory(root, relative)));
    else
      result.push({
        path: relative,
        size: (await lstat(path.join(root, relative))).size,
      });
  }
  return result;
}

test("six targets retain exclusive per-run staging and unchanged build destinations", async (t) => {
  const f = await fixture(t);
  for (const target of TARGETS) {
    const plan = {
      ...f.plan,
      target,
      platform: packageManifest(target).platform,
    };
    for (const profile of ["debug", "release"]) {
      assert.equal(
        await applicationPayloadDirectory(plan, { verb: "build", profile }),
        plan.payload,
      );
      const commands = { verb: "run", profile };
      const first = await applicationPayloadDirectory(plan, commands);
      const second = await applicationPayloadDirectory(plan, commands);
      assert.notEqual(first, second);
      await assert.rejects(lstat(first), { code: "ENOENT" });
      assert.ok((await lstat(path.dirname(first))).isDirectory());
      if (plan.platform === "macos")
        assert.equal(path.basename(first), `${plan.appName}.app`);
      else assert.ok(first.endsWith(path.join("target", target, profile)));
      assert.ok(!first.startsWith(plan.publicTarget));
      assert.ok(!first.startsWith(plan.cargoTarget));
    }
  }
  await assert.rejects(lstat(f.plan.payload), { code: "ENOENT" });
});

test("watch rebuilds launch the staged payload, retain resources and eliminate one complete copy", async (t) => {
  const f = await fixture(t);
  const source = path.join(f.root, "synthetic-runtime");
  await mkdir(path.join(source, "locales"), { recursive: true });
  await writeFile(
    path.join(source, f.plan.appName),
    Buffer.alloc(1024 * 1024, 7),
  );
  for (let index = 0; index < 64; index++)
    await writeFile(
      path.join(source, "locales", `${index}.pak`),
      Buffer.alloc(4096, index),
    );
  const resource = path.join(f.root, "app-en.json");
  await writeFile(resource, '{"language":"en"}');
  await writeFile(
    f.plan.configFile,
    JSON.stringify({
      bundle: { resources: { [resource]: "locales/en.json" } },
    }),
  );
  const original = await inventory(source);
  const bytes = original.reduce((sum, file) => sum + file.size, 0);
  const launched = [];
  let staged;
  let stagedIdentity;
  let compiled = 0;
  const dependencies = {
    stage: async (_plan, { output }) => {
      staged = output;
      await copyTreeExclusive(source, output);
      stagedIdentity = await lstat(path.join(output, f.plan.appName));
      return { ok: true };
    },
    run: async (command, args, env, cwd) => {
      if (command === "cargo") {
        compiled++;
        assert.ok(args.includes("--locked"));
        assert.ok(args.includes(f.plan.cargoTarget));
        if (args.includes("app")) assert.ok(args.includes("full-dev"));
        return;
      }
      assert.equal(command, path.join(staged, f.plan.appName));
      assert.equal(cwd, staged);
      assert.deepEqual(args, ["--fixture-argument"]);
      assert.equal(env.GDK_BACKEND, "x11");
      const launchedIdentity = await lstat(command);
      assert.equal(launchedIdentity.ino, stagedIdentity.ino);
      assert.equal(launchedIdentity.birthtimeMs, stagedIdentity.birthtimeMs);
      assert.equal(
        await readFile(path.join(cwd, "locales/en.json"), "utf8"),
        '{"language":"en"}',
      );
      assert.equal((await lstat(path.join(cwd, ".cargo-lock"))).size, 0);
      launched.push(cwd);
    },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runCargo(
      ["run", "--features", "full-dev", "--", "--fixture-argument"],
      f.env,
      dependencies,
    );
    assert.equal(result.payload, launched.at(-1));
    assert.equal(result.productionReady, false);
    assert.ok(
      result.payload.endsWith(path.join("target", f.plan.target, "debug")),
    );
  }
  assert.equal(
    compiled,
    4,
    "application and sandbox helper still build on every run",
  );
  assert.notEqual(launched[0], launched[1]);
  assert.equal(
    await readFile(path.join(launched[0], "locales/0.pak")).then(
      (b) => b.length,
    ),
    4096,
  );
  // Reproduce just the old staging/copy work on the same synthetic input. No
  // Cargo, CEF, app launch, security shortcuts, or wall-clock claims involved.
  const legacy = path.join(f.root, "legacy");
  await mkdir(legacy);
  await copyTreeExclusive(source, path.join(legacy, "payload"));
  await copyTreeExclusive(
    path.join(legacy, "payload"),
    path.join(legacy, "launch"),
  );
  const legacyFiles = await inventory(legacy);
  const directFiles = (await inventory(launched[0])).filter(
    (file) =>
      file.path !== ".cargo-lock" &&
      file.path !== path.join("locales", "en.json"),
  );
  assert.equal(legacyFiles.length, 2 * directFiles.length);
  assert.equal(
    legacyFiles.reduce((sum, file) => sum + file.size, 0),
    2 * bytes,
  );
  assert.equal(
    directFiles.reduce((sum, file) => sum + file.size, 0),
    bytes,
  );
  t.diagnostic(
    `Synthetic per-rebuild staging: ${legacyFiles.length} -> ${directFiles.length} file copies; ${2 * bytes} -> ${bytes} copied/retained payload bytes. ${original.length} files and ${bytes} bytes eliminated.`,
  );
});

test("build keeps its fixed package/report/publication paths without launching", async (t) => {
  const f = await fixture(t);
  let builds = 0;
  const report = {
    ok: true,
    staging: { bundle: f.plan.payload },
    fixture: true,
  };
  const result = await runCargo(["build", "--release"], f.env, {
    run: async (command, args) => {
      assert.equal(command, "cargo");
      assert.ok(args.includes("--release"));
      builds++;
    },
    stage: async (_plan, { output }) => {
      assert.equal(output, f.plan.payload);
      await mkdir(output);
      return report;
    },
  });
  assert.equal(builds, 2);
  assert.deepEqual(result, {
    output: path.join(f.plan.publicTarget, f.plan.target, "release"),
    payload: f.plan.payload,
    productionReady: false,
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(f.root, "package.json"), "utf8")),
    report,
  );
  assert.match(
    await readFile(path.join(result.output, "app"), "utf8"),
    /GDK_BACKEND=x11/,
  );
  assert.equal(
    (await readdir(f.root)).filter((name) => name.startsWith("dev-")).length,
    0,
  );
});

test("failed staging and resource collisions never launch a partial payload", async (t) => {
  const f = await fixture(t);
  let launches = 0;
  const run = async (command) => {
    if (command !== "cargo") launches++;
  };
  await assert.rejects(
    runCargo(["run"], f.env, {
      run,
      stage: async () => ({ ok: false }),
    }),
    /package verification failed/,
  );
  const resource = path.join(f.root, "collision.pak");
  await writeFile(resource, "app resource");
  await writeFile(
    f.plan.configFile,
    JSON.stringify({ bundle: { resources: { [resource]: "locales/en.pak" } } }),
  );
  let staged;
  await assert.rejects(
    runCargo(["run"], f.env, {
      run,
      stage: async (_plan, { output }) => {
        staged = output;
        await mkdir(path.join(output, "locales"), { recursive: true });
        await writeFile(
          path.join(output, "locales/en.pak"),
          "verified runtime",
        );
        return { ok: true };
      },
    }),
    /exist|EEXIST/i,
  );
  assert.equal(
    await readFile(path.join(staged, "locales/en.pak"), "utf8"),
    "verified runtime",
  );
  assert.equal(launches, 0);
});

test("Windows import guard rejects malformed compiler output before staging or launch", async (t) => {
  const f = await fixture(t, "windows");
  const compiled = path.join(f.plan.cargoTarget, f.plan.target, "debug");
  await mkdir(compiled, { recursive: true });
  await writeFile(path.join(compiled, "app_lib.dll"), "not a PE image");
  let builds = 0;
  await assert.rejects(
    runCargo(["run"], f.env, {
      run: async (command) => {
        assert.equal(command, "cargo");
        builds++;
      },
      stage: async () => assert.fail("Rejected PE must never be staged"),
    }),
    /Browser client import guard/,
  );
  assert.equal(builds, 1);
  assert.equal(
    (await readdir(f.root)).filter((name) => name.startsWith("dev-")).length,
    0,
  );
});

test("a plan cannot silently lose its selected patched runtime", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.planFile,
    JSON.stringify({ ...f.plan, localRuntimeSelection: "required-selection" }),
  );
  await assert.rejects(
    runCargo(["run"], f.env, {
      run: async () => assert.fail("Invalid runtime selection must not build"),
      stage: async () =>
        assert.fail("Invalid runtime selection must not stage"),
    }),
    /no official fallback/,
  );
});

test("cache cleanup rejects a temporary directory replaced with an outside junction", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "unrelated");
  await mkdir(outside);
  await writeFile(path.join(outside, "keep"), "unchanged");
  await assert.rejects(
    immutableDevCache({
      cacheRoot: path.join(f.root, "cache"),
      kind: "sdk",
      key: "a".repeat(64),
      create: async (temporary) => {
        await rename(temporary, `${temporary}-original`);
        await symlink(
          outside,
          temporary,
          process.platform === "win32" ? "junction" : "dir",
        );
        throw new Error("synthetic preparation failure");
      },
      verify: async () => assert.fail("Incomplete cache must not verify"),
    }),
    /Refusing dev cache cleanup/,
  );
  assert.equal(await readFile(path.join(outside, "keep"), "utf8"), "unchanged");
});

test("importing the non-dev launcher does not load development staging modules", () => {
  const launcher = new URL("../../scripts/tauri.mjs", import.meta.url).href;
  const code = `
    import { registerHooks } from 'node:module';
    const loaded = [];
    registerHooks({ load(url, context, next) { loaded.push(url); return next(url, context); } });
    const { routeTauriArguments } = await import(${JSON.stringify(launcher)});
    if (routeTauriArguments(['info']).managed) throw new Error('unexpected dev route');
    process.stdout.write(JSON.stringify(loaded));
  `;
  const loaded = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "--eval", code], {
      encoding: "utf8",
      windowsHide: true,
    }),
  );
  assert.ok(loaded.some((url) => url.endsWith("tauri.mjs")));
  for (const script of [
    "tauri-dev.mjs",
    "stage-opkssh-vendor.mjs",
    "stage-file-viewer-host.mjs",
    "dev-port.mjs",
  ])
    assert.ok(
      !loaded.some((url) => url.endsWith(script)),
      `${script} should only load for dev`,
    );
});
