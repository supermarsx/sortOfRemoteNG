import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

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
} from "../../scripts/tauri-dev.mjs";

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
