import { describe, expect, it } from "vitest";
import {
  ADMIN_READS,
  emptyAdminData,
  type SynologyTab,
} from "../../src/hooks/synology/synologyAdminData";
import {
  aggregateSectionStatus,
  effectiveAccountRole,
  formatSynologySessionDiagnostics,
  isReadLoadable,
  SYNOLOGY_ADMINISTRATOR_READS,
  SYNOLOGY_READ_STATE_REQUIREMENT,
  SYNOLOGY_READ_STATE_TITLES,
  SYNOLOGY_REQUIREMENT_TITLES,
  SYNOLOGY_SECTION_READS,
  synologyAccountSummary,
  validateSectionAccessSnapshot,
  type SynologyAccessRequirement,
  type SynologyReadField,
  type SynologyReadState,
} from "../../src/utils/synology/synologyAccess";
import { SYNOLOGY_SECTION_LABELS } from "../../src/utils/synology/synologySectionLabels";

const PRIORITY: SynologyAccessRequirement[] = [
  "administrator",
  "session",
  "application_privilege",
  "permission",
  "package",
  "dsm_version",
];
const account = (overrides: Record<string, unknown> = {}) => ({
  signedInAs: "nas-admin",
  role: "administrator",
  portalSession: false,
  sessionName: "FileStation",
  loginHandshake: "ik",
  authVersion: 7,
  route: "quickconnect_relay",
  secondFactor: "otp",
  ...overrides,
});
const read = (
  field: SynologyReadField,
  state: SynologyReadState = "available",
  extra: Record<string, unknown> = {},
): {
  field: SynologyReadField;
  api: string;
  state: SynologyReadState;
  reason: string;
  [key: string]: unknown;
} => ({
  field,
  api:
    field === "utilization" ? "SYNO.Core.System.Utilization" : "SYNO.DSM.Info",
  state,
  reason:
    state === "available" ? "Read successfully." : "DSM limited this read.",
  ...extra,
});
function snapshot(
  section: SynologyTab,
  states: Partial<Record<SynologyReadField, SynologyReadState>> = {},
  overrides: Record<string, unknown> = {},
) {
  const reads = SYNOLOGY_SECTION_READS[section].map((field) =>
    read(field, states[field]),
  );
  const present = reads
    .map((entry) => SYNOLOGY_READ_STATE_REQUIREMENT[entry.state])
    .filter(Boolean);
  return {
    section,
    status: aggregateSectionStatus(reads),
    requirement:
      PRIORITY.find((requirement) => present.includes(requirement)) ?? null,
    reason: "Some data in this section needs additional DSM access.",
    account: account(),
    reads,
    ...overrides,
  };
}

describe("section read catalog", () => {
  it("covers all eighteen sections and matches the loader's read fields", () => {
    expect(Object.keys(SYNOLOGY_SECTION_READS).sort()).toEqual(
      Object.keys(SYNOLOGY_SECTION_LABELS).sort(),
    );
    const { dashboard: _dashboard, ...tabs } = ADMIN_READS;
    for (const [tab, reads] of Object.entries(tabs))
      expect([...SYNOLOGY_SECTION_READS[tab as SynologyTab]].sort()).toEqual(
        Object.keys(reads).sort(),
      );
    expect(SYNOLOGY_SECTION_READS.fileStation).toEqual(["fileStationInfo"]);
    const fields = new Set(Object.values(tabs).flatMap(Object.keys));
    expect(fields).toEqual(
      new Set(
        Object.keys(emptyAdminData()).filter(
          (field) => !["dashboard", "selectedDiskSmart"].includes(field),
        ),
      ),
    );
    for (const field of SYNOLOGY_SECTION_READS.dashboard)
      expect(fields.has(field)).toBe(true);
    for (const field of SYNOLOGY_ADMINISTRATOR_READS)
      expect(fields.has(field)).toBe(true);
    for (const section of Object.keys(SYNOLOGY_SECTION_READS) as SynologyTab[])
      expect(new Set(SYNOLOGY_SECTION_READS[section]).size).toBe(
        SYNOLOGY_SECTION_READS[section].length,
      );
  });
  it("titles every read state and requirement", () => {
    expect(SYNOLOGY_READ_STATE_TITLES).toMatchObject({
      requires_administrator: "Requires administrator",
      session_restricted: "Session restricted",
      requires_application_privilege: "Requires application privilege",
      permission_denied: "Permission denied",
      package_not_installed: "Package not installed",
      not_supported: "Not provided by this DSM",
    });
    for (const requirement of PRIORITY)
      expect(SYNOLOGY_REQUIREMENT_TITLES[requirement]).toBeTruthy();
  });
  it.each([
    [undefined, true],
    ["available", true],
    ["unknown", true],
    ["requires_administrator", false],
    ["session_restricted", false],
    ["requires_application_privilege", false],
    ["permission_denied", false],
    ["package_not_installed", false],
    ["not_supported", false],
  ] as const)("isReadLoadable(%s) is %s", (state, loadable) => {
    expect(isReadLoadable(state)).toBe(loadable);
  });
});

