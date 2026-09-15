/**
 * t84-e8 — Disposable mock Synology DSM server for the NAS API E2E suite.
 *
 * Neither real DSM nor Virtual DSM may be used (licence), so
 * `e2e/specs/26-synology/nas-api-permissions.spec.ts` runs the desktop app's
 * native "Synology NAS API" view against this in-process HTTP fixture instead.
 * Everything here is synthetic. It speaks the DSM Web API wire protocol the
 * `sorng-synology` client uses:
 *
 *   - `POST /webapi/entry.cgi` (api/version/method in the query string or the
 *     form body, merged the way DSM reads them) and `GET /webapi/query.cgi`
 *     for `SYNO.API.Info` discovery. `entry.cgi/<API>` path suffixes resolve
 *     the API name like DSM's own web UI requests do.
 *   - `SYNO.API.Info query` (every API at `entry.cgi`, `SYNO.API.Auth` 1..7)
 *   - `SYNO.API.Auth login|logout` — `session`, `format=cookie` (`Set-Cookie:
 *     id=<sid>`), `enable_syno_token=yes` (`synotoken`), `is_portal_port`,
 *     `otp_code`, `enable_device_token`/`device_name` -> `device_id` (or `did`),
 *     `device_id`/`device_name` reuse
 *   - `SYNO.API.Auth.Type get account=` (no session) -> `[{ type }]`
 *   - `SYNO.API.Auth.UIConfig get` (only with `uiConfig: "no_reply"`)
 *   - `SYNO.DSM.Info getinfo`, `SYNO.FileStation.Info get`,
 *     `SYNO.FileStation.List list_share|list`, `SYNO.Core.Desktop.Initdata get`
 *     (`Session.is_admin`), `SYNO.Core.System.Utilization get`,
 *     `SYNO.Core.User list`, `SYNO.Core.Group list`
 *   - t84-e8b, the section probes and loaders of t84 `t84/r-int` (each probe
 *     sends its loader's first request, `api_access.rs` READS):
 *     `SYNO.Core.Security.Firewall.Adapter list` then
 *     `SYNO.Core.Security.Firewall.Rules load adapter=` per adapter,
 *     `SYNO.ActiveBackup.Device list`,
 *     `SYNO.Core.Security.AutoBlock.Rules list offset limit type`,
 *     `SYNO.Core.SyslogClient.Log list start offset limit target logtype`,
 *     `SYNO.Core.Service get` (v1..3, `additional=["active_status"]`),
 *     `SYNO.Docker.Container list offset limit type`,
 *     `SYNO.Docker.Project list|start|stop` (actions by `id`),
 *     `SYNO.Backup.Task list additional`, and
 *     `SYNO.Storage.CGI.Smart get_health_info disk=` (see the wires below).
 *
 * Every authenticated API validates the session (`_sid` body parameter or the
 * `id` cookie) and, when the login asked for one, the SynoToken (`SynoToken`
 * parameter or `X-SYNO-TOKEN` header). Failures are DSM code 119. A session
 * that may not use an API gets DSM's exact 38-byte reply
 * `{"error":{"code":105},"success":false}` with HTTP 200 — byte for byte what
 * the user's report showed.
 *
 * Parameters (t84-e8b): every method declares the parameters it takes, as the
 * app sends them. DSM's order is kept: api/method/version (101-104), session
 * (119), permission (105), then parameters — a missing required one is 114
 * (5100 for `AutoBlock.Rules list`, 120 for `Firewall.Rules load`: the only
 * live evidence, audit S§4 #7/#26), an unreadable or unknown value is 120.
 * String values arrive JSON-quoted where the catalog declares
 * `requestFormat: "JSON"` (the app's `wire::string_param`) and raw elsewhere;
 * the other spelling is still served (audit §7 open unknown 7). Every request
 * the app should not send is recorded, value-free, in `unexpected`
 * (`{api, method, version, account, kind, param, code}`, kinds `malformed`,
 * `unknown_api`, `unknown_method`, `unsupported_version`, `unexpected_param`,
 * `missing_param`, `invalid_param`, `unquoted_string`, `quoted_string`), so a
 * test can assert "no unexpected request". The forked CLI also prints each one
 * to stderr as `MOCK_DSM_UNEXPECTED <json>`. Session (119) and permission (105)
 * refusals are behaviour, not drift, and are not recorded.
 *
 * Accounts (see `MOCK_DSM_ACCOUNTS`):
 *   - `admin` / `viewer`: full sessions; `viewer` is a standard user, so the
 *     administrator-only Core and package APIs answer 105.
 *   - `enroll`: 406, the account must set up 2FA before any API sign-in.
 *   - `portal`: an administrator signing in through an application portal
 *     (`is_portal_port: true`); the session is limited to File Station.
 *   - `otp`: 403 without a code, 404 with a wrong code (DSM's "failed to
 *     authenticate 2-factor code"), success with `246810`. With
 *     `enable_device_token=yes` + `device_name` a verified login returns the
 *     device token `mock-did-1` (`device_id` on the real wire, `did` on the
 *     legacy wire); a later `device_id=mock-did-1` with the same `device_name`
 *     signs in without a code, anything else is 403.
 *   - `approve`: 449 (Secure SignIn approval), `Auth.Type` reports
 *     `authenticator` + `fido`.
 *   - `remote-admin`: the community-documented DSM 7 "remote" policy. A login
 *     without a verified Noise-IK `ik_message` gets a limited session:
 *     `DSM.Info`, File Station and `Initdata` (administrator: yes) work, the
 *     administrator Core and package APIs answer the exact 38-byte 105.
 *
 * Noise-IK: this fixture has NO Noise responder. Implementing
 * `Noise_IK_25519_ChaChaPoly_BLAKE2b` here was optional and conditional on
 * checking it against the official Noise test vectors, none of which are
 * available offline in this workspace, so the complete handshake (`ik`,
 * `X-SYNO-HASH`) is covered by t84-e2's Rust tests against `snow` only. What
 * the fixture can prove honestly is the fallback: `uiConfig: "absent"` (the
 * default) advertises no `SYNO.API.Auth.UIConfig`, so the app must sign in
 * legacy; `uiConfig: "no_reply"` advertises it and serves a real X25519 public
 * key in the `_SSID` cookie but never answers message 2, so the app must record
 * `ik_incomplete`, keep the session and send no `X-SYNO-HASH`. Neither mode
 * ever verifies an `ik_message`, so `remote-admin` stays limited in both.
 *
 * Response shapes (`wire`, env `MOCK_DSM_WIRE`) follow t84-r1's audit
 * `.orchestration/scratch/t84/dsm-response-shapes.md` §4/§6 and the t84 lane
 * fixtures (`sorng-synology/src/wire_shapes_tests/*_shapes.rs`). Structures
 * are adapted, with every value synthetic, from MIT-licensed real-device
 * fixtures: mib1185/py-synologydsm-api `tests/api_data/dsm_{6,7}`,
 * sentania-labs/vcf-content-factory (DSM 7.3.2), N4S4/synology-api,
 * pmilano1/synology-dsm-api (DSM 7.4 probes), synology-go and KastnerRG, plus
 * Apache-2.0 dsm_helper field names.
 *   - `real` (default): what DSM sends. `Utilization.disk` is
 *     `{disk:[…],total:{…}}` plus `lun`/`space`/`time`; `Core.User list` is
 *     `{offset,total,users:[…]}` with no `uid`; `Core.Group list` is
 *     `{groups:[…],offset,total}` with no `members`; a trusted-device login
 *     returns `device_id` (the DSM 7 capture). The t84-e8b lists use DSM's
 *     envelopes (`devices`, `ip_info`, `items`, `service`, `containers`,
 *     `task_list`), `Docker.Project list` is the id-keyed map, and
 *     `Storage.CGI.Smart get` answers 103 as on the DSM 7.4 probe, so the app
 *     retries with `get_health_info` (not recorded as unexpected: the retry is
 *     the app's design).
 *   - `legacy`: the shapes the pre-t84 decoders accept (flat `disk` array,
 *     bare user/group arrays with `uid`/`members`, `did` from the 2023 login
 *     guide), so the E2E can prove a decoder accepts both. For the t84-e8b
 *     lists it serves the variants the t84 decoders keep as regressions: bare
 *     arrays, DSM 7.2 container rows (string `created`, no `State`), the
 *     project array, and a `Storage.CGI.Smart get` that answers directly with
 *     the DTO field names (DSM 6/7 `.lib` definitions list `get`).
 * Everything else is identical in both modes and matches the audit's real
 * shapes (`DSM.Info` catalog `minVersion: 2`, File Station `requestFormat`,
 * `support_virtual_protocol` array, `list_share` `additional`, `Initdata`
 * with a large ignored `Strings` key; firewall adapters and rules have one
 * shape). The one API the audit has no evidence for, `SYNO.API.Auth.Type`
 * (catalog entry and response), stays app-shaped from plan t84 §7.3.
 *
 * Two entry points:
 *   - imported:  `await startMockDsm({ port: 0 })` -> handle with `.stop()`
 *   - forked:    `node server.mjs` -> `process.send({ type: "mock-dsm-ready" })`
 *                and a `MOCK_DSM_READY <json>` line on stdout. IPC `stop`,
 *                `{ type: "snapshot", id }` and `{ type: "reset", id }`.
 *
 * Disposable local/CI testing only. The credentials here are throwaway by
 * design and must never be reused anywhere else.
 */
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

