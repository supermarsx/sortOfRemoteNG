import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
vi.mock("../../src/hooks/synology/synologyApiCapabilities", () => ({
  verifySynologyApiTransportCapabilities: vi.fn().mockResolvedValue(undefined),
}));
import { SynologySessionContent } from "../../src/components/synology/SynologyPanel";
import { useSynologyManager } from "../../src/hooks/synology/useSynologyManager";
import type { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
import type { SynologyTab } from "../../src/hooks/synology/synologyAdminData";
import {
  aggregateSectionStatus,
  SYNOLOGY_READ_STATE_REQUIREMENT,
  SYNOLOGY_SECTION_READS,
  type SynologyAccountAccess,
  type SynologyReadField,
  type SynologyReadState,
} from "../../src/utils/synology/synologyAccess";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: () => <span data-testid="configured-app-loader" />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

/** The exact reply from the user's report (native build before per-read classification). */
const USER_REPORTED_ERROR =
  'SYNO.Core.System.Utilization: Permission denied (code 105)\nsynology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":105}';
/** The same reply once the native client classifies the API privilege (plan §4.2). */
const CLASSIFIED_ERROR =
  'SYNO.Core.System.Utilization: requires a DSM administrator account (code 105)\nsynology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":105,"access":"administrator"}';
const SESSION_REASON =
  "DSM identifies nas-admin as an administrator but denied SYNO.Core.System.Utilization for this API session (session FileStation, route QuickConnect relay). Use Reconnect as DSM session, then recheck access. If it remains, copy the session diagnostics.";
const ADMIN_REASON =
  "DSM allows SYNO.Core.System.Utilization only for administrators or accounts with a matching delegated administration role.";

const fixtures: Record<string, unknown> = {
  syn_fs_list: {
    files: [{ path: "/public", name: "public", isdir: true }],
    total: 1,
    offset: 0,
  },
  syn_get_system_info: {
    model: "DS923+",
    serial: "serial123",
    version: "7.2",
    ram: 8192,
  },
  syn_get_utilization: {
    cpu: { systemLoad: 71, userLoad: 9 },
    memory: { totalReal: 8192, availReal: 4096 },
    network: [],
    disk: [],
  },
  syn_get_dashboard: {
    systemInfo: { model: "DS923+", version: "7.2" },
    utilization: null,
    storage: null,
    network: null,
    hardware: null,
  },
  syn_get_storage_overview: {
    disks: [],
    volumes: [],
    storagePools: [],
    ssdCaches: [],
    hotSpares: [],
  },
  syn_list_disks: [{ id: "disk1", name: "Disk one", status: "normal" }],
  syn_list_volumes: [{ id: "volume1", displayName: "Main volume" }],
};
const APIS: Partial<Record<SynologyReadField, string>> = {
  systemInfo: "SYNO.DSM.Info",
  utilization: "SYNO.Core.System.Utilization",
  storageOverview: "SYNO.Storage.CGI.Storage",
  disks: "SYNO.Storage.CGI.Storage",
  volumes: "SYNO.Storage.CGI.Storage",
  networkOverview: "SYNO.Core.Network",
};
const REQUIREMENT_ORDER = [
  "administrator",
  "session",
  "application_privilege",
  "permission",
  "package",
  "dsm_version",
] as const;
const account = (
  overrides: Partial<SynologyAccountAccess> = {},
): SynologyAccountAccess => ({
  signedInAs: "nas-viewer",
  role: "standard",
  portalSession: false,
  sessionName: "FileStation",
  loginHandshake: "ik",
  authVersion: 7,
  route: "quickconnect_relay",
  secondFactor: "otp",
  ...overrides,
});
/** A snapshot the strict contract validator accepts. */
const snapshot = (
  section: SynologyTab,
  states: Partial<Record<SynologyReadField, [SynologyReadState, string?]>> = {},
  who: SynologyAccountAccess = account(),
) => {
  const reads = SYNOLOGY_SECTION_READS[section].map((field) => {
    const [state, reason] = states[field] ?? ["available"];
    return {
      field,
      api: APIS[field] ?? `SYNO.Test.${field}`,
      state,
      reason: reason ?? (state === "available" ? "Read successfully." : state),
    };
  });
  const requirements = reads.map(
    (read) => SYNOLOGY_READ_STATE_REQUIREMENT[read.state],
  );
  return {
    section,
    status: aggregateSectionStatus(reads),
    requirement:
      REQUIREMENT_ORDER.find((item) => requirements.includes(item)) ?? null,
    reason: "Section access fixture.",
    account: who,
    reads,
  };
};
const legacy = (section: string) => ({
  section,
  status: "available",
  reason: "Primary section read succeeded.",
});

type AccessReply = (section: SynologyTab, call: number) => unknown;
let accessReply: AccessReply;
let utilization: () => unknown;
let overrides: Record<string, () => unknown>;
const accessCalls = (section: SynologyTab) =>
  vi
    .mocked(invoke)
    .mock.calls.filter(
      ([command, args]) =>
        command === "syn_get_section_access" &&
        (args as { section: string }).section === section,
    ).length;
const calls = (command: string) =>
  vi.mocked(invoke).mock.calls.filter(([name]) => name === command).length;

beforeEach(() => {
  accessReply = (section) => legacy(section);
  utilization = () => fixtures.syn_get_utilization;
  overrides = {};
  const counts: Partial<Record<SynologyTab, number>> = {};
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "syn_get_section_access") {
        const section = (args as { section: SynologyTab }).section;
        counts[section] = (counts[section] ?? 0) + 1;
        return accessReply(section, counts[section]);
      }
      if (overrides[command]) return overrides[command]();
      if (command === "syn_get_utilization") return utilization();
      return fixtures[command] ?? null;
    });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const connection = () =>
  ({
    instanceId: "instance-a",
    sessionId: "session-a",
    host: "nas.test",
    port: 5001,
    connectionStatus: "connected",
    assertSessionAccess: vi.fn(),
    notifySessionExpired: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn().mockResolvedValue(undefined),
  }) as unknown as ReturnType<typeof useSynologyFileConnection>;