describe("validateSectionAccessSnapshot accepts", () => {
  it.each([
    ["available", snapshot("system")],
    [
      "partial administrator",
      snapshot("system", { utilization: "requires_administrator" }),
    ],
    [
      "partial session",
      snapshot("system", { utilization: "session_restricted" }),
    ],
    [
      "denied administrator",
      snapshot("users", {
        users: "requires_administrator",
        groups: "requires_administrator",
      }),
    ],
    [
      "unknown with a restricted read",
      snapshot("users", { users: "requires_administrator", groups: "unknown" }),
    ],
    [
      "unavailable dsm version",
      snapshot("notifications", { notificationConfig: "not_supported" }),
    ],
  ])("%s", (_name, value) => {
    expect(validateSectionAccessSnapshot(value.section, value)).toEqual(value);
  });
  it("package and application names", () => {
    const docker = snapshot(
      "docker",
      Object.fromEntries(
        SYNOLOGY_SECTION_READS.docker.map((field) => [
          field,
          "package_not_installed",
        ]),
      ),
    );
    docker.reads = docker.reads.map((entry) => ({
      ...entry,
      package: "Container Manager",
    }));
    expect(validateSectionAccessSnapshot("docker", docker)).toMatchObject({
      status: "unavailable",
      requirement: "package",
      reads: [{ package: "Container Manager" }, {}, {}, {}],
    });
    const downloads = snapshot("downloads", {
      downloadTasks: "requires_application_privilege",
      downloadStats: "requires_application_privilege",
    });
    downloads.reads[0] = {
      ...downloads.reads[0],
      application: "Download Station",
    };
    expect(validateSectionAccessSnapshot("downloads", downloads)).toMatchObject(
      {
        status: "denied",
        requirement: "application_privilege",
        reads: [{ application: "Download Station" }, {}],
      },
    );
  });
  it.each([
    ["available", null],
    ["denied", "permission"],
    ["unavailable", "dsm_version"],
    ["unknown", null],
  ])("a legacy %s snapshot without reads", (status, requirement) => {
    expect(
      validateSectionAccessSnapshot("vms", {
        section: "vms",
        status,
        reason: "Safe native explanation.",
      }),
    ).toEqual({
      section: "vms",
      status,
      requirement,
      reason: "Safe native explanation.",
      account: null,
      reads: [],
    });
  });
  it.each([
    ["role", ["administrator", "standard", "unknown"]],
    ["sessionName", ["FileStation", "webui"]],
    ["loginHandshake", ["ik", "ik_incomplete", "legacy", "legacy_unavailable"]],
    [
      "route",
      ["direct", "http_proxy", "quickconnect_relay", "quickconnect_direct"],
    ],
    ["secondFactor", ["none", "otp", "trusted_device"]],
    ["portalSession", [true, false]],
    ["authVersion", [6, 7]],
  ])("every account %s value", (key, values) => {
    for (const value of values)
      expect(
        validateSectionAccessSnapshot(
          "system",
          snapshot("system", {}, { account: account({ [key]: value }) }),
        )?.account,
      ).toMatchObject({ [key]: value });
  });
  it("copies only contract keys, never extra native properties", () => {
    const value = snapshot(
      "system",
      {},
      { sid: "sid-secret", account: account({ synoToken: "token-secret" }) },
    );
    value.reads[0] = { ...value.reads[0], url: "https://nas.example.com" };
    const result = validateSectionAccessSnapshot("system", value);
    expect(result).not.toBeNull();
    expect(JSON.stringify(result)).not.toMatch(
      /sid-secret|token-secret|nas\.example\.com/,
    );
  });
});