export const DEFAULT_MOCK_DSM_HOST = "127.0.0.1";
export const DEFAULT_MOCK_DSM_PORT = 18501;
export const MOCK_DSM_OTP_CODE = "246810";
export const MOCK_DSM_DEVICE_ID = "mock-did-1";
/** Private NAS metadata that must never reach the app's access diagnostics. */
export const MOCK_DSM_HOSTNAME = "dsm-mock-e2e-private-host";
export const MOCK_DSM_SERIAL = "MOCKSERIAL0001";
/** DSM's reply to a session calling an API it may not use (38 bytes). */
export const PERMISSION_DENIED_BODY = '{"error":{"code":105},"success":false}';
export const UI_CONFIG_MODES = Object.freeze(["absent", "no_reply"]);
export const WIRE_MODES = Object.freeze(["real", "legacy"]);

const MAX_BODY_BYTES = 1024 * 1024;

const account = (username, password, overrides = {}) =>
  Object.freeze({
    username,
    password,
    administrator: false,
    /** "password" | "otp" | "enrollment_required" | "approval_required" */
    login: "password",
    portal: false,
    remotePolicy: false,
    authTypes: Object.freeze([]),
    ...overrides,
  });

export const MOCK_DSM_ACCOUNTS = Object.freeze({
  admin: account("admin", "admin-pass", { administrator: true }),
  viewer: account("viewer", "viewer-pass"),
  enroll: account("enroll", "enroll-pass", { login: "enrollment_required" }),
  portal: account("portal", "portal-pass", {
    administrator: true,
    portal: true,
  }),
  otp: account("otp", "otp-pass", {
    administrator: true,
    login: "otp",
    authTypes: Object.freeze([{ type: "otp" }]),
  }),
  approve: account("approve", "approve-pass", {
    administrator: true,
    login: "approval_required",
    authTypes: Object.freeze([{ type: "authenticator" }, { type: "fido" }]),
  }),
  "remote-admin": account("remote-admin", "remote-pass", {
    administrator: true,
    remotePolicy: true,
  }),
});

/** Distinctive values the spec looks for in the CPU table. */
export const MOCK_DSM_CPU = Object.freeze({
  "15min_load": 31,
  "1min_load": 57,
  "5min_load": 43,
  device: "System",
  other_load: 2,
  system_load: 11,
  user_load: 23,
});

const MOCK_DSM_DISK_ROWS = Object.freeze([
  Object.freeze({
    device: "sata1",
    display_name: "Drive 1",
    read_access: 3,
    read_byte: 40960,
    type: "internal",
    utilization: 4,
    write_access: 1,
    write_byte: 20480,
  }),
]);

/**
 * `SYNO.Core.System.Utilization get` data. Shape: py-synologydsm-api
 * `dsm_6/core/const_6_core_utilization.py` and DSM 7.3.2 captures (MIT);
 * memory in KB, `rx`/`tx` in bytes/s, loads in integer percent.
 */
export function utilizationData(wire) {
  const io = {
    read_access: 3,
    read_byte: 40960,
    utilization: 4,
    write_access: 1,
    write_byte: 20480,
  };
  const real = {
    cpu: { ...MOCK_DSM_CPU },
    disk: {
      disk: MOCK_DSM_DISK_ROWS.map((row) => ({ ...row })),
      total: { device: "total", ...io },
    },
    lun: [],
    memory: {
      avail_real: 3075152,
      avail_swap: 2097084,
      buffer: 64000,
      cached: 512000,
      device: "Memory",
      memory_size: 4194304,
      real_usage: 23,
      si_disk: 0,
      so_disk: 0,
      swap_usage: 0,
      total_real: 3993704,
      total_swap: 2097084,
    },
    network: [
      { device: "total", rx: 4096, tx: 2048 },
      { device: "eth0", rx: 4096, tx: 2048 },
    ],
    space: {
      total: { device: "total", ...io },
      volume: [{ device: "dm-1", display_name: "volume1", ...io }],
    },
    time: 1789466400,
  };
  return wire === "legacy"
    ? { ...real, disk: MOCK_DSM_DISK_ROWS.map((row) => ({ ...row })) }
    : real;
}

/** `SYNO.Core.User list` data. Shape: N4S4 `core_user.user_list` (MIT) — no `uid` in list items. */
export function userListData(wire) {
  const users = [
    {
      description: "Synthetic administrator",
      email: "",
      expired: "normal",
      name: "admin",
    },
    {
      description: "Synthetic standard user",
      email: "",
      expired: "normal",
      name: "viewer",
    },
  ];
  if (wire === "legacy") {
    return users.map((user, index) => ({ ...user, uid: 1024 + index * 2 }));
  }
  return { offset: 0, total: users.length, users };
}

