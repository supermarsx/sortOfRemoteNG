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
  DEV_ISOLATED_IDENTIFIER,
  PRODUCTION_IDENTIFIER,
  buildDevSecurityOverride,
  buildTauriLaunchPlan,
  describeDevProfile,
  isolatedProfileIdentifier,
  parseDevProfileArguments,
  resolveKnownFolders,
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

const fixedSecurityOverride = Object.freeze({
  capabilities: [{ identifier: "test" }],
  csp: "default-src 'self'",
});
const deterministicPlanOptions = Object.freeze({
  nativeEnvironmentOptions: {
    platform: "win32",
    arch: "x64",
    exists: () => false,
  },
  buildResourceOptions: {
    resources: {
      parallelism: 8,
      totalMemoryBytes: 32 * 1024 ** 3,
      freeMemoryBytes: 16 * 1024 ** 3,
    },
  },
});
const windowsKnownFolders = Object.freeze({
  data: "C:\\Users\\dev\\AppData\\Roaming",
  localData: "C:\\Users\\dev\\AppData\\Local",
});
const managedEntrypoints = [
  ["tauri:dev", launchManagedDev, []],
  ["tauri dev", launchTauri, ["dev"]],
];

function configOverrideBytes(plan) {
  assert.equal(plan.tauriArgs[1], "-c");
  return plan.tauriArgs[2];
}

function realOverrideBytes(identifier) {
  return JSON.stringify({
    ...(identifier ? { identifier } : {}),
    build: { devUrl: "http://localhost:3042" },
    app: { security: buildDevSecurityOverride(3042) },
  });
}

function bannerFor(identifier, env = {}) {
  return describeDevProfile({
    identifier,
    devUrl: "http://localhost:3042",
    platform: "win32",
    env,
    knownFolders: windowsKnownFolders,
  });
}

// Runs a managed launch with every side effect faked: no lock, port, staging,
// Cargo or app process is touched.
async function launchWithFakes(launch, argv, env = {}) {
  const host = new EventEmitter();
  host.execPath = process.execPath;
  host.pid = process.pid;
  host.platform = "win32";
  host.exit = () => {};
  host.kill = () => assert.fail("unexpected parent signal");
  const child = new EventEmitter();
  child.killed = false;
  child.kill = () => {};
  const events = [];
  const staged = [];
  let spawned;
  await launch(argv, {
    process: host,
    env,
    log: (message) => events.push(message),
    assertNoManagedDevLock: () => {},
    resolveDevPort: async () => ({ port: 3042, action: "available" }),
    ...deterministicPlanOptions,
    resolveKnownFolders: (options) => {
      assert.equal(options.platform, "win32");
      assert.equal(options.env, env);
      return windowsKnownFolders;
    },
    prepareTauriDevOpkssh: (received) => staged.push(received),
    stageFileViewerHost: ({ argv: received }) => staged.push(received),
    spawn: (executable, received, options) => {
      events.push("spawn");
      spawned = { executable, args: received, options };
      return child;
    },
  });
  return { events, staged, spawned };
}

function assertLoggedBeforeSpawn(events, lines) {
  for (const line of lines) {
    const index = events.indexOf(line);
    assert.notEqual(index, -1, `missing banner line: ${line}`);
    assert.ok(index < events.indexOf("spawn"), `logged after spawn: ${line}`);
  }
}

test("default dev launch keeps the pre-isolation config override byte-identical", () => {
  const passthrough = ["--features", "full", "--", "--no-default-features"];
  const plan = buildTauriLaunchPlan({
    port: 3042,
    passthrough,
    baseEnv: {},
    securityOverride: fixedSecurityOverride,
  });

  // Golden bytes of the `-c` override the launcher passed before t91. Tauri
  // exports it as TAURI_CONFIG, an app crate build input, so a single changed
  // byte would rebuild the user's dev app.
  assert.equal(
    configOverrideBytes(plan),
    `{"build":{"devUrl":"http://localhost:3042"},"app":{"security":{"capabilities":[{"identifier":"test"}],"csp":"default-src 'self'"}}}`,
  );
  assert.deepEqual(plan.tauriArgs, [
    "dev",
    "-c",
    configOverrideBytes(plan),
    ...passthrough,
  ]);
  assert.equal(plan.identifier, PRODUCTION_IDENTIFIER);
  assert.deepEqual(
    buildTauriLaunchPlan({
      port: 3042,
      passthrough,
      baseEnv: {},
      securityOverride: fixedSecurityOverride,
      isolatedProfile: null,
    }).tauriArgs,
    plan.tauriArgs,
  );
  assert.equal(
    configOverrideBytes(buildTauriLaunchPlan({ port: 3042, baseEnv: {} })),
    realOverrideBytes(),
  );
  assert.deepEqual(parseDevProfileArguments(passthrough, {}), {
    isolatedProfile: null,
    passthrough,
  });
});