describe("validateSectionAccessSnapshot rejects", () => {
  const system = () =>
    snapshot("system", { utilization: "requires_administrator" });
  const withRead = (index: number, patch: Record<string, unknown>) => {
    const value = system();
    value.reads[index] = { ...value.reads[index], ...patch };
    return value;
  };
  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "available"],
    ["the wrong section", { ...system(), section: "users" }],
    ["an unknown status", { ...system(), status: "admin" }],
    ["an empty reason", { ...system(), reason: " " }],
    ["a long reason", { ...system(), reason: "x".repeat(1025) }],
    ["a control char in reason", { ...system(), reason: "bad\nreason" }],
    ["a bidi override in reason", { ...system(), reason: "bad\u202ereason" }],
    [
      "a legacy partial",
      { section: "system", status: "partial", reason: "Safe." },
    ],
    [
      "a legacy shape carrying an account",
      {
        section: "system",
        status: "available",
        reason: "Safe.",
        account: account(),
      },
    ],
    ["non-array reads", { ...system(), reads: {} }],
    [
      "a missing read (field-set mismatch)",
      { ...system(), reads: system().reads.slice(0, 1), status: "available" },
    ],
    [
      "an extra read",
      { ...system(), reads: [...system().reads, read("disks")] },
    ],
    [
      "a duplicated field",
      {
        ...system(),
        reads: [
          read("systemInfo"),
          read("systemInfo", "requires_administrator"),
        ],
      },
    ],
    ["a foreign field", withRead(1, { field: "users" })],
    ["an unknown read state", withRead(1, { state: "forbidden" })],
    ["a path in api", withRead(0, { api: "SYNO.Core/../entry.cgi" })],
    ["a URL in api", withRead(0, { api: "https://nas.example.com/webapi" })],
    ["a lower-case api", withRead(0, { api: "syno.dsm.info" })],
    ["an empty api tail", withRead(0, { api: "SYNO." })],
    ["an over-long api", withRead(0, { api: `SYNO.${"A".repeat(121)}` })],
    ["a long read reason", withRead(0, { reason: "x".repeat(1025) })],
    ["a control char in read reason", withRead(0, { reason: "a\u0007b" })],
    ["a long package name", withRead(1, { package: "p".repeat(65) })],
    ["a control char in package", withRead(1, { package: "Pkg\r" })],
    ["a non-string application", withRead(1, { application: 7 })],
    ["a status contradicting reads", { ...system(), status: "available" }],
    ["a status claiming denied", { ...system(), status: "denied" }],
    ["a requirement no read implies", { ...system(), requirement: "package" }],
    ["an unknown requirement", { ...system(), requirement: "root" }],
    [
      "available with a requirement",
      { ...snapshot("system"), requirement: "administrator" },
    ],
    [
      "denied without a requirement",
      {
        ...snapshot("users", {
          users: "requires_administrator",
          groups: "requires_administrator",
        }),
        requirement: null,
      },
    ],
    ["a missing account", { ...system(), account: undefined }],
    ["a null account", { ...system(), account: null }],
    ["an unknown role", { ...system(), account: account({ role: "root" }) }],
    [
      "an unknown session name",
      { ...system(), account: account({ sessionName: "SortOfRemoteNG" }) },
    ],
    [
      "an unknown handshake",
      { ...system(), account: account({ loginHandshake: "noise" }) },
    ],
    ["an unknown route", { ...system(), account: account({ route: "vpn" }) }],
    [
      "an unknown second factor",
      { ...system(), account: account({ secondFactor: "sms" }) },
    ],
    [
      "a NUL in signedInAs",
      { ...system(), account: account({ signedInAs: "nas\u0000admin" }) },
    ],
    [
      "a newline in signedInAs",
      { ...system(), account: account({ signedInAs: "nas\nadmin" }) },
    ],
    [
      "a bidi override in signedInAs",
      { ...system(), account: account({ signedInAs: "\u202enimda" }) },
    ],
    [
      "an empty signedInAs",
      { ...system(), account: account({ signedInAs: "" }) },
    ],
    [
      "a long signedInAs",
      { ...system(), account: account({ signedInAs: "a".repeat(257) }) },
    ],
    [
      "a string authVersion",
      { ...system(), account: account({ authVersion: "7" }) },
    ],
    [
      "a fractional authVersion",
      { ...system(), account: account({ authVersion: 7.5 }) },
    ],
    [
      "a zero authVersion",
      { ...system(), account: account({ authVersion: 0 }) },
    ],
    [
      "a string portalSession",
      { ...system(), account: account({ portalSession: "false" }) },
    ],
  ])("%s", (_name, value) => {
    expect(validateSectionAccessSnapshot("system", value)).toBeNull();
  });
});

