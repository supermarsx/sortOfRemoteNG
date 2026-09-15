// t84-e8 — contract tests for the disposable mock Synology DSM E2E fixture.
//
// Named `*.node-test.mjs` (like tests/e2e-mock-pve) so Vitest discovery skips
// it: run with `node --test tests/e2e-mock-dsm/*.node-test.mjs`.
//
// These run without the desktop binary, so the gate can prove the fixture
// still speaks the DSM wire protocol `sorng-synology` sends — and still
// reproduces the user's exact 38-byte code-105 reply — even when the WDIO
// spec is not executed.
//
// t84-e8b: the section probes and loaders of the t84 Rust branch send their
// real DSM requests (`api_access.rs` READS); the tests below replay them in
// the app's form order, on both wires, and assert the fixture recorded no
// unexpected request.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MOCK_DSM_PORT,
  MOCK_DSM_ACCOUNTS,
  MOCK_DSM_CPU,
  MOCK_DSM_DEVICE_ID,
  MOCK_DSM_FIREWALL_ADAPTERS,
  MOCK_DSM_HOSTNAME,
  MOCK_DSM_INITDATA_PADDING_BYTES,
  MOCK_DSM_OTP_CODE,
  MOCK_DSM_PROJECTS,
  MOCK_DSM_SERIAL,
  MOCK_DSM_SMART_DISK,
  PERMISSION_DENIED_BODY,
  WIRE_MODES,
  startMockDsm,
} from "../../e2e/helpers/fixtures/mock-dsm/server.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const serverPath = path.join(
  repoRoot,
  "e2e",
  "helpers",
  "fixtures",
  "mock-dsm",
  "server.mjs",
);

// No keep-alive: pooled sockets would keep the runner alive after `stop()`.
const agent = new http.Agent({ keepAlive: false });

async function mock(context, options = {}) {
  const handle = await startMockDsm({ port: 0, ...options });
  context.after(() => handle.stop());
  return handle;
}

/**
 * DSM-style request: api/version/method in the query string (as
 * `SynoClient::resolve_url` builds it), everything else form-encoded.
 */
function call(
  handle,
  {
    api,
    version = 1,
    method,
    form = {},
    headers = {},
    gateway = "entry.cgi",
    httpMethod = "POST",
    rawQuery,
  } = {},
) {
  const query =
    rawQuery ??
    (api
      ? `?${new URLSearchParams({ api, version: String(version), method })}`
      : "");
  const body =
    httpMethod === "POST" ? new URLSearchParams(form).toString() : "";
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        host: handle.host,
        port: handle.port,
        method: httpMethod,
        path: `/webapi/${gateway}${query}`,
        agent,
        headers: {
          ...headers,
          ...(httpMethod === "POST"
            ? {
                "content-type": "application/x-www-form-urlencoded",
                "content-length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(buffer.toString("utf8"));
          } catch {
            /* surfaced by the assertions */
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            bytes: buffer.length,
            text: buffer.toString("utf8"),
            json,
          });
        });
      },
    );
    outgoing.on("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

const cookieValue = (response, name) =>
  (response.headers["set-cookie"] ?? [])
    .map((cookie) => cookie.split(";")[0])
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);

async function login(handle, username, extra = {}, version = 6) {
  const entry = MOCK_DSM_ACCOUNTS[username];
  return call(handle, {
    api: "SYNO.API.Auth",
    version,
    method: "login",
    form: {
      account: entry?.username ?? username,
      passwd: entry?.password ?? "wrong",
      session: "FileStation",
      format: "cookie",
      enable_syno_token: "yes",
      ...extra,
    },
  });
}

/** Log in and return a function that calls authenticated APIs like the app. */
async function session(handle, username, extra = {}) {
  const response = await login(handle, username, extra);
  assert.equal(response.json?.success, true, response.text);
  const { sid, synotoken } = response.json.data;
  return {
    response,
    sid,
    synotoken,
    request: (api, method, version = 1, form = {}) =>
      call(handle, {
        api,
        version,
        method,
        form: { ...form, _sid: sid, SynoToken: synotoken },
        headers: { "X-SYNO-TOKEN": synotoken },
      }),
  };
}

const assertDsmCode = (response, code) => {
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { error: { code }, success: false });
};

const assertExactPermissionDenied = (response) => {
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /^application\/json/u);
  assert.equal(response.text, PERMISSION_DENIED_BODY);
  assert.equal(response.bytes, 38);
  assert.equal(response.headers["content-length"], "38");
};

// ───────────────────────────────────────────────────────────── discovery ──

test("API.Info advertises the NAS API surface at entry.cgi without UIConfig by default", async (t) => {
  const handle = await mock(t);
  // Discovery POSTs the whole query in the form body (discover_at).
  const response = await call(handle, {
    form: {
      api: "SYNO.API.Info",
      version: "1",
      method: "query",
      query: "all",
    },
  });
  assert.equal(response.json.success, true);
  const apis = response.json.data;
  for (const name of [
    "SYNO.API.Info",
    "SYNO.API.Auth",
    "SYNO.API.Auth.Type",
    "SYNO.DSM.Info",
    "SYNO.FileStation.Info",
    "SYNO.FileStation.List",
    "SYNO.Core.Desktop.Initdata",
    "SYNO.Core.System.Utilization",
    "SYNO.Core.User",
    "SYNO.Core.Group",
  ]) {
    assert.equal(apis[name]?.path, "entry.cgi", name);
  }
  assert.deepEqual(
    {
      min: apis["SYNO.API.Auth"].minVersion,
      max: apis["SYNO.API.Auth"].maxVersion,
    },
    { min: 1, max: 7 },
  );
  // DSM 7 catalog (t84-r1 audit §6): DSM.Info is 2..2, Auth has no requestFormat.
  assert.deepEqual(apis["SYNO.DSM.Info"], {
    path: "entry.cgi",
    minVersion: 2,
    maxVersion: 2,
    requestFormat: "JSON",
  });
  assert.equal(apis["SYNO.API.Auth"].requestFormat, undefined);
  for (const name of [
    "SYNO.FileStation.Info",
    "SYNO.FileStation.List",
    "SYNO.Core.Desktop.Initdata",
    "SYNO.Core.System.Utilization",
    "SYNO.Core.User",
    "SYNO.Core.Group",
  ]) {
    assert.equal(apis[name].requestFormat, "JSON", name);
  }
  assert.equal("SYNO.API.Auth.UIConfig" in apis, false);
  // Absent on real DSM 7; the fixture must not invent them.
  for (const name of [
    "SYNO.Core.Hardware.Info",
    "SYNO.Core.Notification.Setting",
    "SYNO.Core.DHCP.Server",
    "SYNO.ContainerManager.Project",
  ]) {
    assert.equal(name in apis, false, name);
  }

  // query.cgi GET fallback serves discovery only.
  const fallback = await call(handle, {
    gateway: "query.cgi",
    httpMethod: "GET",
    api: "SYNO.API.Info",
    method: "query",
  });
  assert.equal(fallback.json.success, true);
  const wrongGateway = await call(handle, {
    gateway: "query.cgi",
    httpMethod: "GET",
    api: "SYNO.DSM.Info",
    version: 2,
    method: "getinfo",
  });
  assertDsmCode(wrongGateway, 102);
});