test("default tauri dev spawns the unchanged override after the production banner", async () => {
  const args = ["--features", "full", "--", "--no-default-features"];
  for (const [name, launch, prefix] of managedEntrypoints) {
    const { events, staged, spawned } = await launchWithFakes(launch, [
      ...prefix,
      ...args,
    ]);
    assert.deepEqual(
      spawned.args.slice(1),
      ["dev", "-c", realOverrideBytes(), ...args],
      name,
    );
    assert.deepEqual(staged, [args, args]);
    const banner = bannerFor(PRODUCTION_IDENTIFIER);
    assert.equal(banner.length, 1);
    assert.deepEqual(
      events.filter((event) => event.startsWith("dev profile:")),
      banner,
    );
    assertLoggedBeforeSpawn(events, banner);
  }
});

test("--isolated-profile adds only the dev identifier to the Tauri override", () => {
  const passthrough = ["--features", "full", "--", "--no-default-features"];
  const parsed = parseDevProfileArguments(
    ["--isolated-profile", ...passthrough],
    {},
  );
  assert.deepEqual(parsed, {
    isolatedProfile: "com.sortofremote.ng.dev",
    passthrough,
  });
  assert.equal(DEV_ISOLATED_IDENTIFIER, "com.sortofremote.ng.dev");

  const options = {
    port: 3042,
    passthrough,
    baseEnv: { PRESERVED: "yes" },
    securityOverride: fixedSecurityOverride,
    ...deterministicPlanOptions,
  };
  const shared = buildTauriLaunchPlan(options);
  const isolated = buildTauriLaunchPlan({
    ...options,
    isolatedProfile: parsed.isolatedProfile,
  });
  const override = JSON.parse(configOverrideBytes(isolated));
  assert.deepEqual(Object.keys(override), ["identifier", "build", "app"]);
  const { identifier, ...rest } = override;
  assert.equal(identifier, DEV_ISOLATED_IDENTIFIER);
  assert.deepEqual(rest, JSON.parse(configOverrideBytes(shared)));
  assert.equal(
    configOverrideBytes(isolated),
    `{"identifier":"com.sortofremote.ng.dev",${configOverrideBytes(shared).slice(1)}`,
  );
  assert.deepEqual(
    isolated.tauriArgs.toSpliced(2, 1),
    shared.tauriArgs.toSpliced(2, 1),
  );
  assert.deepEqual(isolated.env, shared.env);
  assert.equal(isolated.identifier, DEV_ISOLATED_IDENTIFIER);
  // Dev never enters e2e harness mode, which requires a per-run WebView2 folder.
  for (const key of [
    "SORNG_EXPECT_ISOLATED_PROFILE",
    "WEBVIEW2_USER_DATA_FOLDER",
    "TAURI_CONFIG",
  ])
    assert.equal(isolated.env[key], undefined, key);
});

test("tauri dev consumes --isolated-profile instead of forwarding it", async () => {
  const args = ["--features", "full"];
  for (const [name, launch, prefix] of managedEntrypoints) {
    for (const [flag, identifier] of [
      ["--isolated-profile", DEV_ISOLATED_IDENTIFIER],
      ["--isolated-profile=dev2", "com.sortofremote.ng.dev2"],
    ]) {
      for (const argv of [
        [...prefix, flag, ...args],
        [...prefix, ...args, flag],
      ]) {
        const { events, staged, spawned } = await launchWithFakes(launch, argv);
        assert.deepEqual(
          spawned.args.slice(1),
          ["dev", "-c", realOverrideBytes(identifier), ...args],
          `${name} ${argv.join(" ")}`,
        );
        assert.equal(
          spawned.args.slice(1).some((arg) => arg.includes("isolated-profile")),
          false,
        );
        assert.deepEqual(staged, [args, args]);
        assert.equal(
          spawned.options.env.SORNG_EXPECT_ISOLATED_PROFILE,
          undefined,
        );
        const banner = bannerFor(identifier);
        assert.equal(banner.length, 2);
        assertLoggedBeforeSpawn(events, banner);
      }
    }
  }
});