/** `SYNO.Core.Group list` data. Shape: N4S4 `core_group.get_groups` (MIT) — no `members`. */
export function groupListData(wire) {
  const groups = [
    {
      description: "Synthetic administrators",
      gid: 101,
      name: "administrators",
    },
    { description: "Synthetic users", gid: 100, name: "users" },
  ];
  if (wire === "legacy") {
    const members = { administrators: ["admin"], users: ["admin", "viewer"] };
    return groups.map((group) => ({ ...group, members: members[group.name] }));
  }
  return { groups, offset: 0, total: groups.length };
}

// ──────────────────────────────────────────── t84-e8b section read shapes ──

const pageOf = (rows, values) => {
  const offset = values.offset ?? 0;
  const limit = values.limit ?? 0;
  return rows.slice(offset, limit > 0 ? offset + limit : undefined);
};

/** `SYNO.Core.Security.Firewall.Adapter list`. Shape: pmilano1 probed `core-security.md` (DSM 7.4, MIT). */
export const MOCK_DSM_FIREWALL_ADAPTERS = Object.freeze(["global", "ovs_eth0"]);

/**
 * `SYNO.Core.Security.Firewall.Rules load` for one adapter. Shape: KastnerRG
 * `apply_security.py` `data.{policy,rules,total}` (MIT); the rule keys are
 * only partly confirmed (audit S§7 #2). `ovs_eth0` has no rules.
 */
export function firewallRulesData(adapter) {
  const rules =
    adapter === "global"
      ? [
          {
            enabled: true,
            policy: "allow",
            ports: "all",
            protocol: "all",
            set_type: "geoip",
            src: "US",
          },
        ]
      : [];
  return { policy: "allow", rules, total: rules.length };
}

/** `SYNO.ActiveBackup.Device list`. Shape: pmilano1 `activebackup/core/device.md` (MIT). */
export function activeBackupDevicesData(wire) {
  const devices = [
    {
      agentless_auth_policy: 0,
      backup_type: 2,
      create_time: 1789466300,
      device_id: 1,
      host_ip: "192.0.2.20",
      host_name: "mock-pc-01",
      login_time: 1789466400,
      os_name: "Windows 11(64-bit)",
      task_count: 1,
    },
  ];
  return wire === "legacy" ? devices : { devices, total: devices.length };
}

/**
 * `SYNO.Core.Security.AutoBlock.Rules list`. No public success capture exists
 * (audit S§7 #1): the `ip_info` envelope is the t84 decoder's first key, as in
 * t84-e12j's synthetic fixture. The allow list is empty.
 */
export function blockedIpsData(wire, values) {
  const all =
    values.type === "deny"
      ? [
          { ip: "198.51.100.9", recordtime: 1789466400 },
          { ip: "198.51.100.23", recordtime: 1789470000 },
        ]
      : [];
  const rows = pageOf(all, values);
  return wire === "legacy" ? rows : { ip_info: rows, total: all.length };
}

const MOCK_DSM_LOG_ROWS = Object.freeze([
  {
    descr: "System successfully finished filesystem scrubbing on [Volume 1].",
    level: "info",
    logtype: "System",
    orginalLogType: "system",
    time: "2026/09/15 06:23:51",
    who: "SYSTEM",
  },
  {
    descr: "System started to update the package index.",
    level: "warn",
    logtype: "System",
    orginalLogType: "system",
    time: "2026/09/15 06:21:10",
    who: "SYSTEM",
  },
  {
    descr: "User [viewer] failed to sign in from [192.0.2.30].",
    level: "warn",
    logtype: "Connection",
    orginalLogType: "connection",
    time: "2026/09/15 06:20:02",
    who: "viewer",
  },
]);

/**
 * `SYNO.Core.SyslogClient.Log list`. Shape: vcf `synology-events.md` (DSM
 * 7.3.2, MIT) and dsm_helper `Log.dart`; DSM spells `orginalLogType` (sic).
 */
export function systemLogsData(wire, values) {
  const all = MOCK_DSM_LOG_ROWS.filter(
    (row) => !values.logtype || row.orginalLogType === values.logtype,
  ).map((row) => ({ ...row }));
  const items = pageOf(all, {
    offset: values.offset ?? values.start,
    limit: values.limit,
  });
  if (wire === "legacy") return items;
  const count = (level) => all.filter((row) => row.level === level).length;
  return {
    errorCount: count("err"),
    infoCount: count("info"),
    items,
    total: all.length,
    warnCount: count("warn"),
  };
}

const MOCK_DSM_SERVICES = Object.freeze([
  {
    active_status: "active",
    display_name: "SSH",
    display_name_section_key: "firewall:firewall_service_opt_ssh",
    enable_status: "enabled",
    service_id: "ssh-shell",
  },
  {
    active_status: "inactive",
    display_name: "AFP",
    display_name_section_key: "helptoc:winmacnfs_mac",
    enable_status: "disabled",
    service_id: "atalk",
  },
  {
    active_status: "active",
    display_name: "DSM",
    display_name_section_key: "about:dsm",
    enable_status: "static",
    service_id: "synoscgi",
  },
]);

/**
 * `SYNO.Core.Service get`. v3 rows carry `display_name_section_key`
 * (dsm_helper `Service.dart`), v1 rows `display_name` (DSM 7.4 probe); the
 * running state is only sent for `additional=["active_status"]`.
 */
export function servicesData(wire, version, values) {
  const withStatus = (values.additional ?? []).includes("active_status");
  const rows = MOCK_DSM_SERVICES.map(
    ({ active_status, display_name, display_name_section_key, ...row }) => ({
      ...(withStatus ? { additional: { active_status } } : {}),
      ...(version >= 3 ? { display_name_section_key } : { display_name }),
      ...row,
    }),
  );
  return wire === "legacy" ? rows : { service: rows };
}

const containerState = (running, startedTs, finishedTs) => ({
  Dead: false,
  Error: "",
  ExitCode: running ? 0 : 137,
  FinishedAt: new Date(finishedTs * 1000).toISOString(),
  FinishedTs: finishedTs,
  OOMKilled: false,
  Paused: false,
  Pid: running ? 1234 : 0,
  Restarting: false,
  Running: running,
  StartedAt: new Date(startedTs * 1000).toISOString(),
  StartedTs: startedTs,
  Status: running ? "running" : "exited",
});

const MOCK_DSM_CONTAINERS = Object.freeze([
  {
    cmd: "nginx -g daemon off;",
    created: 1769627261,
    image: "nginx:1.27",
    name: "web",
    running: true,
    started: 1771943000,
    finished: 1771942773,
    up_status: "Up 7 weeks (healthy)",
  },
  {
    cmd: "docker-entrypoint.sh postgres",
    created: 1769627300,
    image: "postgres:16",
    name: "db",
    running: false,
    started: 1771943010,
    finished: 1771950000,
    up_status: "Exited (137) 2 days ago",
  },
]);

/**
 * `SYNO.Docker.Container list`. Real: vcf `synology-docker.md` (DSM 7.3.2,
 * `up_time`/`finish_time` null, `State` object) and synology-go (MIT).
 * Legacy: the dsm_helper DSM 7.2 row (Apache-2.0 field names) — integer
 * `up_time`, string `created`, no `State` — as a bare array.
 */