test("unknown APIs, methods, versions and paths use DSM's codes", async (t) => {
  const handle = await mock(t);
  assertDsmCode(
    await call(handle, { api: "SYNO.Core.Nope", method: "get" }),
    102,
  );
  assertDsmCode(
    await call(handle, { api: "SYNO.DSM.Info", version: 2, method: "reboot" }),
    103,
  );
  assertDsmCode(
    await call(handle, { api: "SYNO.DSM.Info", version: 9, method: "getinfo" }),
    104,
  );
  assertDsmCode(
    await call(handle, { api: "SYNO.DSM.Info", version: 1, method: "getinfo" }),
    104,
  );
  assertDsmCode(await call(handle, { rawQuery: "" }), 101);
  // UIConfig does not exist unless the no_reply mode advertises it.
  assertDsmCode(
    await call(handle, { api: "SYNO.API.Auth.UIConfig", method: "get" }),
    102,
  );
  const notWebapi = await call(handle, {
    gateway: "../index.cgi",
    rawQuery: "",
  });
  assert.equal(notWebapi.status, 404);
});

// ──────────────────────────────────────────────────────────────── sessions ──

test("admin login sets the id cookie, returns sid + synotoken and reads admin data", async (t) => {
  const handle = await mock(t);
  const admin = await session(handle, "admin");
  assert.equal(admin.response.json.data.is_portal_port, false);
  assert.equal(cookieValue(admin.response, "id"), admin.sid);
  assert.ok(admin.synotoken);

  assert.equal(admin.response.json.data.account, undefined);

  const info = await admin.request("SYNO.DSM.Info", "getinfo", 2);
  assert.equal(info.json.success, true);
  assert.equal(info.json.data.serial, MOCK_DSM_SERIAL);
  assert.equal(info.json.data.codepage, "enu");
  assert.equal(typeof info.json.data.version_string, "string");
  // cpu_* / sys_temp belong to SYNO.Core.System info, not DSM.Info.
  assert.equal(
    Object.keys(info.json.data).some(
      (key) => key.startsWith("cpu_") || key === "sys_temp",
    ),
    false,
  );

  const initdata = await admin.request("SYNO.Core.Desktop.Initdata", "get");
  assert.equal(initdata.json.data.Session.is_admin, true);
  // A large unknown key the app's Initdata decoder must ignore.
  assert.equal(
    initdata.json.data.Strings.common.mock_padding.length,
    MOCK_DSM_INITDATA_PADDING_BYTES,
  );
  assert.ok(initdata.bytes > MOCK_DSM_INITDATA_PADDING_BYTES);

  const fsInfo = await admin.request("SYNO.FileStation.Info", "get", 2);
  assert.deepEqual(fsInfo.json.data.support_virtual_protocol, [
    "cifs",
    "nfs",
    "iso",
  ]);
  const shares = await admin.request("SYNO.FileStation.List", "list_share", 2);
  assert.deepEqual(
    [shares.json.data.offset, shares.json.data.total],
    [0, shares.json.data.shares.length],
  );
  assert.equal(shares.json.data.shares[0].path, "/e2e-share");
  assert.equal(
    shares.json.data.shares[0].additional.real_path,
    "/volume1/e2e-share",
  );
  const folder = await admin.request("SYNO.FileStation.List", "list", 2, {
    folder_path: JSON.stringify("/e2e-share"),
  });
  assert.equal(folder.json.data.files[0].name, "readme.txt");
  // Unquoted string params are accepted too (audit §7 open unknown 7).
  const unquoted = await admin.request("SYNO.FileStation.List", "list", 2, {
    folder_path: "/e2e-share",
  });
  assert.equal(unquoted.json.success, true);
});

test("the real wire serves DSM's Utilization, User and Group shapes", async (t) => {
  const handle = await mock(t);
  assert.equal(handle.wire, "real");
  const admin = await session(handle, "admin");

  const { data: utilization } = (
    await admin.request("SYNO.Core.System.Utilization", "get")
  ).json;
  assert.deepEqual(utilization.cpu, MOCK_DSM_CPU);
  assert.ok(Array.isArray(utilization.network));
  assert.equal(Array.isArray(utilization.disk), false);
  assert.ok(Array.isArray(utilization.disk.disk));
  assert.equal(utilization.disk.disk[0].display_name, "Drive 1");
  assert.equal(utilization.disk.total.device, "total");
  assert.deepEqual(utilization.lun, []);
  assert.ok(Array.isArray(utilization.space.volume));
  assert.equal(utilization.memory.device, "Memory");
  assert.equal(typeof utilization.time, "number");

  const { data: users } = (
    await admin.request("SYNO.Core.User", "list", 1, {
      offset: "0",
      limit: "500",
    })
  ).json;
  assert.deepEqual(Object.keys(users).sort(), ["offset", "total", "users"]);
  assert.equal(users.total, users.users.length);
  assert.deepEqual(
    users.users.map((user) => user.name),
    ["admin", "viewer"],
  );
  assert.equal(
    users.users.some((user) => "uid" in user),
    false,
  );

  const { data: groups } = (await admin.request("SYNO.Core.Group", "list"))
    .json;
  assert.deepEqual(Object.keys(groups).sort(), ["groups", "offset", "total"]);
  assert.deepEqual(
    groups.groups.map((group) => [group.name, group.gid]),
    [
      ["administrators", 101],
      ["users", 100],
    ],
  );
  assert.equal(
    groups.groups.some((group) => "members" in group),
    false,
  );
});

test("the legacy wire serves the pre-t84 decoder shapes for both-shape checks", async (t) => {
  const handle = await mock(t, { wire: "legacy" });
  assert.equal(handle.snapshot().wire, "legacy");
  const admin = await session(handle, "admin");

  const { data: utilization } = (
    await admin.request("SYNO.Core.System.Utilization", "get")
  ).json;
  assert.deepEqual(utilization.cpu, MOCK_DSM_CPU);
  assert.ok(Array.isArray(utilization.disk));
  assert.equal(utilization.disk[0].display_name, "Drive 1");

  const users = (await admin.request("SYNO.Core.User", "list")).json.data;
  assert.ok(Array.isArray(users));
  assert.ok(users.every((user) => Number.isInteger(user.uid)));
  const groups = (await admin.request("SYNO.Core.Group", "list")).json.data;
  assert.ok(Array.isArray(groups));
  assert.ok(groups.every((group) => Array.isArray(group.members)));

  // Everything outside the three decoder-breaking shapes is identical.
  const info = await admin.request("SYNO.DSM.Info", "getinfo", 2);
  assert.equal(info.json.data.codepage, "enu");

  const enrolled = await login(handle, "otp", {
    otp_code: MOCK_DSM_OTP_CODE,
    enable_device_token: "yes",
    device_name: "SortOfRemoteNG · E2E-HOST",
  });
  assert.equal(enrolled.json.data.did, MOCK_DSM_DEVICE_ID);
  assert.equal(enrolled.json.data.device_id, undefined);
});