const openTab = async (tab: string) => {
  const button = screen.getByTestId(`synology-tab-${tab}`);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};
const expectNoRawFailure = () => {
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(
    /Failed sections have been cleared|Check the indicated package|synology-diagnostic:/,
  );
};
const renderManager = async (tab: SynologyTab) => {
  const c = connection();
  const view = renderHook(() => useSynologyManager(true, c));
  await waitFor(() =>
    expect(view.result.current.sectionAccess.entries[tab].status).not.toBe(
      "checking",
    ),
  );
  act(() => view.result.current.changeTab(tab));
  return { ...view, connection: c };
};
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("Synology loader obeys per-read access", () => {
  it("user's scenario: a partial System section never invokes utilization on open, Refresh or the 30 s poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    accessReply = (section) =>
      section === "system"
        ? snapshot("system", {
            utilization: ["requires_administrator", ADMIN_REASON],
          })
        : legacy(section);
    utilization = () => {
      throw new Error(USER_REPORTED_ERROR);
    };
    render(<SynologySessionContent connection={connection()} />);
    await openTab("system");
    expect(await screen.findByText("DS923+")).toBeInTheDocument();
    expect(calls("syn_get_system_info")).toBe(1);

    fireEvent.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(calls("syn_get_system_info")).toBe(2));

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    await waitFor(() => expect(calls("syn_get_system_info")).toBe(3));

    expect(calls("syn_get_utilization")).toBe(0);
    expect(screen.queryByText("71")).not.toBeInTheDocument();
    expectNoRawFailure();
  });

  it("user's scenario: records the snapshot restriction and keeps utilization empty", async () => {
    accessReply = (section) =>
      section === "system"
        ? snapshot("system", {
            utilization: ["requires_administrator", ADMIN_REASON],
          })
        : legacy(section);
    const { result } = await renderManager("system");
    await waitFor(() => expect(calls("syn_get_system_info")).toBe(1));
    await waitFor(() => expect(result.current.systemInfo).not.toBeNull());
    expect(result.current.readRestrictions).toEqual({
      utilization: {
        field: "utilization",
        state: "requires_administrator",
        title: "Requires administrator",
        reason: ADMIN_REASON,
        api: "SYNO.Core.System.Utilization",
        source: "access_check",
      },
    });
    expect(result.current.utilization).toBeNull();
    expect(result.current.readFailures).toEqual([]);
    expect(result.current.dataError).toBeNull();
    expect(calls("syn_get_utilization")).toBe(0);
  });

  it("admin variant: a session-restricted read is skipped and explained as a session limit with Reconnect", async () => {
    const admin = account({ signedInAs: "nas-admin", role: "administrator" });
    accessReply = (section) =>
      section === "system"
        ? snapshot(
            "system",
            { utilization: ["session_restricted", SESSION_REASON] },
            admin,
          )
        : legacy(section);
    utilization = () => {
      throw new Error(USER_REPORTED_ERROR);
    };
    const c = connection();
    render(<SynologySessionContent connection={c} />);
    await openTab("system");
    await screen.findByText("DS923+");
    fireEvent.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(calls("syn_get_system_info")).toBe(2));
    expect(calls("syn_get_utilization")).toBe(0);
    expectNoRawFailure();
    const notice = screen.getByTestId("synology-account-notice");
    expect(notice).toHaveTextContent(
      "DSM identifies this account as an administrator but restricted some data for this API session.",
    );
    expect(document.body).not.toHaveTextContent("Requires administrator");
    expect(screen.getByTestId("synology-account-identity")).toHaveTextContent(
      "Administrator: yes",
    );
    const reconnect = screen.getByTestId("synology-reconnect");
    expect(reconnect).toBeEnabled();
    expect(screen.getByTestId("synology-reconnect-dsm-session")).toBeEnabled();
    fireEvent.click(reconnect);
    expect(c.reconnect).toHaveBeenCalledOnce();

    cleanup();
    const { result } = await renderManager("system");
    await waitFor(() =>
      expect(result.current.readRestrictions.utilization).toEqual(
        expect.objectContaining({
          state: "session_restricted",
          title: "Session restricted",
          reason: SESSION_REASON,
          source: "access_check",
        }),
      ),
    );
    expect(calls("syn_get_utilization")).toBe(0);
  });

  it("race: a classified 105 on a read the snapshot allowed becomes a restriction and rechecks the section once", async () => {
    const recheck = deferred();
    accessReply = (section, call) =>
      section !== "system"
        ? legacy(section)
        : call === 1
          ? snapshot("system")
          : recheck.promise;
    utilization = () => {
      throw new Error(CLASSIFIED_ERROR);
    };
    const { result } = await renderManager("system");
    await waitFor(() => expect(calls("syn_get_utilization")).toBe(1));
    await waitFor(() =>
      expect(result.current.readRestrictions.utilization).toEqual({
        field: "utilization",
        state: "requires_administrator",
        title: "Requires administrator",
        reason: ADMIN_REASON,
        api: "SYNO.Core.System.Utilization",
        source: "read_response",
      }),
    );
    expect(accessCalls("system")).toBe(2);
    expect(result.current.readFailures).toEqual([]);
    expect(result.current.dataError).toBeNull();

    // While the recheck is in flight, Refresh still skips the refused read.
    await act(async () => result.current.loadTabData("system"));
    expect(calls("syn_get_utilization")).toBe(1);

    await act(async () =>
      recheck.resolve(
        snapshot("system", {
          utilization: ["requires_administrator", ADMIN_REASON],
        }),
      ),
    );
    await waitFor(() =>
      expect(result.current.readRestrictions.utilization?.source).toBe(
        "access_check",
      ),
    );
    await act(async () => result.current.loadTabData("system"));
    expect(calls("syn_get_utilization")).toBe(1);
    expect(accessCalls("system")).toBe(2);
    expect(result.current.readFailures).toEqual([]);
  });

  it("race in the panel: no alert, no raw diagnostics, and Refresh does not repeat the refused read", async () => {
    accessReply = (section, call) =>
      section === "system" && call === 2
        ? snapshot("system", {
            utilization: ["requires_administrator", ADMIN_REASON],
          })
        : section === "system"
          ? snapshot("system")
          : legacy(section);
    utilization = () => {
      throw new Error(CLASSIFIED_ERROR);
    };
    render(<SynologySessionContent connection={connection()} />);
    await openTab("system");
    await screen.findByText("DS923+");
    await waitFor(() => expect(accessCalls("system")).toBe(2));
    await waitFor(() =>
      expect(screen.getByTestId("synology-tab-system")).toHaveAttribute(
        "data-access-status",
        "partial",
      ),
    );
    fireEvent.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(calls("syn_get_system_info")).toBe(2));
    expect(calls("syn_get_utilization")).toBe(1);
    expectNoRawFailure();
  });

  it("an administrator refused by a racing read is classified as session restricted", async () => {
    const admin = account({ signedInAs: "nas-admin", role: "administrator" });
    accessReply = (section, call) =>
      section === "system" && call === 1
        ? snapshot("system", {}, admin)
        : section === "system"
          ? new Promise(() => {})
          : legacy(section);
    utilization = () => {
      throw new Error(CLASSIFIED_ERROR);
    };
    const { result } = await renderManager("system");
    await waitFor(() =>
      expect(result.current.readRestrictions.utilization).toEqual(
        expect.objectContaining({
          state: "session_restricted",
          title: "Session restricted",
          source: "read_response",
        }),
      ),
    );
    expect(result.current.readRestrictions.utilization?.reason).toContain(
      "administrator but denied SYNO.Core.System.Utilization for this API session",
    );
  });

  it("bounds a backend that keeps reporting access DSM refuses: one automatic recheck per section", async () => {
    utilization = () => {
      throw new Error(USER_REPORTED_ERROR);
    };
    accessReply = (section) =>
      section === "system" ? snapshot("system") : legacy(section);
    const { result } = await renderManager("system");
    await waitFor(() => expect(accessCalls("system")).toBe(2));
    // The fresh "available" snapshot supersedes the local restriction, so the read is retried once.
    await waitFor(() => expect(calls("syn_get_utilization")).toBe(2));
    await waitFor(() =>
      expect(result.current.readRestrictions.utilization).toEqual(
        expect.objectContaining({
          state: "permission_denied",
          title: "Permission denied",
          source: "read_response",
        }),
      ),
    );
    await act(async () => result.current.loadTabData("system"));
    await act(async () => result.current.loadTabData("system"));
    expect(calls("syn_get_utilization")).toBe(2);
    expect(accessCalls("system")).toBe(2);
    expect(result.current.readFailures).toEqual([]);
  });

  it("real failures render parsed per-read details with copyable, redacted diagnostics", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    overrides = {
      syn_list_disks: () => {
        throw new Error(
          'Disk list decode failed token=disk-secret-token\nsynology-diagnostic:v1:{"stage":"api_response","category":"json_schema","httpStatus":200,"contentType":"json","bytesRead":512}',
        );
      },
      syn_list_volumes: () => {
        throw new Error("Volume read failed: password=private-password");
      },
      syn_get_storage_overview: () => {
        throw new Error(
          'SYNO.Storage.CGI.Storage: Permission denied (code 105)\nsynology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":105}',
        );
      },
    };
    render(<SynologySessionContent connection={connection()} />);
    await openTab("storage");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAccessibleName("Some data could not be refreshed");
    const disks = within(alert).getByTestId("synology-read-failure-disks");
    expect(disks).toHaveTextContent("Disks");
    expect(disks).toHaveTextContent(
      "The JSON response did not match the expected DSM API format.",
    );
    expect(within(disks).getByText("Step")).toBeInTheDocument();
    expect(
      within(disks).getByText("Reading a NAS API response"),
    ).toBeInTheDocument();
    expect(within(disks).getByText("HTTP status")).toBeInTheDocument();
    expect(within(disks).getByText("200")).toBeInTheDocument();
    const volumes = within(alert).getByTestId("synology-read-failure-volumes");
    expect(volumes).toHaveTextContent("Volumes");
    expect(volumes).toHaveTextContent("Volume read failed");
    expect(
      within(alert).queryByTestId("synology-read-failure-storageOverview"),
    ).not.toBeInTheDocument();
    expect(
      within(alert).getAllByRole("button", { name: "Copy diagnostics" }),
    ).toHaveLength(1);
    expect(alert).toHaveTextContent(
      "Values from these reads were cleared so stale data is not shown. Retry with Refresh.",
    );
    expect(alert).not.toHaveTextContent(
      /disk-secret-token|private-password|decode failed|synology-diagnostic|No automatic sign-in retry|Failed sections have been cleared/,
    );
    fireEvent.click(
      within(disks).getByRole("button", { name: "Copy diagnostics" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain(
      "Step: Reading a NAS API response",
    );
    expect(writeText.mock.calls[0][0]).not.toMatch(
      /disk-secret-token|decode failed|synology-diagnostic/,
    );
    expect(screen.queryByText("Main volume")).not.toBeInTheDocument();
  });

  it("recheck flips utilization to available: skipped while checking, then loaded and refreshed", async () => {
    const recheck = deferred();
    accessReply = (section, call) =>
      section !== "system"
        ? legacy(section)
        : call === 1
          ? snapshot("system", {
              utilization: ["requires_administrator", ADMIN_REASON],
            })
          : recheck.promise;
    const { result } = await renderManager("system");
    await waitFor(() => expect(calls("syn_get_system_info")).toBe(1));
    expect(calls("syn_get_utilization")).toBe(0);

    act(() => result.current.recheckSection("system"));
    await waitFor(() => expect(accessCalls("system")).toBe(2));
    expect(result.current.sectionAccess.entries.system.status).toBe("checking");
    await act(async () => result.current.loadTabData("system"));
    expect(calls("syn_get_utilization")).toBe(0);
    expect(result.current.readRestrictions.utilization?.state).toBe(
      "requires_administrator",
    );

    await act(async () => recheck.resolve(snapshot("system")));
    await waitFor(() => expect(calls("syn_get_utilization")).toBe(1));
    await waitFor(() =>
      expect(result.current.utilization).toEqual(fixtures.syn_get_utilization),
    );
    expect(result.current.readRestrictions).toEqual({});
    await act(async () => result.current.loadTabData("system"));
    expect(calls("syn_get_utilization")).toBe(2);
  });

  it("recheck in the panel, then Refresh, shows utilization data", async () => {
    let allowed = false;
    accessReply = (section) =>
      section === "system"
        ? allowed
          ? snapshot("system")
          : snapshot("system", {
              utilization: ["requires_administrator", ADMIN_REASON],
            })
        : legacy(section);
    render(<SynologySessionContent connection={connection()} />);
    await openTab("system");
    await screen.findByText("DS923+");
    expect(calls("syn_get_utilization")).toBe(0);
    allowed = true;
    const recheckAll = screen.getByRole("button", {
      name: "Recheck section access",
    });
    await waitFor(() => expect(recheckAll).toBeEnabled());
    fireEvent.click(recheckAll);
    await waitFor(() =>
      expect(screen.getByTestId("synology-tab-system")).toHaveAttribute(
        "data-access-status",
        "available",
      ),
    );
    fireEvent.click(screen.getByTitle("Refresh"));
    expect(await screen.findByText("71")).toBeInTheDocument();
    expect(calls("syn_get_utilization")).toBeGreaterThanOrEqual(1);
    expectNoRawFailure();
  });

  it("session expiry from a read still notifies the connection and adds no banner or restriction", async () => {
    accessReply = (section) =>
      section === "system" ? snapshot("system") : legacy(section);
    utilization = () => {
      throw new Error("SYNOLOGY_SESSION_EXPIRED: Sign in again");
    };
    const { result, connection: c } = await renderManager("system");
    await waitFor(() =>
      expect(c.notifySessionExpired).toHaveBeenCalledWith(
        "session-a",
        "SYNOLOGY_SESSION_EXPIRED: Sign in again",
      ),
    );
    await waitFor(() => expect(result.current.dataLoading).toBe(false));
    expect(result.current.readFailures).toEqual([]);
    expect(result.current.readRestrictions).toEqual({});
    expect(accessCalls("system")).toBe(1);
  });

  it("runs the overview command only while some overview read is loadable", async () => {
    let restrictAll = false;
    accessReply = (section) =>
      section === "dashboard"
        ? snapshot(
            "dashboard",
            restrictAll
              ? {
                  systemInfo: ["requires_administrator"],
                  utilization: ["requires_administrator"],
                  storageOverview: ["requires_administrator"],
                  networkOverview: ["requires_administrator"],
                }
              : { utilization: ["requires_administrator"] },
          )
        : legacy(section);
    const { result } = await renderManager("dashboard");
    await waitFor(() => expect(result.current.dashboard).not.toBeNull());
    expect(calls("syn_get_dashboard")).toBe(1);
    expect(Object.keys(result.current.readRestrictions)).toEqual([
      "utilization",
    ]);

    restrictAll = true;
    act(() => result.current.recheckSection("dashboard"));
    await waitFor(() =>
      expect(Object.keys(result.current.readRestrictions)).toHaveLength(4),
    );
    await waitFor(() => expect(result.current.dashboard).toBeNull());
    await act(async () => result.current.loadTabData("dashboard"));
    expect(calls("syn_get_dashboard")).toBe(1);
  });

  it("SMART: only 105 is explained as a permission refusal, 120 as a failed read", async () => {
    accessReply = (section) =>
      section === "storage" ? snapshot("storage") : legacy(section);
    let code = 105;
    overrides = {
      syn_get_smart_info: () => {
        throw new Error(
          `SYNO.Storage.CGI.Smart: Permission denied (code ${code})\nsynology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":${code}}`,
        );
      },
    };
    const { result } = await renderManager("storage");
    await waitFor(() => expect(result.current.lastRefreshed).not.toBeNull());
    await act(async () => result.current.loadSmartInfo("disk1"));
    expect(result.current.dataError).toContain(
      "DSM did not allow disk health (SMART) data",
    );
    code = 120;
    await act(async () => result.current.loadSmartInfo("disk1"));
    expect(result.current.dataError).toBe(
      "Unable to read SMART data for this session.",
    );
    expect(calls("syn_get_smart_info")).toBe(2);
    expect(accessCalls("storage")).toBe(1);
  });

  it("does not request SMART data when Storage disks are restricted", async () => {
    accessReply = (section) =>
      section === "storage"
        ? snapshot("storage", {
            storageOverview: ["requires_administrator"],
            disks: ["requires_administrator"],
            volumes: ["requires_administrator"],
          })
        : legacy(section);
    const { result } = await renderManager("storage");
    await waitFor(() => expect(result.current.lastRefreshed).not.toBeNull());
    await act(async () => result.current.loadSmartInfo("disk1"));
    expect(calls("syn_get_smart_info")).toBe(0);
    expect(calls("syn_list_disks")).toBe(0);
    expect(result.current.dataError).toBeNull();
  });
});

