import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  assertNoManagedDevLock,
  browserDevLockPath,
  managedDevLockPath,
  parseDevPort,
} from "../../scripts/dev-port.mjs";
import { resolveDevServerPlan } from "../../scripts/dev-server.mjs";
import {
  buildDevSecurityOverride,
  buildTauriLaunchPlan,
  main as launchManagedDev,
} from "../../scripts/tauri-dev.mjs";
import {
  routeTauriArguments,
  main as launchTauri,
} from "../../scripts/tauri.mjs";

test("package scripts keep both public dev commands on the tested launchers", () => {
  const { scripts } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(scripts.tauri, "node ./scripts/tauri.mjs");
  assert.equal(scripts["tauri:dev"], "node ./scripts/tauri-dev.mjs");
});

for (const [name, launch, prefix] of [
  ["tauri:dev", launchManagedDev, []],
  ["tauri dev", launchTauri, ["dev"]],
]) {
  for (const [target, machine, flags, crt] of [
    ["x86_64-pc-windows-msvc", "x64", "", "MD"],
    [
      "aarch64-pc-windows-msvc",
      "ARM64",
      "-C\x1ftarget-feature=+crt-static",
      "MT",
    ],
    ["i686-pc-windows-msvc", "x86", "-C\x1ftarget-feature=-crt-static", "MD"],
  ])
    test(`${name} executes staging and native child with normalized ${machine}/${crt} environment`, async () => {
      const root = join("fixture-scoop", "openssl", "current", "lib");
      const directory = join(root, "VC", machine, crt);
      const files = new Set(
        ["libssl_static.lib", "libcrypto_static.lib"].map((file) =>
          join(directory, file),
        ),
      );
      files.add("C:\\Strawberry\\perl\\bin");
      const baseEnv = Object.freeze({
        OPENSSL_LIB_DIR: root,
        OPENSSL_INCLUDE_DIR: "fixture-headers",
        CARGO_BUILD_TARGET: "x86_64-pc-windows-msvc",
        RUSTFLAGS: "-C target-feature=+crt-static",
        CARGO_ENCODED_RUSTFLAGS: flags,
        Path: "existing-path",
        SORNG_DEV_PORT: "3042",
      });
      const staged = [];
      const host = new EventEmitter();
      host.execPath = process.execPath;
      host.pid = process.pid;
      let status;
      host.exit = (code) => {
        status = code;
      };
      host.kill = () => assert.fail("unexpected parent signal");
      const child = new EventEmitter();
      child.killed = false;
      child.kill = (signal) => {
        child.killed = signal;
      };
      let actualChildEnvironment;
      const args = [`--target=${target}`, "--features", "full"];
      const returned = await launch([...prefix, ...args], {
        process: host,
        env: baseEnv,
        log: () => {},
        assertNoManagedDevLock: () => {},
        resolveDevPort: async () => ({ port: 3042, action: "available" }),
        nativeEnvironmentOptions: {
          platform: "win32",
          arch: "x64",
          exists: (file) => files.has(file),
        },
        buildResourceOptions: {
          resources: {
            parallelism: 40,
            totalMemoryBytes: 288 * 1024 ** 3,
            freeMemoryBytes: 230 * 1024 ** 3,
          },
        },
        prepareTauriDevOpkssh: (received, env) => {
          assert.deepEqual(received, args);
          staged.push(env);
        },
        stageFileViewerHost: ({ argv, env }) => {
          assert.deepEqual(argv, args);
          staged.push(env);
        },
        spawn: (executable, received, options) => {
          assert.equal(executable, process.execPath);
          assert.match(received[0], /tauri\.js$/u);
          assert.equal(received[1], "dev");
          assert.deepEqual(received.slice(-args.length), args);
          assert.equal(received.includes("--no-default-features"), false);
          assert.equal(options.shell, false);
          // Execute a real harmless Node child with exactly the launcher's env;
          // never start Cargo, stage files, bind a port or launch the user's app.
          const probe = spawnSync(
            process.execPath,
            [
              "-e",
              "process.stdout.write(JSON.stringify({lib:process.env.OPENSSL_LIB_DIR,libs:process.env.OPENSSL_LIBS,static:process.env.OPENSSL_STATIC,path:process.env.PATH||process.env.Path,port:process.env.SORNG_DEV_PORT,jobs:process.env.CARGO_BUILD_JOBS}))",
            ],
            { env: options.env, encoding: "utf8", windowsHide: true },
          );
          assert.equal(probe.status, 0, probe.stderr);
          actualChildEnvironment = JSON.parse(probe.stdout);
          assert.ok(staged.every((env) => env === options.env));
          return child;
        },
      });
      assert.equal(returned, child);
      assert.equal(staged.length, 2);
      assert.deepEqual(actualChildEnvironment, {
        lib: directory,
        libs: "libssl_static:libcrypto_static",
        static: "1",
        path: "C:\\Strawberry\\perl\\bin;existing-path",
        port: "3042",
        jobs: "32",
      });
      assert.equal(baseEnv.OPENSSL_LIB_DIR, root);
      assert.equal(baseEnv.OPENSSL_LIBS, undefined);
      assert.equal(baseEnv.Path, "existing-path");
      assert.equal(baseEnv.CARGO_BUILD_JOBS, undefined);
      child.emit("exit", 7, null);
      assert.equal(status, 7);
      host.emit("SIGINT");
      assert.equal(child.killed, "SIGINT");
    });
}