// ─────────────────────────────────────── t84 section probes and loaders ──

/** A string value as `wire::string_param` sends it to a JSON-format API. */
const q = (value) => JSON.stringify(value);

const FIREWALL_ADAPTER = "SYNO.Core.Security.Firewall.Adapter";
const FIREWALL_RULES = "SYNO.Core.Security.Firewall.Rules";
const ACTIVE_BACKUP_DEVICE = "SYNO.ActiveBackup.Device";
const AUTO_BLOCK_RULES = "SYNO.Core.Security.AutoBlock.Rules";
const SYSLOG = "SYNO.Core.SyslogClient.Log";
const SERVICE = "SYNO.Core.Service";
const CONTAINER = "SYNO.Docker.Container";
const PROJECT = "SYNO.Docker.Project";
const BACKUP_TASK = "SYNO.Backup.Task";
const SMART = "SYNO.Storage.CGI.Smart";

/** An envelope's rows on the real wire, the bare array on the legacy wire. */
function listRows(data, wire, key) {
  const rows = wire === "legacy" ? data : data?.[key];
  assert.ok(Array.isArray(rows), `${wire} ${key}: ${JSON.stringify(data)}`);
  return rows;
}

/**
 * What `t84/r-int` sends for the reads t84-e8b added, in its form order: the
 * section probe (READS, `params` then `string_params`) and the loader's
 * requests (`limit` from the managers, `get_system_logs(0, 100)`).
 */
const T84_READS = [
  {
    name: "firewallRules probe (Firewall.Adapter list)",
    api: FIREWALL_ADAPTER,
    method: "list",
    check: (data) =>
      assert.deepEqual(data, {
        adapter_names: [...MOCK_DSM_FIREWALL_ADAPTERS],
      }),
  },
  {
    name: "firewallRules loader (Rules load global)",
    api: FIREWALL_RULES,
    method: "load",
    form: { adapter: q("global") },
    check: (data) => {
      assert.deepEqual(Object.keys(data).sort(), ["policy", "rules", "total"]);
      assert.equal(data.rules.length, 1);
      assert.equal(data.rules[0].policy, "allow");
    },
  },
  {
    name: "firewallRules loader (Rules load ovs_eth0)",
    api: FIREWALL_RULES,
    method: "load",
    form: { adapter: q("ovs_eth0") },
    check: (data) =>
      assert.deepEqual(data, { policy: "allow", rules: [], total: 0 }),
  },
  {
    name: "activeBackupDevices probe and loader",
    api: ACTIVE_BACKUP_DEVICE,
    method: "list",
    check: (data, wire) => {
      const [device] = listRows(data, wire, "devices");
      assert.equal(device.host_name, "mock-pc-01");
      assert.equal(typeof device.backup_type, "number");
      if (wire === "real") assert.equal(data.total, 1);
    },
  },
  {
    name: "blockedIps probe",
    api: AUTO_BLOCK_RULES,
    method: "list",
    form: { offset: "0", limit: "1", type: q("deny") },
    check: (data, wire) => {
      assert.deepEqual(
        listRows(data, wire, "ip_info").map((row) => row.ip),
        ["198.51.100.9"],
      );
      if (wire === "real") assert.equal(data.total, 2);
    },
  },
  {
    name: "blockedIps loader",
    api: AUTO_BLOCK_RULES,
    method: "list",
    form: { offset: "0", limit: "1000", type: q("deny") },
    check: (data, wire) =>
      assert.equal(listRows(data, wire, "ip_info").length, 2),
  },
  {
    name: "systemLogs probe",
    api: SYSLOG,
    method: "list",
    form: {
      start: "0",
      offset: "0",
      limit: "1",
      target: q("LOCAL"),
      logtype: q("system"),
    },
    check: (data, wire) => {
      const items = listRows(data, wire, "items");
      assert.equal(items.length, 1);
      assert.equal(items[0].orginalLogType, "system");
      assert.equal(typeof items[0].time, "string");
      if (wire === "real") {
        assert.deepEqual(
          [data.total, data.infoCount, data.warnCount, data.errorCount],
          [2, 1, 1, 0],
        );
      }
    },
  },
  {
    name: "systemLogs loader",
    api: SYSLOG,
    method: "list",
    form: {
      start: "0",
      offset: "0",
      limit: "100",
      target: q("LOCAL"),
      logtype: q("system"),
    },
    check: (data, wire) =>
      assert.deepEqual(
        listRows(data, wire, "items").map((row) => row.orginalLogType),
        ["system", "system"],
      ),
  },
  {
    name: "services probe and loader (v3)",
    api: SERVICE,
    version: 3,
    method: "get",
    form: { additional: '["active_status"]' },
    check: (data, wire) => {
      const rows = listRows(data, wire, "service");
      assert.deepEqual(
        rows.map((row) => [
          row.service_id,
          row.enable_status,
          row.additional.active_status,
        ]),
        [
          ["ssh-shell", "enabled", "active"],
          ["atalk", "disabled", "inactive"],
          ["synoscgi", "static", "active"],
        ],
      );
      assert.ok(rows.every((row) => row.display_name_section_key));
    },
  },
  {
    name: "dockerContainers probe",
    api: CONTAINER,
    method: "list",
    form: { offset: "0", limit: "1", type: q("all") },
    check: (data, wire) => {
      const [container] = listRows(data, wire, "containers");
      assert.equal(container.name, "web");
      if (wire === "real") {
        assert.deepEqual([data.limit, data.offset, data.total], [1, 0, 2]);
        assert.equal(container.State.Status, "running");
        assert.equal(container.up_time, null);
        assert.equal(typeof container.created, "number");
      } else {
        assert.equal(container.State, undefined);
        assert.equal(typeof container.created, "string");
        assert.equal(typeof container.up_time, "number");
      }
    },
  },
  {
    name: "dockerContainers loader",
    api: CONTAINER,
    method: "list",
    form: { limit: "500", offset: "0", type: q("all") },
    check: (data, wire) =>
      assert.deepEqual(
        listRows(data, wire, "containers").map((row) => row.status),
        ["running", "exited"],
      ),
  },
  {
    name: "dockerProjects probe and loader (Docker.Project list)",
    api: PROJECT,
    method: "list",
    check: (data, wire) => {
      if (wire === "legacy") {
        assert.deepEqual(
          data.map((project) => [project.name, project.id, project.status]),
          [
            ["stack", MOCK_DSM_PROJECTS.stack, "RUNNING"],
            ["tools", MOCK_DSM_PROJECTS.tools, "STOPPED"],
          ],
        );
        assert.deepEqual(data[0].services, ["stack (project)"]);
        return;
      }
      assert.equal(Array.isArray(data), false);
      assert.deepEqual(Object.keys(data), Object.values(MOCK_DSM_PROJECTS));
      for (const [id, project] of Object.entries(data)) {
        assert.equal(project.id, id);
      }
      assert.equal(
        data[MOCK_DSM_PROJECTS.stack].services[0].type,
        "reverse_proxy",
      );
    },
  },
  {
    name: "backupTasks probe and loader",
    api: BACKUP_TASK,
    method: "list",
    form: {
      additional:
        '["last_bkp_time","next_bkp_time","last_bkp_result","is_modified"]',
    },
    check: (data, wire) => {
      const [task] = listRows(data, wire, "task_list");
      assert.deepEqual(
        [
          task.task_id,
          task.last_bkp_end_time,
          task.next_bkp_time,
          task.last_bkp_result,
          task.is_modified,
        ],
        [1, "2026/09/14 02:12:30", "2026/09/15 02:00", "done", false],
      );
      if (wire === "real") assert.equal(data.is_restoring, false);
    },
  },
];