test("isolated dev profiles never reuse an e2e or README capture identifier", async () => {
  const harness = await import("../../scripts/lib/e2e-profile-isolation.mjs");
  const readConfig = (name) =>
    JSON.parse(
      readFileSync(new URL(`../../src-tauri/${name}`, import.meta.url), "utf8"),
    );
  assert.equal(readConfig("tauri.conf.json").identifier, PRODUCTION_IDENTIFIER);
  assert.equal(harness.PRODUCTION_IDENTIFIER, PRODUCTION_IDENTIFIER);

  const prefix = `${PRODUCTION_IDENTIFIER}.`;
  for (const reserved of [
    harness.E2E_IDENTIFIER,
    harness.README_CAPTURE_IDENTIFIER,
    readConfig("tauri.readme-screenshot.conf.json").identifier,
  ]) {
    assert.ok(reserved.startsWith(prefix), reserved);
    const suffix = reserved.slice(prefix.length);
    for (const candidate of [suffix, `${suffix}-2`]) {
      assert.throws(
        () => parseDevProfileArguments([`--isolated-profile=${candidate}`], {}),
        /is reserved/,
      );
      assert.throws(
        () =>
          buildTauriLaunchPlan({
            port: 3042,
            baseEnv: {},
            securityOverride: fixedSecurityOverride,
            isolatedProfile: `${prefix}${candidate}`,
          }),
        /is reserved/,
      );
    }
    assert.throws(
      () => parseDevProfileArguments([`--isolated-profile=${reserved}`], {}),
      /is invalid/,
    );
  }
  // Only the harness names and their slots are reserved.
  assert.equal(
    isolatedProfileIdentifier("e2eish"),
    "com.sortofremote.ng.e2eish",
  );
});

test("isolated profile arguments are refused before any launch side effect", async () => {
  assert.equal(isolatedProfileIdentifier("a".repeat(108)).length, 128);
  for (const [argv, env, pattern] of [
    [["--isolated-profile="], {}, /is invalid/],
    [["--isolated-profile=Dev"], {}, /is invalid/],
    [["--isolated-profile=dev.two"], {}, /is invalid/],
    [["--isolated-profile=../dev"], {}, /is invalid/],
    [["--isolated-profile=-dev"], {}, /is invalid/],
    [[`--isolated-profile=${"a".repeat(109)}`], {}, /exceeds 128/],
    [["--isolated-profile", "--isolated-profile=dev2"], {}, /given 2 times/],
    [["--features", "full", "--", "--isolated-profile"], {}, /before `--`/],
    [
      ["--features", "full"],
      { npm_config_isolated_profile: "true" },
      /npm run tauri dev -- --isolated-profile/,
    ],
  ]) {
    assert.throws(() => parseDevProfileArguments(argv, env), pattern);
    for (const [, launch, prefix] of managedEntrypoints) {
      await assert.rejects(
        launch([...prefix, ...argv], {
          process: new EventEmitter(),
          env,
          log: () => assert.fail("logged before argument validation"),
          assertNoManagedDevLock: () =>
            assert.fail("lock checked before argument validation"),
          resolveDevPort: async () =>
            assert.fail("port resolved before argument validation"),
          spawn: () => assert.fail("spawned with invalid profile arguments"),
        }),
        pattern,
      );
    }
  }
});