export function dockerContainersData(wire, values) {
  const all = MOCK_DSM_CONTAINERS.map((container, index) => {
    const id = `${"0".repeat(61)}a0${index + 1}`;
    const status = container.running ? "running" : "exited";
    if (wire === "legacy") {
      return {
        created: String(container.created),
        id,
        image: container.image,
        name: container.name,
        status,
        up_time: container.running ? 4233600 : 0,
      };
    }
    return {
      cmd: container.cmd,
      created: container.created,
      enable_service_portal: false,
      exporting: false,
      finish_time: null,
      id,
      image: container.image,
      is_ddsm: false,
      is_package: false,
      Labels: {},
      name: container.name,
      NetworkSettings: { Networks: {} },
      services: null,
      State: containerState(
        container.running,
        container.started,
        container.finished,
      ),
      status,
      up_status: container.up_status,
      up_time: null,
    };
  });
  const containers = pageOf(all, values);
  if (wire === "legacy") return containers;
  return {
    containers,
    limit: values.limit ?? 0,
    offset: values.offset ?? 0,
    total: all.length,
  };
}

/** Compose projects by id (zero-pattern UUIDs, as in t84-e12g's fixture). */
export const MOCK_DSM_PROJECTS = Object.freeze({
  stack: "00000000-0000-4000-8000-000000000001",
  tools: "00000000-0000-4000-8000-000000000002",
});

const initialProjectStatuses = () =>
  new Map([
    [MOCK_DSM_PROJECTS.stack, "RUNNING"],
    [MOCK_DSM_PROJECTS.tools, "STOPPED"],
  ]);

/**
 * `SYNO.Docker.Project list`. Real: the id-keyed map (synology-go
 * `ProjectList = map[string]Project`, N4S4 `list_projects`, MIT). Legacy: the
 * array form with plain service names.
 */
export function dockerProjectsData(wire, statuses) {
  const projects = Object.entries(MOCK_DSM_PROJECTS).map(([name, id]) => ({
    containerIds:
      name === "stack" ? [`${"0".repeat(61)}a01`, `${"0".repeat(61)}a02`] : [],
    created_at: "2026-03-14T14:07:04.874304Z",
    enable_service_portal: name === "stack",
    id,
    is_package: false,
    name,
    path: `/volume1/docker/${name}`,
    services:
      name === "stack"
        ? [
            {
              display_name: "stack (project)",
              id: `Docker-Project-${id}`,
              proxy_target: "http://127.0.0.1:8080",
              service: `Docker-Project-${id}`,
              type: "reverse_proxy",
            },
          ]
        : null,
    share_path: `/docker/${name}`,
    state: "",
    status: statuses.get(id),
    updated_at: "2026-03-14T15:17:31.840634Z",
    version: 2,
  }));
  if (wire === "legacy") {
    return projects.map(
      ({ id, name, path: projectPath, services, status }) => ({
        id,
        name,
        path: projectPath,
        services: (services ?? []).map((service) => service.display_name),
        status,
      }),
    );
  }
  return Object.fromEntries(projects.map((project) => [project.id, project]));
}

/**
 * `SYNO.Backup.Task list`. Shape: zabbix Hyper Backup template (behaviour
 * only) and pmilano1 `hyper-backup/tasks.md` (MIT): the backup times and
 * `is_modified` are only sent when `additional` asks for them.
 */
export function backupTasksData(wire, values) {
  const additional = values.additional ?? [];
  const extra = {
    is_modified: { is_modified: false },
    last_bkp_result: { last_bkp_result: "done" },
    last_bkp_time: {
      last_bkp_end_time: "2026/09/14 02:12:30",
      last_bkp_time: "2026/09/14 02:00:00",
    },
    next_bkp_time: { next_bkp_time: "2026/09/15 02:00" },
  };
  const task = {
    data_type: "data",
    name: "mock-nightly",
    repo_id: 1,
    state: "backupable",
    status: "none",
    target_type: "cloud",
    task_id: 1,
  };
  for (const key of additional) {
    if (Object.hasOwn(extra, key)) Object.assign(task, extra[key]);
  }
  return wire === "legacy"
    ? [task]
    : { is_restoring: false, task_list: [task] };
}

/** The one disk `Storage.CGI.Smart` knows (Utilization's `sata1`). */
export const MOCK_DSM_SMART_DISK = "sata1";

/**
 * `SYNO.Storage.CGI.Smart`. No public success sample exists (audit S§7 #3).
 * Real (`get_health_info`): t84-e12c's synthetic DSM-style spellings. Legacy
 * (`get`): the SMART DTO field names the pre-t84 decoder read.
 */
export function smartData(wire) {
  if (wire === "legacy") {
    return {
      attributes: [
        {
          current: 100,
          id: 5,
          name: "Reallocated_Sector_Ct",
          raw: "0",
          status: "OK",
          threshold: 10,
          worst: 100,
        },
      ],
      disk_id: MOCK_DSM_SMART_DISK,
      disk_name: "Drive 1",
      health_status: "normal",
      power_on_hours: 12345,
      reallocated_sectors: 0,
      temperature: 35,
    };
  }
  return {
    attributes: [
      {
        current: "100",
        id: "5",
        name: "Reallocated_Sector_Ct",
        raw: 0,
        status: "OK",
        threshold: "10",
        worst: 100,
      },
      {
        current: 86,
        id: 9,
        name: "Power_On_Hours",
        raw: "12345",
        status: "OK",
        threshold: 0,
        worst: 86,
      },
    ],
    health: "normal",
    longName: "Drive 1",
    power_on_hours: "12345",
    reallocated_sectors: 0,
    temp: "35",
  };
}

// ─────────────────────────────────────────────────────────────── API table ──

/**
 * Parameter kinds. `string` values are JSON-quoted on `requestFormat: JSON`
 * APIs and raw elsewhere; `values` restricts what DSM accepts. `text` is never
 * inspected (secrets, free text). `list` is a JSON array of strings.
 */
const int = Object.freeze({ kind: "int" });
const text = Object.freeze({ kind: "text" });
const list = Object.freeze({ kind: "list" });
const string = (values = null) => Object.freeze({ kind: "string", values });

const PAGE = Object.freeze({ offset: int, limit: int });
const FILE_LIST = Object.freeze({
  ...PAGE,
  additional: list,
  sort_by: string(),
  sort_direction: string(["asc", "desc"]),
});

/**
 * `privilege`: who may call it at all. `grantable`: whether DSM still allows it
 * in a limited (portal or handshake-less remote) session — mirrors DSM's own
 * definitions where DSM.Info/File Station are grantable and Core admin APIs are
 * not. `Initdata` is DSM's desktop bootstrap and answers any session.
 * Catalog entries (versions, `requestFormat`) follow py-synologydsm-api
 * `dsm_7/const_7_api_info.py` via the t84-r1 audit, except `Auth.Type`; the
 * t84-e8b read APIs take DSM 7's `requestFormat: "JSON"` and the managers'
 * version caps.
 *
 * `methods`: name -> `{ required, optional, missingCode, signed, wire }`.
 * `signed: false` means DSM's unsigned call (no `_sid`/`SynoToken`); `wire`
 * limits a method to one wire, and elsewhere it answers 103 unrecorded.
 */