/** The reads the fixture already served, with the probes' and loaders' params. */
const CORE_READS = [
  { api: "SYNO.DSM.Info", version: 2, method: "getinfo" },
  { api: "SYNO.Core.System.Utilization", method: "get" },
  { api: "SYNO.FileStation.Info", version: 2, method: "get" },
  { api: "SYNO.Core.Desktop.Initdata", method: "get" },
  { api: "SYNO.Core.User", method: "list", form: { offset: "0", limit: "1" } },
  {
    api: "SYNO.Core.User",
    method: "list",
    form: {
      offset: "0",
      limit: "500",
      additional: '["email","description","expired"]',
    },
  },
  { api: "SYNO.Core.Group", method: "list", form: { offset: "0", limit: "1" } },
  {
    api: "SYNO.Core.Group",
    method: "list",
    form: { offset: "0", limit: "500" },
  },
];

test("API.Info lists the t84 section-read APIs with DSM 7's JSON request format", async (t) => {
  const handle = await mock(t);
  const { data: apis } = (
    await call(handle, {
      form: {
        api: "SYNO.API.Info",
        version: "1",
        method: "query",
        query: "all",
      },
    })
  ).json;
  for (const [name, maxVersion] of [
    [FIREWALL_ADAPTER, 1],
    [FIREWALL_RULES, 1],
    [ACTIVE_BACKUP_DEVICE, 1],
    [AUTO_BLOCK_RULES, 1],
    [SYSLOG, 1],
    [SERVICE, 3],
    [CONTAINER, 1],
    [PROJECT, 1],
    [BACKUP_TASK, 1],
    [SMART, 1],
  ]) {
    assert.deepEqual(
      apis[name],
      {
        path: "entry.cgi",
        minVersion: 1,
        maxVersion,
        requestFormat: "JSON",
      },
      name,
    );
  }
  // The pre-t84 device read is gone, and there is still no Container Manager
  // project API, so the app reads Docker.Project.
  assert.equal("SYNO.ActiveBackup.Overview" in apis, false);
  assert.equal("SYNO.ContainerManager.Project" in apis, false);
  assert.deepEqual(handle.snapshot().unexpected, []);
});

for (const wire of WIRE_MODES) {
  test(`${wire} wire: every t84 probe and loader request succeeds for an administrator with no unexpected request`, async (t) => {
    const handle = await mock(t, { wire });
    const admin = await session(handle, "admin");

    for (const read of T84_READS) {
      const response = await admin.request(
        read.api,
        read.method,
        read.version ?? 1,
        read.form ?? {},
      );
      assert.equal(
        response.json?.success,
        true,
        `${read.name}: ${response.text}`,
      );
      read.check(response.json.data, wire);
    }
    for (const read of CORE_READS) {
      const response = await admin.request(
        read.api,
        read.method,
        read.version ?? 1,
        read.form ?? {},
      );
      assert.equal(
        response.json?.success,
        true,
        `${read.api}: ${response.text}`,
      );
    }

    const snapshot = handle.snapshot();
    assert.deepEqual(snapshot.unexpected, []);
    assert.equal(
      snapshot.calls.length,
      1 + T84_READS.length + CORE_READS.length,
    );
    assert.ok(snapshot.calls.every((entry) => entry.code === 0));
  });
}

test("standard and handshake-less remote sessions still get the exact 105 on the t84 reads", async (t) => {
  const handle = await mock(t);
  for (const name of ["viewer", "remote-admin"]) {
    const user = await session(handle, name);
    for (const read of T84_READS) {
      assertExactPermissionDenied(
        await user.request(read.api, read.method, read.version ?? 1, read.form),
      );
    }
    assertExactPermissionDenied(
      await user.request(SMART, "get_health_info", 1, {
        disk: q(MOCK_DSM_SMART_DISK),
      }),
    );
  }
  const snapshot = handle.snapshot();
  assert.deepEqual(snapshot.unexpected, []);
  assert.deepEqual(
    [
      ...new Set(
        snapshot.calls
          .filter((entry) => entry.api !== "SYNO.API.Auth")
          .map(
            (entry) => `${entry.account} ${entry.sessionKind} ${entry.code}`,
          ),
      ),
    ],
    ["viewer full 105", "remote-admin limited 105"],
  );
});