describe("DSM code 120 is an invalid request, not a permission refusal", () => {
  /** DSM 120 means an invalid or missing parameter; the diagnostic carries no access class. */
  const INVALID_PARAMETER_ERROR =
    'SYNO.Core.System.Utilization: Permission denied (code 120)\nsynology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":120}';
  /** A native build that still labels 120 with an access class; the parser refuses that metadata. */
  const INVALID_PARAMETER_WITH_ACCESS =
    'SYNO.Core.System.Utilization: requires a DSM administrator account (code 120)\nsynology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":120,"access":"administrator"}';
  const INVALID_PARAMETER_SUMMARY =
    "DSM did not accept this request's parameters (invalid or missing parameter).";
  const admin = account({ signedInAs: "nas-admin", role: "administrator" });

  it("an administrator's 120 is a failure card with no restriction notice and no recheck", async () => {
    accessReply = (section) =>
      section === "system" ? snapshot("system", {}, admin) : legacy(section);
    utilization = () => {
      throw new Error(INVALID_PARAMETER_ERROR);
    };
    render(<SynologySessionContent connection={connection()} />);
    await openTab("system");
    await screen.findByText("DS923+");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAccessibleName("Some data could not be refreshed");
    const card = within(alert).getByTestId("synology-read-failure-utilization");
    expect(card).toHaveTextContent(INVALID_PARAMETER_SUMMARY);
    expect(card).toHaveTextContent("This is not a permission denial");
    expect(within(card).getByText("DSM code")).toBeInTheDocument();
    expect(within(card).getByText("120")).toBeInTheDocument();
    expect(within(card).queryByText("Required access")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("synology-read-restriction"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("synology-section-restriction"),
    ).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /Session restricted|Requires administrator|Permission denied|DSM did not allow|synology-diagnostic:/,
    );
    expect(screen.getByTestId("synology-tab-system")).toHaveAttribute(
      "data-access-status",
      "available",
    );

    // Refresh retries the read: a failed request is not a restriction the loader skips.
    fireEvent.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(calls("syn_get_utilization")).toBe(2));
    expect(accessCalls("system")).toBe(1);
  });

  it.each([
    [
      "without an access class",
      INVALID_PARAMETER_ERROR,
      INVALID_PARAMETER_ERROR,
    ],
    [
      "with an access class the parser refuses",
      INVALID_PARAMETER_WITH_ACCESS,
      "The NAS API request failed; diagnostic metadata was unavailable.",
    ],
  ])(
    "the loader lists a 120 %s under read failures and records no restriction",
    async (_label, error, stored) => {
      accessReply = (section) =>
        section === "system" ? snapshot("system", {}, admin) : legacy(section);
      utilization = () => {
        throw new Error(error);
      };
      const { result } = await renderManager("system");
      await waitFor(() =>
        expect(result.current.readFailures).toEqual([
          { field: "utilization", label: "Resource usage", error: stored },
        ]),
      );
      expect(result.current.readRestrictions).toEqual({});
      expect(result.current.utilization).toBeNull();
      await act(async () => result.current.loadTabData("system"));
      expect(calls("syn_get_utilization")).toBe(2);
      expect(accessCalls("system")).toBe(1);
    },
  );

  it("on the same load a 105 still becomes a restriction and rechecks once while a 120 is a failure", async () => {
    const recheck = deferred();
    accessReply = (section, call) =>
      section !== "storage"
        ? legacy(section)
        : call === 1
          ? snapshot("storage")
          : recheck.promise;
    overrides = {
      syn_list_disks: () => {
        throw new Error(
          'SYNO.Storage.CGI.Storage: requires a DSM administrator account (code 105)\nsynology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":105,"access":"administrator"}',
        );
      },
      syn_list_volumes: () => {
        throw new Error(
          'SYNO.Storage.CGI.Storage: Permission denied (code 120)\nsynology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":120}',
        );
      },
    };
    const { result } = await renderManager("storage");
    await waitFor(() =>
      expect(result.current.readRestrictions.disks).toEqual(
        expect.objectContaining({
          state: "requires_administrator",
          source: "read_response",
        }),
      ),
    );
    expect(result.current.readRestrictions.volumes).toBeUndefined();
    expect(result.current.readFailures.map((failure) => failure.field)).toEqual(
      ["volumes"],
    );
    expect(accessCalls("storage")).toBe(2);
  });
});