const API_TABLE = Object.freeze({
  "SYNO.API.Info": {
    min: 1,
    max: 1,
    methods: { query: { optional: { query: text } } },
    public: true,
  },
  "SYNO.API.Auth": {
    min: 1,
    max: 7,
    methods: {
      login: {
        optional: {
          account: text,
          passwd: text,
          session: text,
          format: string(["sid", "cookie"]),
          enable_syno_token: string(["yes", "no"]),
          otp_code: text,
          enable_device_token: string(["yes", "no"]),
          device_name: text,
          device_id: text,
          ik_message: text,
        },
      },
      logout: { optional: { session: text } },
    },
    public: true,
  },
  // App-shaped: no catalog or response evidence in the audit (plan §7.3).
  // e11 sends only `account`, unsigned.
  "SYNO.API.Auth.Type": {
    min: 1,
    max: 1,
    methods: { get: { optional: { account: string() }, signed: false } },
    public: true,
  },
  "SYNO.API.Auth.UIConfig": {
    min: 1,
    max: 1,
    methods: { get: {} },
    public: true,
    uiConfigOnly: true,
    requestFormat: "JSON",
  },
  "SYNO.DSM.Info": {
    min: 2,
    max: 2,
    methods: { getinfo: {} },
    privilege: "any",
    grantable: true,
    requestFormat: "JSON",
  },
  "SYNO.FileStation.Info": {
    min: 1,
    max: 2,
    methods: { get: {} },
    privilege: "any",
    grantable: true,
    requestFormat: "JSON",
  },
  "SYNO.FileStation.List": {
    min: 1,
    max: 2,
    methods: {
      list_share: { optional: FILE_LIST },
      list: { optional: { ...FILE_LIST, folder_path: string() } },
    },
    privilege: "any",
    grantable: true,
    requestFormat: "JSON",
  },
  "SYNO.Core.Desktop.Initdata": {
    min: 1,
    max: 1,
    methods: { get: {} },
    privilege: "any",
    grantable: true,
    requestFormat: "JSON",
  },
  "SYNO.Core.System.Utilization": {
    min: 1,
    max: 1,
    methods: { get: {} },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  "SYNO.Core.User": {
    min: 1,
    max: 1,
    methods: { list: { optional: { ...PAGE, additional: list } } },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  "SYNO.Core.Group": {
    min: 1,
    max: 1,
    methods: { list: { optional: PAGE } },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  "SYNO.Core.Security.Firewall.Adapter": {
    min: 1,
    max: 1,
    methods: { list: {} },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  // `.lib` lists load/save_*; there is no `list_all`. A `load` without its
  // adapter answered 120 on a live DSM 7 (KastnerRG, audit S§4 #7).
  "SYNO.Core.Security.Firewall.Rules": {
    min: 1,
    max: 1,
    methods: {
      load: {
        required: { adapter: string(MOCK_DSM_FIREWALL_ADAPTERS) },
        missingCode: 120,
      },
    },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  "SYNO.ActiveBackup.Device": {
    min: 1,
    max: 1,
    methods: { list: {} },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  // DSM answers the list without parameters with 5100 (probed 7.4, KastnerRG).
  "SYNO.Core.Security.AutoBlock.Rules": {
    min: 1,
    max: 1,
    methods: {
      list: {
        required: { ...PAGE, type: string(["deny", "allow"]) },
        missingCode: 5100,
      },
    },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  // vcf: `start` is required; gaaasp/nas adds offset, target and logtype.
  "SYNO.Core.SyslogClient.Log": {
    min: 1,
    max: 1,
    methods: {
      list: {
        required: { start: int, limit: int },
        optional: {
          offset: int,
          target: string(["LOCAL"]),
          logtype: string(["system", "connection"]),
        },
      },
    },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  "SYNO.Core.Service": {
    min: 1,
    max: 3,
    methods: { get: { optional: { additional: list } } },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  // Every public client sends `type=all` (synology-go, vcf); the mock needs it.
  "SYNO.Docker.Container": {
    min: 1,
    max: 1,
    methods: {
      list: { required: { type: string(["all"]) }, optional: PAGE },
    },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  // Actions take the project `id` (N4S4, synology-go), never its name.
  "SYNO.Docker.Project": {
    min: 1,
    max: 1,
    methods: {
      list: {},
      start: {
        required: { id: string(Object.values(MOCK_DSM_PROJECTS)) },
      },
      stop: {
        required: { id: string(Object.values(MOCK_DSM_PROJECTS)) },
      },
    },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  "SYNO.Backup.Task": {
    min: 1,
    max: 1,
    methods: { list: { optional: { additional: list } } },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
  // `get` did not answer the DSM 7.4 probe; N4S4 reads `get_health_info`. A
  // wrong parameter name answered 114 (vcf, `disk_id`).
  "SYNO.Storage.CGI.Smart": {
    min: 1,
    max: 1,
    methods: {
      get: {
        required: { disk: string([MOCK_DSM_SMART_DISK]) },
        wire: "legacy",
      },
      get_health_info: {
        required: { disk: string([MOCK_DSM_SMART_DISK]) },
      },
    },
    privilege: "administrator",
    grantable: false,
    requestFormat: "JSON",
  },
});

function advertisedApis(state) {
  const data = {};
  for (const [name, spec] of Object.entries(API_TABLE)) {
    if (spec.uiConfigOnly && state.uiConfig !== "no_reply") continue;
    data[name] = {
      path: "entry.cgi",
      minVersion: spec.min,
      maxVersion: spec.max,
      ...(spec.requestFormat ? { requestFormat: spec.requestFormat } : {}),
    };
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────── state ──

function createState(options) {
  const uiConfig = options.uiConfig ?? "absent";
  if (!UI_CONFIG_MODES.includes(uiConfig)) {
    throw new Error(`[mock-dsm] unsupported uiConfig mode: ${uiConfig}`);
  }
  const wire = options.wire ?? "real";
  if (!WIRE_MODES.includes(wire)) {
    throw new Error(`[mock-dsm] unsupported wire mode: ${wire}`);
  }
  // A real X25519 static key, so a client can import the `_SSID` value; the
  // private half is never used because this fixture has no Noise responder.
  const { publicKey } = crypto.generateKeyPairSync("x25519");
  return {
    uiConfig,
    wire,
    serverStaticKey: publicKey.export({ format: "jwk" }).x,
    /** sid -> { account, token, kind, sessionName } */
    sessions: new Map(),
    /** account -> { deviceId, deviceName } issued by a verified OTP login */
    trustedDevices: new Map(),
    /** project id -> "RUNNING" | "STOPPED" */
    projects: initialProjectStatuses(),
    /** Raw requests (in-process tests only; contains throwaway secrets). */
    requests: [],
    /** Sanitized login outcomes. */
    logins: [],
    /** Sanitized API calls after routing. */
    calls: [],
    /** Value-free requests the app should not send (see the header). */
    unexpected: [],
    onUnexpected:
      typeof options.onUnexpected === "function" ? options.onUnexpected : null,
    uiConfigRequests: 0,
  };
}

function resetState(state) {
  state.sessions.clear();
  state.trustedDevices.clear();
  state.projects = initialProjectStatuses();
  state.requests.length = 0;
  state.logins.length = 0;
  state.calls.length = 0;
  state.unexpected.length = 0;
  state.uiConfigRequests = 0;
}

/** Value-free view for the forked IPC channel: no passwords, codes, SIDs, tokens or device ids. */
export function snapshotState(state) {
  return {
    uiConfig: state.uiConfig,
    wire: state.wire,
    uiConfigRequests: state.uiConfigRequests,
    activeSessions: [...state.sessions.values()].map((session) => ({
      account: session.account,
      kind: session.kind,
      sessionName: session.sessionName,
    })),
    logins: state.logins.map((login) => ({ ...login })),
    calls: state.calls.map((call) => ({ ...call })),
    unexpected: state.unexpected.map((entry) => ({ ...entry })),
  };
}

// ────────────────────────────────────────────────────────────────── helpers ──

const success = (data) =>
  data === undefined ? { success: true } : { data, success: true };
const failure = (code) => ({ error: { code }, success: false });

function parseCookies(header) {
  const cookies = new Map();
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    cookies.set(
      part.slice(0, separator).trim(),
      part.slice(separator + 1).trim(),
    );
  }
  return cookies;
}

/** A JSON-quoted string value (`"all"`), decoded; `null` when not quoted. */
function jsonString(value) {
  if (!value.startsWith('"')) return null;
  try {
    const decoded = JSON.parse(value);
    return typeof decoded === "string" ? decoded : null;
  } catch {
    return null;
  }
}

function decodeParam(type, raw, jsonFormat) {
  switch (type.kind) {
    case "int":
      return /^[0-9]{1,9}$/u.test(raw)
        ? { value: Number(raw) }
        : { invalid: true };
    case "list": {
      try {
        const value = JSON.parse(raw);
        if (
          Array.isArray(value) &&
          value.every((entry) => typeof entry === "string")
        ) {
          return { value };
        }
      } catch {
        /* invalid below */
      }
      return { invalid: true };
    }
    case "string": {
      const quoted = jsonString(raw);
      const value = quoted ?? raw;
      const quoting = jsonFormat
        ? quoted === null
          ? "unquoted_string"
          : null
        : quoted === null
          ? null
          : "quoted_string";
      return type.values && !type.values.includes(value)
        ? { quoting, invalid: true }
        : { quoting, value };
    }
    default:
      return { value: raw };
  }
}

const ALWAYS_ALLOWED = new Set(["api", "version", "method"]);
const SESSION_PARAMS = new Set(["_sid", "SynoToken"]);

/**
 * Decode the method's declared parameters. `failure` is the DSM code a
 * missing (114, or the method's `missingCode`) or unreadable (120) parameter
 * gets once the session and permission checks pass.
 */
function readParams(spec, methodSpec, params) {
  const required = methodSpec.required ?? {};
  const declared = { ...required, ...(methodSpec.optional ?? {}) };
  const issues = [];
  const values = {};
  for (const key of new Set(params.keys())) {
    if (ALWAYS_ALLOWED.has(key) || Object.hasOwn(declared, key)) continue;
    if (SESSION_PARAMS.has(key) && methodSpec.signed !== false) continue;
    issues.push({ kind: "unexpected_param", param: key });
  }
  let missing = false;
  let invalid = false;
  for (const [key, type] of Object.entries(declared)) {
    const raw = params.get(key);
    if (raw === null) {
      if (Object.hasOwn(required, key)) {
        missing = true;
        issues.push({ kind: "missing_param", param: key });
      }
      continue;
    }
    const decoded = decodeParam(type, raw, spec.requestFormat === "JSON");
    if (decoded.quoting) issues.push({ kind: decoded.quoting, param: key });
    if (decoded.invalid) {
      invalid = true;
      issues.push({ kind: "invalid_param", param: key });
    } else {
      values[key] = decoded.value;
    }
  }
  const code = missing ? (methodSpec.missingCode ?? 114) : invalid ? 120 : 0;
  return { values, issues, failure: code };
}

function base64UrlByteLength(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) return 0;
  return Buffer.from(value, "base64url").length;
}

function resolveSession(state, params, headers) {
  const sid = params.get("_sid") || parseCookies(headers.cookie).get("id");
  if (!sid) return null;
  const session = state.sessions.get(sid);
  if (!session) return null;
  if (session.token) {
    const token = params.get("SynoToken") || headers["x-syno-token"];
    if (token !== session.token) return null;
  }
  return { sid, ...session };
}

// ──────────────────────────────────────────────────────────────────── login ──

function login(state, version, values) {
  const username = values.account ?? "";
  const password = values.passwd ?? "";
  const otpCode = values.otp_code || null;
  const deviceId = values.device_id || null;
  const deviceName = values.device_name || null;
  const enableDeviceToken = values.enable_device_token === "yes";
  const ikMessage = values.ik_message || null;
  const record = {
    account: username,
    version,
    session: values.session ?? null,
    format: values.format ?? null,
    enableSynoToken: values.enable_syno_token === "yes",
    otpCode:
      otpCode === null
        ? "absent"
        : otpCode === MOCK_DSM_OTP_CODE
          ? "valid"
          : "invalid",
    enableDeviceToken,
    deviceName: deviceName !== null,
    deviceId: "absent",
    ikMessage: ikMessage !== null,
    ikMessageBytes: base64UrlByteLength(ikMessage),
    code: 0,
    deviceTokenIssued: false,
  };
  const done = (code, result = {}) => {
    record.code = code;
    state.logins.push(record);
    return code ? { payload: failure(code) } : result;
  };

  const known = Object.hasOwn(MOCK_DSM_ACCOUNTS, username)
    ? MOCK_DSM_ACCOUNTS[username]
    : null;
  if (!known || !password || password !== known.password) return done(400);
  if (known.login === "enrollment_required") return done(406);
  if (known.login === "approval_required") return done(449);

  let secondFactor = "none";
  if (known.login === "otp") {
    const trusted = state.trustedDevices.get(known.username);
    if (deviceId !== null) {
      record.deviceId =
        trusted &&
        trusted.deviceId === deviceId &&
        trusted.deviceName === deviceName
          ? "trusted"
          : "rejected";
    }
    if (record.deviceId === "trusted") {
      secondFactor = "trusted_device";
    } else if (record.otpCode === "valid") {
      secondFactor = "otp";
    } else if (record.otpCode === "invalid") {
      return done(404);
    } else {
      return done(403);
    }
  }

  const sid = crypto.randomBytes(18).toString("base64url");
  const token = record.enableSynoToken
    ? crypto.randomBytes(12).toString("base64url")
    : null;
  state.sessions.set(sid, {
    account: known.username,
    token,
    kind: known.portal ? "portal" : known.remotePolicy ? "limited" : "full",
    sessionName: record.session,
    secondFactor,
  });

  const data = {
    is_portal_port: known.portal,
    sid,
    ...(token ? { synotoken: token } : {}),
  };
  if (secondFactor === "otp" && enableDeviceToken && deviceName) {
    state.trustedDevices.set(known.username, {
      deviceId: MOCK_DSM_DEVICE_ID,
      deviceName,
    });
    // DSM 7 captures (py-synologydsm-api `const_7_api_auth.py`) return
    // `device_id`; the 2023 login guide documents `did`.
    data[state.wire === "legacy" ? "did" : "device_id"] = MOCK_DSM_DEVICE_ID;
    record.deviceTokenIssued = true;
  }
  const cookies =
    record.format === null || record.format === "cookie"
      ? [`id=${sid}; path=/; HttpOnly`]
      : [];
  return done(0, { payload: success(data), cookies });
}

// ─────────────────────────────────────────────────────────────── API routes ──

/** Real DSM also sends large `JSConfig`/`Strings` blobs; this one must be ignored. */
export const MOCK_DSM_INITDATA_PADDING_BYTES = 128 * 1024;

/** Shape: live DSM 7.4 probe (`scratch/t84/initdata-probed-shape.md`, pmilano1, MIT). */
function initdata(known) {
  return {
    ActionPrivilege: [],
    AppPrivilege: known.administrator
      ? { "SYNO.ALLOW.ALL.APPLICATIONS": true }
      : {
          "SYNO.ALLOW.ALL.APPLICATIONS": false,
          "SYNO.SDS.App.FileStation3.Instance": true,
        },
    GroupSettings: null,
    Session: {
      authType: "local",
      dsm_timeout: 15,
      fullversion: "72806-s3",
      hostname: MOCK_DSM_HOSTNAME,
      isLogined: true,
      is_admin: known.administrator,
      is_secure: false,
      lang: "enu",
      majorversion: "7",
      minorversion: "2",
      productversion: "7.2.2",
    },
    Strings: {
      common: { mock_padding: "x".repeat(MOCK_DSM_INITDATA_PADDING_BYTES) },
    },
    UserSettings: {},
  };
}

/** Synthetic File Station `additional` block. Shape: py-synologydsm-api `dsm_7` File Station fixture (MIT). */
const fileAdditional = (realPath, extra = {}) => ({
  mount_point_type: "",
  owner: { gid: 100, group: "users", uid: 1024, user: "admin" },
  perm: {
    acl: { append: true, del: true, exec: true, read: true, write: true },
    is_acl_mode: true,
    posix: 777,
  },
  real_path: realPath,
  time: {
    atime: 1789466400,
    crtime: 1767225600,
    ctime: 1789380000,
    mtime: 1789380000,
  },
  ...extra,
});

function authenticatedApi(state, call, values, known) {
  const { wire } = state;
  switch (`${call.api} ${call.method}`) {
    case "SYNO.DSM.Info getinfo":
      // Real DSM.Info carries no cpu_* / sys_temp (those are Core.System info).
      return success({
        codepage: "enu",
        model: "DS-MOCK",
        ram: 4096,
        serial: MOCK_DSM_SERIAL,
        temperature: 38,
        temperature_warn: false,
        time: "Tue Sep 15 10:00:00 2026",
        uptime: 86400,
        version: "72806",
        version_string: "DSM 7.2.2-72806 Update 3",
      });
    case "SYNO.FileStation.Info get":
      // DSM 7 array form; the File Station guide's DSM 6 form is "cifs,iso".
      return success({
        hostname: MOCK_DSM_HOSTNAME,
        is_manager: known.administrator,
        support_sharing: true,
        support_virtual_protocol: ["cifs", "nfs", "iso"],
        system_codepage: "enu",
        uid: 1026,
      });
    case "SYNO.FileStation.List list_share":
      return success({
        offset: 0,
        shares: [
          {
            additional: fileAdditional("/volume1/e2e-share", {
              volume_status: {
                freespace: 1553335107584,
                readonly: false,
                totalspace: 3821146505216,
              },
            }),
            isdir: true,
            name: "e2e-share",
            path: "/e2e-share",
          },
        ],
        total: 1,
      });
    case "SYNO.FileStation.List list": {
      if (values.folder_path !== "/e2e-share") {
        return failure(408);
      }
      return success({
        files: [
          {
            additional: fileAdditional("/volume1/e2e-share/readme.txt", {
              size: 12,
              type: "TXT",
            }),
            isdir: false,
            name: "readme.txt",
            path: "/e2e-share/readme.txt",
          },
        ],
        offset: 0,
        total: 1,
      });
    }
    case "SYNO.Core.Desktop.Initdata get":
      return success(initdata(known));
    case "SYNO.Core.System.Utilization get":
      return success(utilizationData(wire));
    case "SYNO.Core.User list":
      return success(userListData(wire));
    case "SYNO.Core.Group list":
      return success(groupListData(wire));
    case "SYNO.Core.Security.Firewall.Adapter list":
      return success({ adapter_names: [...MOCK_DSM_FIREWALL_ADAPTERS] });
    case "SYNO.Core.Security.Firewall.Rules load":
      return success(firewallRulesData(values.adapter));
    case "SYNO.ActiveBackup.Device list":
      return success(activeBackupDevicesData(wire));
    case "SYNO.Core.Security.AutoBlock.Rules list":
      return success(blockedIpsData(wire, values));
    case "SYNO.Core.SyslogClient.Log list":
      return success(systemLogsData(wire, values));
    case "SYNO.Core.Service get":
      return success(servicesData(wire, call.version, values));
    case "SYNO.Docker.Container list":
      return success(dockerContainersData(wire, values));
    case "SYNO.Docker.Project list":
      return success(dockerProjectsData(wire, state.projects));
    case "SYNO.Docker.Project start":
    case "SYNO.Docker.Project stop":
      state.projects.set(
        values.id,
        call.method === "start" ? "RUNNING" : "STOPPED",
      );
      return success();
    case "SYNO.Backup.Task list":
      return success(backupTasksData(wire, values));
    case "SYNO.Storage.CGI.Smart get":
    case "SYNO.Storage.CGI.Smart get_health_info":
      return success(smartData(wire));
    default:
      return failure(103);
  }
}

/**
 * @returns {{ payload: object, cookies?: string[] }}
 */
function route(state, gateway, params, headers) {
  const api = params.get("api");
  const method = params.get("method");
  const rawVersion = params.get("version");
  const call = {
    api: api ?? null,
    method: method ?? null,
    version: rawVersion === null ? null : Number.parseInt(rawVersion, 10),
    account: null,
    sessionKind: null,
    requestHash: typeof headers["x-syno-hash"] === "string",
    code: 0,
  };
  const issues = [];
  const finish = (result) => {
    call.code = result.payload.success ? 0 : result.payload.error.code;
    state.calls.push(call);
    for (const issue of issues) {
      const entry = {
        api: call.api,
        method: call.method,
        version: Number.isInteger(call.version) ? call.version : null,
        account: call.account,
        kind: issue.kind,
        param: issue.param ?? null,
        code: call.code,
      };
      state.unexpected.push(entry);
      state.onUnexpected?.({ ...entry });
    }
    return result;
  };

  if (!api || !method || rawVersion === null) {
    issues.push({ kind: "malformed" });
    return finish({ payload: failure(101) });
  }
  const spec = Object.hasOwn(API_TABLE, api) ? API_TABLE[api] : null;
  if (
    !spec ||
    (spec.uiConfigOnly && state.uiConfig !== "no_reply") ||
    (gateway === "query.cgi" && api !== "SYNO.API.Info")
  ) {
    issues.push({ kind: "unknown_api" });
    return finish({ payload: failure(102) });
  }
  const methodSpec = Object.hasOwn(spec.methods, method)
    ? spec.methods[method]
    : null;
  if (!methodSpec || (methodSpec.wire && methodSpec.wire !== state.wire)) {
    // A method this DSM release lacks but the app retries past by design
    // (SMART `get` on the real wire) is not recorded as unexpected.
    if (!methodSpec) issues.push({ kind: "unknown_method" });
    return finish({ payload: failure(103) });
  }
  const version = call.version;
  if (!Number.isInteger(version) || version < spec.min || version > spec.max) {
    issues.push({ kind: "unsupported_version" });
    return finish({ payload: failure(104) });
  }
  const checked = readParams(spec, methodSpec, params);
  issues.push(...checked.issues);

  if (spec.public) {
    if (checked.failure) return finish({ payload: failure(checked.failure) });
    const { values } = checked;
    switch (api) {
      case "SYNO.API.Info":
        return finish({ payload: success(advertisedApis(state)) });
      case "SYNO.API.Auth.Type": {
        const name = values.account ?? "";
        const known = Object.hasOwn(MOCK_DSM_ACCOUNTS, name)
          ? MOCK_DSM_ACCOUNTS[name]
          : null;
        call.account = known ? known.username : null;
        return finish({ payload: success(known ? [...known.authTypes] : []) });
      }
      case "SYNO.API.Auth.UIConfig":
        state.uiConfigRequests += 1;
        return finish({
          payload: success({}),
          cookies: [`_SSID=${state.serverStaticKey}; path=/; HttpOnly`],
        });
      case "SYNO.API.Auth":
        if (method === "login") {
          const result = login(state, version, values);
          call.account = values.account ?? null;
          return finish(result);
        } else {
          const session = resolveSession(state, params, headers);
          if (session) {
            call.account = session.account;
            call.sessionKind = session.kind;
            state.sessions.delete(session.sid);
          }
          return finish({ payload: success() });
        }
      default:
        return finish({ payload: failure(102) });
    }
  }

  const session = resolveSession(state, params, headers);
  if (!session) return finish({ payload: failure(119) });
  const known = MOCK_DSM_ACCOUNTS[session.account];
  call.account = session.account;
  call.sessionKind = session.kind;
  if (
    (session.kind !== "full" && !spec.grantable) ||
    (spec.privilege === "administrator" && !known.administrator)
  ) {
    return finish({ payload: failure(105) });
  }
  if (checked.failure) return finish({ payload: failure(checked.failure) });
  return finish({
    payload: authenticatedApi(state, call, checked.values, known),
  });
}

// ─────────────────────────────────────────────────────────────────── server ──

/**
 * Start the mock DSM server.
 *
 * @param {{
 *   port?: number, host?: string,
 *   uiConfig?: "absent" | "no_reply", wire?: "real" | "legacy",
 *   onUnexpected?: (entry: object) => void,
 * }} [options]
 */
export async function startMockDsm(options = {}) {
  const state = createState(options);
  const host = options.host ?? DEFAULT_MOCK_DSM_HOST;
  const port = options.port ?? DEFAULT_MOCK_DSM_PORT;

  const server = http.createServer((request, response) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);
      state.requests.push({
        method: request.method ?? "GET",
        path: url.pathname,
        query: url.search,
        headers: request.headers,
        body,
      });

      const match =
        /^\/webapi\/(entry\.cgi|query\.cgi)(?:\/(SYNO\.[A-Za-z0-9.]+))?$/u.exec(
          url.pathname,
        );
      if (!match) {
        response.writeHead(404, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("Not Found");
        return;
      }

      // DSM reads both the query string and the form body; the body wins.
      const params = new URLSearchParams(url.search);
      const contentType = String(request.headers["content-type"] ?? "");
      if (
        request.method === "POST" &&
        contentType.startsWith("application/x-www-form-urlencoded")
      ) {
        for (const [key, value] of new URLSearchParams(body)) {
          params.set(key, value);
        }
      }
      if (match[2] && !params.has("api")) params.set("api", match[2]);

      const { payload, cookies = [] } = route(
        state,
        match[1],
        params,
        request.headers,
      );
      const text = JSON.stringify(payload);
      response.writeHead(200, {
        "content-type": 'application/json; charset="UTF-8"',
        "content-length": Buffer.byteLength(text),
        "cache-control": "no-store",
        ...(cookies.length ? { "set-cookie": cookies } : {}),
      });
      response.end(text);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort =
    typeof address === "object" && address ? address.port : port;

  return {
    server,
    state,
    host,
    port: boundPort,
    url: `http://${host}:${boundPort}`,
    uiConfig: state.uiConfig,
    wire: state.wire,
    snapshot: () => snapshotState(state),
    reset: () => resetState(state),
    async stop() {
      await new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}

/** Serializable description of a running fixture (no server internals). */
export function describeMockDsm(handle) {
  return {
    url: handle.url,
    host: handle.host,
    port: handle.port,
    uiConfig: handle.uiConfig,
    wire: handle.wire,
    accounts: Object.fromEntries(
      Object.entries(MOCK_DSM_ACCOUNTS).map(([name, entry]) => [
        name,
        { username: entry.username, password: entry.password },
      ]),
    ),
    otpCode: MOCK_DSM_OTP_CODE,
    cpu: { ...MOCK_DSM_CPU },
    hostname: MOCK_DSM_HOSTNAME,
    serial: MOCK_DSM_SERIAL,
  };
}

// ────────────────────────────────────────────────────────────── forked CLI ──

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);

if (invokedDirectly) {
  const handle = await startMockDsm({
    port: Number.parseInt(
      process.env.MOCK_DSM_PORT ?? String(DEFAULT_MOCK_DSM_PORT),
      10,
    ),
    host: process.env.MOCK_DSM_HOST ?? DEFAULT_MOCK_DSM_HOST,
    uiConfig: process.env.MOCK_DSM_UI_CONFIG || "absent",
    wire: process.env.MOCK_DSM_WIRE || "real",
    onUnexpected: (entry) =>
      process.stderr.write(`MOCK_DSM_UNEXPECTED ${JSON.stringify(entry)}\n`),
  });
  const ready = { type: "mock-dsm-ready", ...describeMockDsm(handle) };
  process.stdout.write(`MOCK_DSM_READY ${JSON.stringify(ready)}\n`);
  process.send?.(ready);

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void handle.stop().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("disconnect", shutdown);
  process.on("message", (message) => {
    if (message === "stop" || message?.type === "stop") {
      shutdown();
    } else if (message?.type === "snapshot") {
      process.send?.({
        type: "mock-dsm-snapshot",
        id: message.id,
        snapshot: handle.snapshot(),
      });
    } else if (message?.type === "reset") {
      handle.reset();
      process.send?.({ type: "mock-dsm-reset", id: message.id });
    }
  });
}