test("wrong read parameters get DSM's codes and are recorded without their values", async (t) => {
  const handle = await mock(t);
  const admin = await session(handle, "admin");
  // [api, version, method, form, DSM code (0 = served), recorded [kind, param]]
  const cases = [
    // The pre-t84 calls.
    [FIREWALL_RULES, 1, "list_all", {}, 103, [["unknown_method", null]]],
    [
      "SYNO.ActiveBackup.Overview",
      1,
      "list_device",
      {},
      102,
      [["unknown_api", null]],
    ],
    [
      AUTO_BLOCK_RULES,
      1,
      "list",
      {},
      5100,
      [
        ["missing_param", "offset"],
        ["missing_param", "limit"],
        ["missing_param", "type"],
      ],
    ],
    [
      SYSLOG,
      1,
      "list",
      { offset: "0", limit: "1" },
      114,
      [["missing_param", "start"]],
    ],
    [
      CONTAINER,
      1,
      "list",
      { offset: "0", limit: "1" },
      114,
      [["missing_param", "type"]],
    ],
    [SERVICE, 4, "get", {}, 104, [["unsupported_version", null]]],
    // Missing or unreadable values.
    [FIREWALL_RULES, 1, "load", {}, 120, [["missing_param", "adapter"]]],
    [
      FIREWALL_RULES,
      1,
      "load",
      { adapter: q("eth9-private") },
      120,
      [["invalid_param", "adapter"]],
    ],
    [
      SYSLOG,
      1,
      "list",
      { start: "0", limit: "1", target: q("REMOTE-private") },
      120,
      [["invalid_param", "target"]],
    ],
    [
      SERVICE,
      3,
      "get",
      { additional: "active_status" },
      120,
      [["invalid_param", "additional"]],
    ],
    [
      SMART,
      1,
      "get_health_info",
      { disk_id: q(MOCK_DSM_SMART_DISK) },
      114,
      [
        ["unexpected_param", "disk_id"],
        ["missing_param", "disk"],
      ],
    ],
    // Served, but not what the app sends.
    [
      AUTO_BLOCK_RULES,
      1,
      "list",
      { offset: "0", limit: "1", type: "deny" },
      0,
      [["unquoted_string", "type"]],
    ],
    [
      BACKUP_TASK,
      1,
      "list",
      { sort_by: q("name"), passwd: MOCK_DSM_ACCOUNTS.admin.password },
      0,
      [
        ["unexpected_param", "sort_by"],
        ["unexpected_param", "passwd"],
      ],
    ],
  ];

  for (const [api, version, method, form, code, recorded] of cases) {
    const label = `${api} v${version} ${method} ${JSON.stringify(form)}`;
    const before = handle.snapshot().unexpected.length;
    const response = await admin.request(api, method, version, form);
    if (code) {
      assertDsmCode(response, code);
    } else {
      assert.equal(response.json?.success, true, label);
    }
    const entries = handle.snapshot().unexpected.slice(before);
    assert.deepEqual(
      entries.map((entry) => [entry.kind, entry.param]),
      recorded,
      label,
    );
    for (const entry of entries) {
      assert.deepEqual(
        [entry.api, entry.version, entry.method, entry.code],
        [api, version, method, code],
        label,
      );
      // The session is known only once the API, method and version exist.
      assert.equal(entry.account, code >= 102 && code <= 104 ? null : "admin");
    }
  }

  const text = JSON.stringify(handle.snapshot().unexpected);
  for (const value of [
    "eth9-private",
    "REMOTE-private",
    "active_status",
    MOCK_DSM_ACCOUNTS.admin.password,
    admin.sid,
    admin.synotoken,
  ]) {
    assert.equal(text.includes(value), false, `unexpected leaked ${value}`);
  }
});

for (const wire of WIRE_MODES) {
  test(`${wire} wire: Docker project start/stop lists the projects first, then acts by id`, async (t) => {
    const handle = await mock(t, { wire });
    const admin = await session(handle, "admin");
    const projects = async () => {
      const { data } = (await admin.request(PROJECT, "list")).json;
      return wire === "legacy" ? data : Object.values(data);
    };
    // DockerManager::project_action: exactly one project matches the name or
    // the id, and the action sends that project's JSON-quoted id.
    const act = async (method, nameOrId) => {
      const matches = (await projects()).filter(
        (project) => project.name === nameOrId || project.id === nameOrId,
      );
      assert.equal(matches.length, 1, nameOrId);
      return admin.request(PROJECT, method, 1, { id: q(matches[0].id) });
    };
    const statuses = async () =>
      Object.fromEntries(
        (await projects()).map((project) => [project.name, project.status]),
      );

    assert.deepEqual((await act("start", "tools")).json, { success: true });
    assert.deepEqual((await act("stop", MOCK_DSM_PROJECTS.stack)).json, {
      success: true,
    });
    assert.deepEqual(await statuses(), { stack: "STOPPED", tools: "RUNNING" });
    assert.deepEqual(
      handle
        .snapshot()
        .calls.filter((entry) => entry.api === PROJECT)
        .map((entry) => [entry.method, entry.code]),
      [
        ["list", 0],
        ["start", 0],
        ["list", 0],
        ["stop", 0],
        ["list", 0],
      ],
    );
    assert.deepEqual(handle.snapshot().unexpected, []);

    // The pre-t84 action by name, and an id DSM does not know.
    assertDsmCode(
      await admin.request(PROJECT, "start", 1, { name: q("stack") }),
      114,
    );
    assertDsmCode(
      await admin.request(PROJECT, "stop", 1, {
        id: q("00000000-0000-4000-8000-00000000ffff"),
      }),
      120,
    );
    assert.deepEqual(
      handle
        .snapshot()
        .unexpected.map((entry) => [entry.method, entry.kind, entry.param]),
      [
        ["start", "unexpected_param", "name"],
        ["start", "missing_param", "id"],
        ["stop", "invalid_param", "id"],
      ],
    );
    assert.deepEqual(await statuses(), { stack: "STOPPED", tools: "RUNNING" });

    // reset() restores the project states with everything else.
    handle.reset();
    const fresh = await session(handle, "admin");
    const { data } = (await fresh.request(PROJECT, "list")).json;
    const rows = wire === "legacy" ? data : Object.values(data);
    assert.deepEqual(
      rows.map((project) => project.status),
      ["RUNNING", "STOPPED"],
    );
  });
}

test("SMART: DSM 7.4's 103 on get sends the app to get_health_info; the legacy wire answers get", async (t) => {
  const disk = { disk: q(MOCK_DSM_SMART_DISK) };

  const real = await mock(t);
  const admin = await session(real, "admin");
  assertDsmCode(await admin.request(SMART, "get", 1, disk), 103);
  const health = await admin.request(SMART, "get_health_info", 1, disk);
  assert.equal(health.json.success, true, health.text);
  assert.deepEqual(
    [
      health.json.data.health,
      health.json.data.longName,
      health.json.data.temp,
      health.json.data.attributes.length,
    ],
    ["normal", "Drive 1", "35", 2],
  );
  assert.equal("health_status" in health.json.data, false);
  assert.deepEqual(
    real
      .snapshot()
      .calls.filter((entry) => entry.api === SMART)
      .map((entry) => [entry.method, entry.code]),
    [
      ["get", 103],
      ["get_health_info", 0],
    ],
  );
  // The 103 is the retry the app is built for, not a drift.
  assert.deepEqual(real.snapshot().unexpected, []);
  assertDsmCode(
    await admin.request(SMART, "get_health_info", 1, { disk: q("sata9") }),
    120,
  );

  const legacy = await mock(t, { wire: "legacy" });
  const legacyAdmin = await session(legacy, "admin");
  const direct = await legacyAdmin.request(SMART, "get", 1, disk);
  assert.equal(direct.json.success, true, direct.text);
  assert.deepEqual(
    [
      direct.json.data.disk_id,
      direct.json.data.health_status,
      direct.json.data.temperature,
    ],
    [MOCK_DSM_SMART_DISK, "normal", 35],
  );
  assert.deepEqual(legacy.snapshot().unexpected, []);
});