test("both normal development entrypoints use Cargo's full defaults", () => {
  assert.deepEqual(routeTauriArguments(["dev"]), { managed: true, args: [] });
  const plan = buildTauriLaunchPlan({ port: 3042, baseEnv: {} });
  assert.equal(plan.tauriArgs.includes("--no-default-features"), false);
  assert.equal(plan.tauriArgs.includes("lean"), false);
  assert.equal(plan.tauriArgs.includes("--features"), false);
});

test("explicit lean opt-out and all non-dev commands retain exact arguments", () => {
  const reduced = ["--features", "lean", "--", "--no-default-features"];
  const route = routeTauriArguments(["dev", ...reduced]);
  assert.equal(route.managed, true);
  const plan = buildTauriLaunchPlan({
    port: 3042,
    passthrough: route.args,
    baseEnv: {},
  });
  assert.deepEqual(plan.tauriArgs.slice(-reduced.length), reduced);
  for (const args of [
    [
      "build",
      "--features",
      "full-windows-dynamic",
      "--",
      "--no-default-features",
    ],
    ["--help"],
    ["info"],
  ])
    assert.deepEqual(routeTauriArguments(args), { managed: false, args });
});

test("standalone browser dev climbs to the first free port", async () => {
  const checked = [];
  const plan = await resolveDevServerPlan({
    argv: [],
    env: { SORNG_DEV_PORT: "3001" },
    isPortFreeFn: async (port) => {
      checked.push(port);
      return port === 3002;
    },
  });

  assert.equal(plan.port, 3002);
  assert.equal(plan.fixed, false);
  assert.equal(plan.action, "autoport");
  assert.deepEqual(checked, [3001, 3002]);
  assert.equal(plan.childEnv.SORNG_TAURI_MANAGED_DEV, undefined);
});

test("fixed Tauri dev refuses occupancy without climbing", async () => {
  const checked = [];

  await assert.rejects(
    resolveDevServerPlan({
      argv: ["--fixed-tauri-port"],
      env: { SORNG_DEV_PORT: "3001" },
      assertNoManagedDevLockFn: () => {},
      isPortFreeFn: async (port) => {
        checked.push(port);
        return false;
      },
    }),
    /Refusing to terminate the listener, climb to another port, or diverge/,
  );

  assert.deepEqual(checked, [3001]);
});

test("development ports are validated strictly", () => {
  for (const invalid of [0, -1, 65536, "", "3001x", "1.5", NaN]) {
    assert.throws(
      () => parseDevPort(invalid, "test port"),
      /integer between 1 and 65535/,
    );
  }

  assert.equal(parseDevPort(" 3001 "), 3001);
  assert.equal(parseDevPort(65535), 65535);
});

test("an existing managed Next lock rejects a duplicate launch", () => {
  const cwd = resolve("fixture-workspace");
  const managedLock = managedDevLockPath(cwd);

  assert.throws(
    () =>
      assertNoManagedDevLock({
        cwd,
        existsSyncFn: (candidate) => candidate === managedLock,
      }),
    /Refusing to start a second managed dev server/,
  );
});

test("a browser Next lock does not block Tauri-managed development", () => {
  const cwd = resolve("fixture-workspace");
  const browserLock = browserDevLockPath(cwd);
  const managedLock = managedDevLockPath(cwd);
  const checked = [];

  assert.doesNotThrow(() =>
    assertNoManagedDevLock({
      cwd,
      existsSyncFn: (candidate) => {
        checked.push(candidate);
        return candidate === browserLock;
      },
    }),
  );
  assert.deepEqual(checked, [managedLock]);
  assert.notEqual(browserLock, managedLock);
});

test("Tauri launch plan keeps port, devUrl, environment, and origin equal", () => {
  const securityOverride = {
    capabilities: [{ identifier: "test" }],
    csp: "default-src 'self'",
  };
  const plan = buildTauriLaunchPlan({
    port: 3042,
    passthrough: ["--features", "full-dev"],
    baseEnv: { PRESERVED: "yes" },
    securityOverride,
  });
  const configArgument = plan.tauriArgs[plan.tauriArgs.indexOf("-c") + 1];
  const override = JSON.parse(configArgument);

  assert.equal(plan.port, 3042);
  assert.equal(plan.devUrl, "http://localhost:3042");
  assert.equal(plan.env.SORNG_DEV_PORT, "3042");
  assert.equal(plan.env.SORNG_DEV_PORT_RESOLVED, "1");
  assert.equal(plan.env.SORNG_TAURI_MANAGED_DEV, "1");
  assert.equal(plan.env.PRESERVED, "yes");
  assert.equal(override.build.devUrl, plan.devUrl);
  assert.deepEqual(override.app.security, securityOverride);
  assert.deepEqual(plan.tauriArgs.slice(-2), ["--features", "full-dev"]);
});

test("Tauri development preserves the native window close contract", () => {
  const security = buildDevSecurityOverride(3042);
  const [capability] = security.capabilities;

  assert.deepEqual(capability.windows, ["main", "detached-*"]);
  assert.ok(capability.permissions.includes("core:window:allow-close"));
  assert.ok(capability.permissions.includes("core:window:allow-destroy"));
  assert.deepEqual(capability.remote, {
    urls: ["http://localhost:3042"],
  });
  assert.match(security.csp, /connect-src[^;]*\bipc:/);
  assert.match(security.csp, /connect-src[^;]*http:\/\/ipc\.localhost/);
});