describe("effectiveAccountRole", () => {
  const evidence = (
    role: string,
    reads: [SynologyReadField, SynologyReadState][],
  ) => ({
    account: account({ role }) as never,
    reads: reads.map(([field, state]) => read(field, state)) as never,
  });
  it.each([
    [
      "reported administrator wins over refused reads",
      [evidence("administrator", [["users", "requires_administrator"]])],
      "administrator",
    ],
    [
      "reported standard",
      [evidence("standard", [["utilization", "available"]])],
      "standard",
    ],
    [
      "mixed administrator reads imply delegation",
      [
        evidence("unknown", [["utilization", "available"]]),
        evidence("unknown", [
          ["users", "requires_administrator"],
          ["groups", "requires_administrator"],
        ]),
      ],
      "delegated",
    ],
    [
      "every probed administrator read refused implies standard",
      [
        evidence("unknown", [
          ["systemInfo", "available"],
          ["utilization", "requires_administrator"],
        ]),
        evidence("unknown", [
          ["dockerContainers", "package_not_installed"],
          ["sharedFolders", "requires_administrator"],
        ]),
      ],
      "standard",
    ],
    [
      "only unprobed administrator reads",
      [
        evidence("unknown", [
          ["utilization", "unknown"],
          ["notificationConfig", "not_supported"],
        ]),
      ],
      "unknown",
    ],
    [
      "only available administrator reads",
      [evidence("unknown", [["utilization", "available"]])],
      "unknown",
    ],
    [
      "session restriction is not evidence of a standard account",
      [
        evidence("unknown", [
          ["utilization", "session_restricted"],
          ["users", "requires_administrator"],
        ]),
      ],
      "unknown",
    ],
    [
      "application privilege reads are not administrator evidence",
      [
        evidence("unknown", [
          ["downloadTasks", "requires_application_privilege"],
          ["systemInfo", "available"],
        ]),
      ],
      "unknown",
    ],
    ["no entries", [], "unknown"],
    [
      "legacy entries without account",
      [{ account: null, reads: [] }, undefined],
      "unknown",
    ],
  ])("%s", (_name, entries, expected) => {
    expect(effectiveAccountRole(entries as never)).toBe(expected);
    expect(
      effectiveAccountRole(
        Object.fromEntries(
          (entries as unknown[]).map((entry, index) => [`s${index}`, entry]),
        ) as never,
      ),
    ).toBe(expected);
  });
});

describe("session identity text", () => {
  it("spells out the identity line", () => {
    expect(synologyAccountSummary(account() as never, "administrator")).toBe(
      "Signed in as nas-admin · Administrator: yes · Session: FileStation · Login handshake: DSM 7 secure (IK) · Route: QuickConnect relay · 2FA: one-time code",
    );
  });
  it("formats diagnostics from enums and API names only", () => {
    const system = validateSectionAccessSnapshot(
      "system",
      snapshot(
        "system",
        { utilization: "session_restricted" },
        { reason: "Reason mentioning nas.example.com" },
      ),
    )!;
    const text = formatSynologySessionDiagnostics({
      account: system.account,
      role: "administrator",
      entries: {
        system,
        vms: { status: "checking", requirement: null, reads: [] },
      },
    });
    expect(text.split("\n")).toEqual([
      "Synology NAS API session diagnostics",
      "Signed in as: nas-admin",
      "Administrator: yes",
      "Session: FileStation",
      "Login handshake: DSM 7 secure (IK)",
      "Route: QuickConnect relay",
      "2FA: one-time code",
      "Auth API version: 7",
      "Sections:",
      "System: partial (session) — SYNO.Core.System.Utilization session_restricted",
      "Virtual machines: checking",
    ]);
    expect(text).not.toMatch(/nas\.example\.com|Reason/);
    expect(
      formatSynologySessionDiagnostics({
        account: null,
        role: "unknown",
        entries: {},
      }),
    ).toContain("Session identity: not reported by the desktop backend");
  });
});