for (const wire of WIRE_MODES) {
  test(`${wire} wire: the e11 sign-in reads Auth.Type after 403/449, then enrolls and reuses a trusted device`, async (t) => {
    const handle = await mock(t, { wire });
    const deviceName = "SortOfRemoteNG · E2E-HOST";
    // AuthManager::sign_in_methods: v1 `get`, only `account`, no session.
    const methods = async (name) =>
      (
        await call(handle, {
          api: "SYNO.API.Auth.Type",
          method: "get",
          form: { account: name },
        })
      ).json;

    assertDsmCode(await login(handle, "otp"), 403);
    assert.deepEqual(await methods("otp"), {
      data: [{ type: "otp" }],
      success: true,
    });
    const enrolled = await login(handle, "otp", {
      otp_code: MOCK_DSM_OTP_CODE,
      enable_device_token: "yes",
      device_name: deviceName,
    });
    assert.equal(enrolled.json.success, true, enrolled.text);
    assert.equal(
      enrolled.json.data[wire === "legacy" ? "did" : "device_id"],
      MOCK_DSM_DEVICE_ID,
    );
    // DeviceLogin::Reuse: `device_name` + `device_id`, no code, no enrollment.
    const reused = await login(handle, "otp", {
      device_name: deviceName,
      device_id: MOCK_DSM_DEVICE_ID,
    });
    assert.equal(reused.json.success, true, reused.text);

    assertDsmCode(await login(handle, "approve"), 449);
    assert.deepEqual(await methods("approve"), {
      data: [{ type: "authenticator" }, { type: "fido" }],
      success: true,
    });

    const snapshot = handle.snapshot();
    assert.deepEqual(
      snapshot.calls.map((entry) => [entry.api, entry.account, entry.code]),
      [
        ["SYNO.API.Auth", "otp", 403],
        ["SYNO.API.Auth.Type", "otp", 0],
        ["SYNO.API.Auth", "otp", 0],
        ["SYNO.API.Auth", "otp", 0],
        ["SYNO.API.Auth", "approve", 449],
        ["SYNO.API.Auth.Type", "approve", 0],
      ],
    );
    assert.deepEqual(
      snapshot.logins.map((entry) => [
        entry.otpCode,
        entry.enableDeviceToken,
        entry.deviceName,
        entry.deviceId,
        entry.deviceTokenIssued,
        entry.code,
      ]),
      [
        ["absent", false, false, "absent", false, 403],
        ["valid", true, true, "absent", true, 0],
        ["absent", false, true, "trusted", false, 0],
        ["absent", false, false, "absent", false, 449],
      ],
    );
    assert.deepEqual(snapshot.unexpected, []);

    // e11 never signs Auth.Type; a signed lookup is answered but recorded.
    const admin = await session(handle, "admin");
    await call(handle, {
      api: "SYNO.API.Auth.Type",
      method: "get",
      form: { account: "otp", _sid: admin.sid, SynoToken: admin.synotoken },
    });
    assert.deepEqual(
      handle
        .snapshot()
        .unexpected.map((entry) => [entry.api, entry.kind, entry.param]),
      [
        ["SYNO.API.Auth.Type", "unexpected_param", "_sid"],
        ["SYNO.API.Auth.Type", "unexpected_param", "SynoToken"],
      ],
    );
  });
}

test("authenticated APIs validate the session and the SynoToken", async (t) => {
  const handle = await mock(t);
  const admin = await session(handle, "admin");

  // Cookie session + header token (no body parameters) is accepted.
  const viaCookie = await call(handle, {
    api: "SYNO.DSM.Info",
    version: 2,
    method: "getinfo",
    headers: { cookie: `id=${admin.sid}`, "X-SYNO-TOKEN": admin.synotoken },
  });
  assert.equal(viaCookie.json.success, true);

  assertDsmCode(
    await call(handle, {
      api: "SYNO.DSM.Info",
      version: 2,
      method: "getinfo",
      form: { _sid: admin.sid },
    }),
    119,
  );
  assertDsmCode(
    await call(handle, {
      api: "SYNO.DSM.Info",
      version: 2,
      method: "getinfo",
      form: { _sid: admin.sid, SynoToken: "not-the-token" },
    }),
    119,
  );
  assertDsmCode(
    await call(handle, {
      api: "SYNO.DSM.Info",
      version: 2,
      method: "getinfo",
      form: { _sid: "unknown-sid", SynoToken: admin.synotoken },
    }),
    119,
  );

  // Logout invalidates the SID.
  const logout = await admin.request("SYNO.API.Auth", "logout", 7, {
    session: "FileStation",
  });
  assert.deepEqual(logout.json, { success: true });
  assertDsmCode(await admin.request("SYNO.DSM.Info", "getinfo", 2), 119);
});

test("a standard viewer gets the exact 38-byte 105 on administrator Core APIs", async (t) => {
  const handle = await mock(t);
  const viewer = await session(handle, "viewer");

  assert.equal(
    (await viewer.request("SYNO.DSM.Info", "getinfo", 2)).json.success,
    true,
  );
  assert.equal(
    (await viewer.request("SYNO.FileStation.Info", "get", 2)).json.success,
    true,
  );
  assertExactPermissionDenied(
    await viewer.request("SYNO.Core.System.Utilization", "get"),
  );
  assertExactPermissionDenied(await viewer.request("SYNO.Core.User", "list"));
  assertExactPermissionDenied(await viewer.request("SYNO.Core.Group", "list"));

  const initdata = await viewer.request("SYNO.Core.Desktop.Initdata", "get");
  assert.equal(initdata.json.data.Session.is_admin, false);
  assert.equal(
    initdata.json.data.AppPrivilege["SYNO.SDS.App.FileStation3.Instance"],
    true,
  );
});

test("a wrong password is 400 and creates no session", async (t) => {
  const handle = await mock(t);
  const response = await call(handle, {
    api: "SYNO.API.Auth",
    version: 6,
    method: "login",
    form: { account: "admin", passwd: "nope", session: "FileStation" },
  });
  assertDsmCode(response, 400);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(handle.snapshot().activeSessions.length, 0);
});

test("enroll is 406 (2FA setup required) and creates no session", async (t) => {
  const handle = await mock(t);
  assertDsmCode(await login(handle, "enroll"), 406);
  // Even a code does not help: the account has no enrolled factor yet.
  assertDsmCode(
    await login(handle, "enroll", { otp_code: MOCK_DSM_OTP_CODE }),
    406,
  );
  assert.equal(handle.snapshot().activeSessions.length, 0);
});

test("portal sessions report is_portal_port and are limited to grantable APIs", async (t) => {
  const handle = await mock(t);
  const portal = await session(handle, "portal");
  assert.equal(portal.response.json.data.is_portal_port, true);
  assert.equal(
    (await portal.request("SYNO.FileStation.Info", "get", 2)).json.success,
    true,
  );
  assert.equal(
    (await portal.request("SYNO.Core.Desktop.Initdata", "get")).json.data
      .Session.is_admin,
    true,
  );
  assertExactPermissionDenied(
    await portal.request("SYNO.Core.System.Utilization", "get"),
  );
  assert.equal(handle.snapshot().activeSessions[0].kind, "portal");
});