test("the launch plan never forwards the flag or accepts a non-dev identifier", () => {
  const options = {
    port: 3042,
    baseEnv: {},
    securityOverride: fixedSecurityOverride,
  };
  for (const passthrough of [
    ["--isolated-profile"],
    ["--features", "full", "--isolated-profile=dev2"],
    ["--", "--isolated-profile"],
  ])
    assert.throws(
      () => buildTauriLaunchPlan({ ...options, passthrough }),
      /never forwarded to Tauri/,
    );
  for (const isolatedProfile of [
    PRODUCTION_IDENTIFIER,
    "COM.SORTOFREMOTE.NG.dev",
    "com.example.dev",
    "dev",
    "com.sortofremote.ng.",
    true,
    false,
  ])
    assert.throws(
      () => buildTauriLaunchPlan({ ...options, isolatedProfile }),
      /isolatedProfile must be|is invalid/,
      String(isolatedProfile),
    );
});

test("the profile banner names the production or isolated profile", () => {
  assert.deepEqual(bannerFor(PRODUCTION_IDENTIFIER), [
    "dev profile: PRODUCTION (com.sortofremote.ng, shared with the installed app; your real data): data C:\\Users\\dev\\AppData\\Roaming\\com.sortofremote.ng, WebView2 C:\\Users\\dev\\AppData\\Local\\com.sortofremote.ng\\EBWebView, keychain production entries, origin http://localhost:3042. Use --isolated-profile for a separate, empty dev profile.",
  ]);
  assert.deepEqual(bannerFor(DEV_ISOLATED_IDENTIFIER), [
    "dev profile: ISOLATED (com.sortofremote.ng.dev, separate from the installed app): data C:\\Users\\dev\\AppData\\Roaming\\com.sortofremote.ng.dev, WebView2 C:\\Users\\dev\\AppData\\Local\\com.sortofremote.ng.dev\\EBWebView, keychain entries namespaced @com.sortofremote.ng.dev, origin http://localhost:3042.",
    "--isolated-profile compiles the app with identifier com.sortofremote.ng.dev, so the app crate rebuilds (and again on the next launch without the flag). This profile starts empty: no production connections, settings or vault key.",
  ]);
  // An inherited WebView2 override replaces Tauri's folder, so report it.
  assert.match(
    bannerFor(PRODUCTION_IDENTIFIER, {
      WEBVIEW2_USER_DATA_FOLDER: "D:\\wv2",
    })[0],
    /, WebView2 D:\\wv2\\EBWebView \(from WEBVIEW2_USER_DATA_FOLDER\), /,
  );
  assert.deepEqual(
    describeDevProfile({
      identifier: PRODUCTION_IDENTIFIER,
      devUrl: "http://localhost:3042",
      platform: "linux",
      env: {},
      knownFolders: {
        data: "/home/dev/.local/share",
        localData: "/home/dev/.local/share",
      },
    }),
    [
      "dev profile: PRODUCTION (com.sortofremote.ng, shared with the installed app; your real data): data /home/dev/.local/share/com.sortofremote.ng, keychain production entries, origin http://localhost:3042. Use --isolated-profile for a separate, empty dev profile.",
    ],
  );
});

test("known folders mirror the data roots Tauri joins the identifier onto", () => {
  assert.deepEqual(
    resolveKnownFolders({
      platform: "win32",
      env: { APPDATA: "E:\\Roaming", LOCALAPPDATA: "E:\\Local" },
      home: "C:\\Users\\dev",
    }),
    { data: "E:\\Roaming", localData: "E:\\Local" },
  );
  assert.deepEqual(
    resolveKnownFolders({ platform: "win32", env: {}, home: "C:\\Users\\dev" }),
    windowsKnownFolders,
  );
  const support = "/Users/dev/Library/Application Support";
  assert.deepEqual(
    resolveKnownFolders({ platform: "darwin", env: {}, home: "/Users/dev" }),
    { data: support, localData: support },
  );
  assert.deepEqual(
    resolveKnownFolders({
      platform: "linux",
      env: { XDG_DATA_HOME: "/srv/xdg" },
      home: "/home/dev",
    }),
    { data: "/srv/xdg", localData: "/srv/xdg" },
  );
  assert.deepEqual(
    resolveKnownFolders({
      platform: "linux",
      env: { XDG_DATA_HOME: "relative" },
      home: "/home/dev",
    }),
    { data: "/home/dev/.local/share", localData: "/home/dev/.local/share" },
  );
});