// ────────────────────────────────────────────────────────────────────── 2FA ──

test("otp: 403 without a code, 404 with a wrong code, success with 246810", async (t) => {
  const handle = await mock(t);
  assertDsmCode(await login(handle, "otp"), 403);
  assertDsmCode(await login(handle, "otp", { otp_code: "135790" }), 404);

  const ok = await session(handle, "otp", { otp_code: MOCK_DSM_OTP_CODE });
  assert.equal(ok.response.json.data.did, undefined);
  assert.equal(ok.response.json.data.device_id, undefined);
  assert.equal(
    (await ok.request("SYNO.Core.System.Utilization", "get")).json.success,
    true,
  );
  assert.deepEqual(
    handle.snapshot().logins.map((entry) => [entry.otpCode, entry.code]),
    [
      ["absent", 403],
      ["invalid", 404],
      ["valid", 0],
    ],
  );
});

test("otp: device token is issued on an opted-in verified login and reused by name", async (t) => {
  const handle = await mock(t);
  const deviceName = "SortOfRemoteNG · E2E-HOST";

  // Reuse before any enrollment is rejected.
  assertDsmCode(
    await login(handle, "otp", {
      device_id: MOCK_DSM_DEVICE_ID,
      device_name: deviceName,
    }),
    403,
  );
  // A code without opt-in never issues a did.
  const plain = await login(handle, "otp", {
    otp_code: MOCK_DSM_OTP_CODE,
    device_name: deviceName,
  });
  assert.equal(plain.json.data.did, undefined);
  assert.equal(plain.json.data.device_id, undefined);

  const enrolled = await login(handle, "otp", {
    otp_code: MOCK_DSM_OTP_CODE,
    enable_device_token: "yes",
    device_name: deviceName,
  });
  assert.equal(enrolled.json.success, true);
  // Real DSM 7 wire: `device_id` (the legacy wire test covers `did`).
  assert.equal(enrolled.json.data.device_id, MOCK_DSM_DEVICE_ID);
  assert.equal(enrolled.json.data.did, undefined);

  const reused = await login(handle, "otp", {
    device_id: MOCK_DSM_DEVICE_ID,
    device_name: deviceName,
  });
  assert.equal(reused.json.success, true);
  assert.equal(reused.json.data.did, undefined);
  assert.equal(reused.json.data.device_id, undefined);

  assertDsmCode(
    await login(handle, "otp", {
      device_id: MOCK_DSM_DEVICE_ID,
      device_name: "SortOfRemoteNG · OTHER-HOST",
    }),
    403,
  );
  assertDsmCode(
    await login(handle, "otp", {
      device_id: "mock-did-unknown",
      device_name: deviceName,
    }),
    403,
  );
  // A rejected token plus a valid code still signs in with the code.
  const fallback = await login(handle, "otp", {
    device_id: "mock-did-unknown",
    device_name: deviceName,
    otp_code: MOCK_DSM_OTP_CODE,
  });
  assert.equal(fallback.json.success, true);

  assert.deepEqual(
    handle
      .snapshot()
      .logins.map((entry) => [
        entry.deviceId,
        entry.deviceTokenIssued,
        entry.code,
      ]),
    [
      ["rejected", false, 403],
      ["absent", false, 0],
      ["absent", true, 0],
      ["trusted", false, 0],
      ["rejected", false, 403],
      ["rejected", false, 403],
      ["rejected", false, 0],
    ],
  );
});

test("approve is 449 and Auth.Type reports sign-in methods without a session", async (t) => {
  const handle = await mock(t);
  assertDsmCode(await login(handle, "approve"), 449);
  assertDsmCode(
    await login(handle, "approve", { otp_code: MOCK_DSM_OTP_CODE }),
    449,
  );

  const typeOf = async (name) =>
    (
      await call(handle, {
        api: "SYNO.API.Auth.Type",
        method: "get",
        form: { account: name },
      })
    ).json;
  assert.deepEqual(await typeOf("approve"), {
    data: [{ type: "authenticator" }, { type: "fido" }],
    success: true,
  });
  assert.deepEqual(await typeOf("otp"), {
    data: [{ type: "otp" }],
    success: true,
  });
  assert.deepEqual(await typeOf("admin"), { data: [], success: true });
  assert.deepEqual(await typeOf("no-such-account"), {
    data: [],
    success: true,
  });
});

// ──────────────────────────────────────────────── remote policy (root cause) ──

test("remote-admin without the IK handshake reproduces the user's 105 byte for byte", async (t) => {
  const handle = await mock(t);
  const remote = await session(handle, "remote-admin");
  assert.equal(remote.response.json.data.is_portal_port, false);
  assert.equal(remote.response.json.data.ik_message, undefined);

  assert.equal(
    (await remote.request("SYNO.DSM.Info", "getinfo", 2)).json.success,
    true,
  );
  assert.equal(
    (await remote.request("SYNO.FileStation.Info", "get", 2)).json.success,
    true,
  );
  assert.equal(
    (await remote.request("SYNO.Core.Desktop.Initdata", "get")).json.data
      .Session.is_admin,
    true,
  );
  assertExactPermissionDenied(
    await remote.request("SYNO.Core.System.Utilization", "get"),
  );
  assertExactPermissionDenied(await remote.request("SYNO.Core.User", "list"));

  const snapshot = handle.snapshot();
  assert.equal(snapshot.activeSessions[0].kind, "limited");
  const utilization = snapshot.calls.find(
    (entry) => entry.api === "SYNO.Core.System.Utilization",
  );
  assert.deepEqual(
    [utilization.account, utilization.sessionKind, utilization.code],
    ["remote-admin", "limited", 105],
  );
  assert.equal(snapshot.logins[0].ikMessage, false);
  assert.equal(snapshot.logins[0].version, 6);
});

test("no_reply UIConfig serves a real X25519 _SSID but never completes the handshake", async (t) => {
  const handle = await mock(t, { uiConfig: "no_reply" });
  const info = await call(handle, {
    api: "SYNO.API.Info",
    method: "query",
    form: { query: "all" },
  });
  assert.deepEqual(
    {
      path: info.json.data["SYNO.API.Auth.UIConfig"].path,
      max: info.json.data["SYNO.API.Auth.UIConfig"].maxVersion,
    },
    { path: "entry.cgi", max: 1 },
  );

  // N4S4 posts to `entry.cgi/SYNO.API.Auth.UIConfig` with the API in the body.
  const uiConfig = await call(handle, {
    gateway: "entry.cgi/SYNO.API.Auth.UIConfig",
    rawQuery: "",
    form: { api: "SYNO.API.Auth.UIConfig", method: "get", version: "1" },
  });
  assert.equal(uiConfig.json.success, true);
  const ssid = cookieValue(uiConfig, "_SSID");
  assert.match(ssid, /^[A-Za-z0-9_-]{43}$/u);
  const staticKey = Buffer.from(ssid, "base64url");
  assert.equal(staticKey.length, 32);
  // Importable as an X25519 public key, and DH with it works.
  const remotePublic = crypto.createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: ssid },
    format: "jwk",
  });
  const { privateKey } = crypto.generateKeyPairSync("x25519");
  assert.equal(
    crypto.diffieHellman({ privateKey, publicKey: remotePublic }).length,
    32,
  );

  // A v7 login carrying an ik_message succeeds but gets no message 2 and the
  // remote policy still limits the session: nothing here verifies Noise.
  const ikMessage = crypto.randomBytes(96).toString("base64url");
  const remote = await login(
    handle,
    "remote-admin",
    { ik_message: ikMessage },
    7,
  );
  assert.equal(remote.json.success, true);
  assert.equal(remote.json.data.ik_message, undefined);
  const { sid, synotoken } = remote.json.data;
  assertExactPermissionDenied(
    await call(handle, {
      api: "SYNO.Core.System.Utilization",
      method: "get",
      form: { _sid: sid, SynoToken: synotoken },
    }),
  );

  const snapshot = handle.snapshot();
  assert.equal(snapshot.uiConfigRequests, 1);
  assert.deepEqual(
    [
      snapshot.logins[0].version,
      snapshot.logins[0].ikMessage,
      snapshot.logins[0].ikMessageBytes,
    ],
    [7, true, 96],
  );
  assert.equal(
    snapshot.calls.some((entry) => entry.requestHash),
    false,
  );
});

test("unknown uiConfig and wire modes are refused at start", async () => {
  await assert.rejects(startMockDsm({ port: 0, uiConfig: "ik" }), /uiConfig/u);
  await assert.rejects(startMockDsm({ port: 0, wire: "dsm6" }), /wire/u);
});

// ──────────────────────────────────────────────────────── IPC and lifecycle ──

test("snapshots never carry passwords, codes, SIDs, tokens or device ids", async (t) => {
  const handle = await mock(t);
  const admin = await session(handle, "admin");
  await admin.request("SYNO.DSM.Info", "getinfo", 2);
  await login(handle, "otp", {
    otp_code: MOCK_DSM_OTP_CODE,
    enable_device_token: "yes",
    device_name: "SortOfRemoteNG · E2E-HOST",
  });
  // Secret values under unexpected parameter names stay out of `unexpected`.
  await admin.request("SYNO.Backup.Task", "list", 1, {
    otp_code: MOCK_DSM_OTP_CODE,
    device_id: MOCK_DSM_DEVICE_ID,
  });
  assert.equal(handle.snapshot().unexpected.length, 2);
  const text = JSON.stringify(handle.snapshot());
  for (const secret of [
    admin.sid,
    admin.synotoken,
    MOCK_DSM_ACCOUNTS.admin.password,
    MOCK_DSM_ACCOUNTS.otp.password,
    MOCK_DSM_OTP_CODE,
    MOCK_DSM_DEVICE_ID,
    MOCK_DSM_HOSTNAME,
    MOCK_DSM_SERIAL,
  ]) {
    assert.equal(text.includes(secret), false, `snapshot leaked ${secret}`);
  }
  handle.reset();
  assert.deepEqual(
    [
      handle.snapshot().logins.length,
      handle.snapshot().activeSessions.length,
      handle.snapshot().unexpected.length,
    ],
    [0, 0, 0],
  );
  assertDsmCode(await admin.request("SYNO.DSM.Info", "getinfo", 2), 119);
});

function waitForMessage(child, predicate, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${label}`)),
      15_000,
    );
    const onMessage = (message) => {
      if (!predicate(message)) return;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve(message);
    };
    child.on("message", onMessage);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture exited (${code}) before ${label}`));
    });
  });
}

const portIsFree = (host, port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });

test("the forked CLI reports ready, answers snapshot/reset over IPC and exits cleanly on stop", async () => {
  const child = fork(serverPath, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      MOCK_DSM_PORT: "0",
      MOCK_DSM_UI_CONFIG: "no_reply",
      MOCK_DSM_WIRE: "legacy",
    },
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  try {
    const ready = await waitForMessage(
      child,
      (message) => message?.type === "mock-dsm-ready",
      "ready",
    );
    assert.equal(ready.uiConfig, "no_reply");
    assert.equal(ready.wire, "legacy");
    assert.ok(ready.port > 0);
    assert.deepEqual(ready.accounts.viewer, {
      username: "viewer",
      password: "viewer-pass",
    });
    assert.equal(ready.otpCode, MOCK_DSM_OTP_CODE);
    assert.deepEqual(ready.cpu, MOCK_DSM_CPU);

    const handle = { host: ready.host, port: ready.port };
    assertDsmCode(await login(handle, "viewer", { passwd: "nope" }), 400);

    // The forked fixture prints every unexpected request for the WDIO logs.
    assertDsmCode(
      await call(handle, {
        api: "SYNO.Core.Security.Firewall.Rules",
        method: "list_all",
      }),
      103,
    );
    const marker = `MOCK_DSM_UNEXPECTED ${JSON.stringify({
      api: "SYNO.Core.Security.Firewall.Rules",
      method: "list_all",
      version: 1,
      account: null,
      kind: "unknown_method",
      param: null,
      code: 103,
    })}`;
    const deadline = Date.now() + 5_000;
    while (!stderr.includes(marker) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(stderr.includes(marker), stderr);

    child.send({ type: "snapshot", id: 1 });
    const snapshot = await waitForMessage(
      child,
      (message) => message?.type === "mock-dsm-snapshot" && message.id === 1,
      "snapshot",
    );
    assert.equal(snapshot.snapshot.logins[0].code, 400);

    child.send({ type: "reset", id: 2 });
    await waitForMessage(
      child,
      (message) => message?.type === "mock-dsm-reset" && message.id === 2,
      "reset",
    );

    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.send("stop");
    assert.equal(await exited, 0);
    assert.match(stdout, /^MOCK_DSM_READY \{/mu);
    assert.equal(await portIsFree(ready.host, ready.port), true);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

test("the TypeScript helper mirrors the fixture defaults", () => {
  const helper = readFileSync(
    path.join(repoRoot, "e2e", "helpers", "mock-dsm.ts"),
    "utf8",
  );
  assert.match(helper, new RegExp(`"${DEFAULT_MOCK_DSM_PORT}"`, "u"));
  assert.match(helper, /fixtures",\s*"mock-dsm",\s*"server\.mjs"/u);
  assert.ok(helper.includes("MOCK_DSM_WIRE"), "helper forwards MOCK_DSM_WIRE");
  for (const type of [
    "mock-dsm-ready",
    "mock-dsm-snapshot",
    "mock-dsm-reset",
  ]) {
    assert.ok(helper.includes(`"${type}"`), type);
  }
  for (const name of Object.keys(MOCK_DSM_ACCOUNTS)) {
    assert.ok(helper.includes(`"${name}"`), `helper lists account ${name}`);
  }
});
