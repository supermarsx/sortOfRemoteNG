import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AdminTable from "../../src/components/synology/synologyPanel/AdminTable";
import AdminTools from "../../src/components/synology/synologyPanel/AdminTools";
import DashboardView from "../../src/components/synology/synologyPanel/DashboardView";
import StorageView from "../../src/components/synology/synologyPanel/StorageView";
import SynologyHeader from "../../src/components/synology/synologyPanel/SynologyHeader";
import SystemView from "../../src/components/synology/synologyPanel/SystemView";
import {
  DockerView,
  DownloadsView,
  HardwareView,
  LogsView,
  NotificationsView,
  UsersView,
} from "../../src/components/synology/synologyPanel/SecondaryViews";
import {
  SYNOLOGY_ADMINISTRATOR_ACTION_TOOLTIP,
  synologyTabAccess,
} from "../../src/components/synology/synologyPanel/SynologySectionRestriction";
import { SYNOLOGY_ADMIN_ACTIONS } from "../../src/components/synology/synologyPanel/adminActions";
import type { SubProps } from "../../src/components/synology/synologyPanel/types";
import { SynologyPanel } from "../../src/components/synology/SynologyPanel";
import {
  emptyAdminData,
  type SynologyAdminData,
  type SynologyReadRestriction,
  type SynologyTab,
} from "../../src/hooks/synology/synologyAdminData";
import type { SynologySectionAccess } from "../../src/hooks/synology/useSynologySectionAccess";
import {
  aggregateSectionStatus,
  isReadLoadable,
  SYNOLOGY_READ_STATE_REQUIREMENT,
  SYNOLOGY_READ_STATE_TITLES,
  SYNOLOGY_SECTION_READS,
  type SynologyAccessRequirement,
  type SynologyAccountAccess as Account,
  type SynologyReadAccess,
  type SynologyReadField,
  type SynologyReadState,
} from "../../src/utils/synology/synologyAccess";
import { SYNOLOGY_SECTION_LABELS } from "../../src/utils/synology/synologySectionLabels";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/hooks/synology/synologyApiCapabilities", () => ({
  verifySynologyApiTransportCapabilities: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: () => <span data-testid="configured-app-loader" />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Private-looking NAS values: none of them may reach restriction text.
const HOST = "nas-7f3a.example.com";
const SID = "sid-Zx81VqLmP0";
const NAS_MODEL = "DS920+ lab-unit-SN8842";
const NATIVE_REASON = `Checked https://${HOST}:5001/webapi with ${SID}`;
const RAW_DSM_ERROR =
  'SYNO.Core.System.Utilization: Permission denied (code 105)\nsynology-diagnostic:v1:{"dsmCode":105}';
const NAS_STRINGS = [HOST, SID, NAS_MODEL, "synology-diagnostic", "code 105"];

const API: Partial<Record<SynologyReadField, string>> = {
  systemInfo: "SYNO.DSM.Info",
  utilization: "SYNO.Core.System.Utilization",
  users: "SYNO.Core.User",
  groups: "SYNO.Core.Group",
  dockerContainers: "SYNO.Docker.Container",
  dockerProjects: "SYNO.Docker.Project",
  downloadTasks: "SYNO.DownloadStation.Task",
  notificationConfig: "SYNO.Core.Notification.Setting",
};
const REQUIREMENT_ORDER: SynologyAccessRequirement[] = [
  "administrator",
  "session",
  "application_privilege",
  "permission",
  "package",
  "dsm_version",
];
const account = (overrides: Partial<Account> = {}): Account => ({
  signedInAs: "nas-admin",
  role: "administrator",
  portalSession: false,
  sessionName: "FileStation",
  loginHandshake: "ik",
  authVersion: 7,
  route: "direct",
  secondFactor: "none",
  ...overrides,
});
const viewer = () => account({ signedInAs: "viewer", role: "standard" });
type States = Partial<Record<SynologyReadField, SynologyReadState>>;
function entry(
  section: SynologyTab,
  states: States = {},
  identity: Account | null = account(),
  extras: Pick<SynologyReadAccess, "package" | "application"> = {},
): SynologySectionAccess {
  const reads: SynologyReadAccess[] = SYNOLOGY_SECTION_READS[section].map(
    (field) => ({
      field,
      api: API[field] ?? "SYNO.Core.Test",
      state: states[field] ?? "available",
      reason: NATIVE_REASON,
      ...extras,
    }),
  );
  return {
    section,
    status: aggregateSectionStatus(reads),
    requirement:
      REQUIREMENT_ORDER.find((requirement) =>
        reads.some(
          (read) => SYNOLOGY_READ_STATE_REQUIREMENT[read.state] === requirement,
        ),
      ) ?? null,
    reason: NATIVE_REASON,
    account: identity,
    reads,
  };
}
const checking = (section: SynologyTab): SynologySectionAccess => ({
  section,
  status: "checking",
  requirement: null,
  reason: "Checking read access for this section…",
  account: null,
  reads: [],
});
function manager({
  activeTab = "system",
  identity = account(),
  sections = {},
  data = {},
  reconnect = vi.fn().mockResolvedValue(undefined),
  readRestrictions,
  busy = false,
}: {
  activeTab?: SynologyTab;
  identity?: Account | null;
  sections?: Partial<Record<SynologyTab, SynologySectionAccess>>;
  data?: Partial<Record<keyof SynologyAdminData, unknown>>;
  reconnect?: ReturnType<typeof vi.fn> | null;
  readRestrictions?: Partial<
    Record<SynologyReadField, SynologyReadRestriction>
  >;
  busy?: boolean;
} = {}) {
  const entries = Object.fromEntries(
    (Object.keys(SYNOLOGY_SECTION_LABELS) as SynologyTab[]).map((section) => [
      section,
      sections[section] ?? entry(section, {}, identity),
    ]),
  ) as Record<SynologyTab, SynologySectionAccess>;
  // Like the manager: the active tab's non-loadable snapshot reads, unless a test
  // supplies the loader's view (recheck window, raced DSM refusals).
  const loaderView =
    readRestrictions ??
    Object.fromEntries(
      entries[activeTab].reads
        .filter((read) => !isReadLoadable(read.state))
        .map((read): [SynologyReadField, SynologyReadRestriction] => [
          read.field,
          {
            ...read,
            state: read.state as SynologyReadRestriction["state"],
            title: SYNOLOGY_READ_STATE_TITLES[read.state],
            source: "access_check",
          },
        ]),
    );
  const recheck = vi.fn();
  const open = vi.fn();
  const mgr = {
    ...emptyAdminData(),
    ...data,
    activeTab,
    host: HOST,
    port: 5001,
    username: "nas-admin",
    sessionId: SID,
    dataError: RAW_DSM_ERROR,
    dataLoading: false,
    logPage: 0,
    setLogPage: vi.fn(),
    loadSmartInfo: vi.fn(),
    ...(reconnect ? { reconnect } : {}),
    readRestrictions: loaderView,
    recheckSection: recheck,
    actions: {
      busy,
      open,
      review: null,
      result: null,
      message: null,
      error: null,
      cancel: vi.fn(),
      execute: vi.fn(),
      clearResult: vi.fn(),
    },
    sectionAccess: {
      entries,
      account: identity,
      recheck: vi.fn(),
      checking: false,
      active: true,
    },
  } as unknown as SubProps["mgr"];
  return { mgr, recheck, open, reconnect };
}
const notices = () => screen.queryAllByTestId("synology-read-restriction");
const tableSection = (title: string) =>
  screen
    .getByRole("heading", { name: new RegExp(`^${title}\\b`) })
    .closest("section") as HTMLElement;
const UTILIZATION_TABLES = [
  "CPU",
  "Memory",
  "Network utilization",
  "Disk utilization",
];
const ADMIN_ONLY_REASON =
  "DSM allows this data only for administrators or accounts with a matching delegated administration role.";

describe("per-table read restrictions", () => {
  it("System with utilization requiring administrator keeps System information rows and explains all four utilization tables", () => {
    const { mgr, recheck } = manager({
      identity: viewer(),
      sections: {
        system: entry(
          "system",
          { utilization: "requires_administrator" },
          viewer(),
        ),
      },
      data: { systemInfo: { model: NAS_MODEL, version: "7.2" } },
    });
    render(<SystemView mgr={mgr} />);
    expect(notices()).toHaveLength(4);
    for (const title of UTILIZATION_TABLES) {
      const notice = within(tableSection(title)).getByTestId(
        "synology-read-restriction",
      );
      expect(notice).toHaveAttribute("role", "note");
      expect(notice).toHaveAttribute("data-read-field", "utilization");
      expect(notice).toHaveAttribute(
        "data-read-state",
        "requires_administrator",
      );
      expect(
        within(notice).getByTestId("synology-read-restriction-title"),
      ).toHaveTextContent("Requires administrator");
      expect(
        within(notice).getByTestId("synology-read-restriction-reason"),
      ).toHaveTextContent(ADMIN_ONLY_REASON);
      expect(notice).toHaveTextContent("DSM API: SYNO.Core.System.Utilization");
      expect(
        within(notice).queryByRole("button", { name: /Reconnect/ }),
      ).toBeNull();
      // The notice replaces the table, its search and its empty-row text.
      expect(screen.queryByLabelText(`Search ${title}`)).toBeNull();
    }
    const info = tableSection("System information");
    expect(within(info).queryByTestId("synology-read-restriction")).toBeNull();
    expect(within(info).getByText(NAS_MODEL)).toBeInTheDocument();
    expect(
      screen.getByLabelText("Search System information"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No matching rows/)).toBeNull();
    fireEvent.click(
      within(tableSection("CPU")).getByRole("button", {
        name: "Recheck access",
      }),
    );
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(recheck).toHaveBeenCalledWith("system");
  });

  it("an administrator whose session is restricted sees Session restricted with Reconnect, never Requires administrator", () => {
    const identity = account({ loginHandshake: "legacy" });
    const { mgr, reconnect } = manager({
      identity,
      sections: {
        system: entry(
          "system",
          { utilization: "session_restricted" },
          identity,
        ),
      },
      data: { systemInfo: { model: NAS_MODEL } },
    });
    render(<SystemView mgr={mgr} />);
    expect(notices()).toHaveLength(4);
    for (const notice of notices()) {
      expect(notice).toHaveAttribute("data-read-state", "session_restricted");
      expect(
        within(notice).getByTestId("synology-read-restriction-title"),
      ).toHaveTextContent("Session restricted");
      expect(notice).toHaveTextContent(
        "DSM identifies this account as an administrator but limited this API session: it was signed in without DSM 7's secure login handshake",
      );
      expect(
        within(notice).getByTestId("synology-read-restriction-reconnect"),
      ).toBeEnabled();
      // The DSM desktop profile only helps once the secure handshake worked.
      expect(
        within(notice).queryByTestId(
          "synology-read-restriction-reconnect-dsm-session",
        ),
      ).toBeNull();
    }
    expect(screen.queryByText(/Requires administrator/)).toBeNull();
    expect(screen.queryByText(ADMIN_ONLY_REASON)).toBeNull();
    fireEvent.click(
      within(tableSection("Memory")).getByRole("button", { name: "Reconnect" }),
    );
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledWith();
  });

  it("offers Reconnect as DSM session after a secure handshake, and neither reconnect for an application portal", () => {
    const secure = account({ loginHandshake: "ik" });
    const first = manager({
      identity: secure,
      sections: {
        system: entry("system", { utilization: "session_restricted" }, secure),
      },
    });
    const { unmount } = render(<SystemView mgr={first.mgr} />);
    const notice = within(tableSection("CPU")).getByTestId(
      "synology-read-restriction",
    );
    expect(notice).toHaveTextContent(
      "DSM identifies this account as an administrator but restricted this data for this API session. Use Reconnect as DSM session, then recheck access.",
    );
    fireEvent.click(
      within(notice).getByRole("button", { name: "Reconnect as DSM session" }),
    );
    expect(first.reconnect).toHaveBeenCalledWith({
      sessionProfile: "dsm_desktop",
    });
    unmount();

    const desktop = account({ sessionName: "webui" });
    const second = manager({
      identity: desktop,
      sections: {
        system: entry("system", { utilization: "session_restricted" }, desktop),
      },
    });
    const view = render(<SystemView mgr={second.mgr} />);
    expect(
      screen.queryByRole("button", { name: "Reconnect as DSM session" }),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: "Reconnect" })).toHaveLength(
      4,
    );
    view.unmount();

    const portal = account({ portalSession: true });
    const third = manager({
      identity: portal,
      sections: {
        system: entry("system", { utilization: "session_restricted" }, portal),
      },
    });
    render(<SystemView mgr={third.mgr} />);
    expect(screen.queryByRole("button", { name: /Reconnect/ })).toBeNull();
    expect(notices()[0]).toHaveTextContent(
      "This API session was opened through a DSM application portal",
    );
  });

  it("keeps the Reconnect affordance visible but disabled when the manager cannot reconnect", () => {
    const identity = account({ loginHandshake: "legacy" });
    const { mgr } = manager({
      identity,
      reconnect: null,
      sections: {
        system: entry(
          "system",
          { utilization: "session_restricted" },
          identity,
        ),
      },
    });
    render(<SystemView mgr={mgr} />);
    for (const button of screen.getAllByRole("button", { name: "Reconnect" }))
      expect(button).toBeDisabled();
  });

  it("Overview parts show what DSM returned, explain restricted parts and flag missing parts", () => {
    const { mgr } = manager({
      activeTab: "dashboard",
      identity: viewer(),
      sections: {
        dashboard: entry(
          "dashboard",
          {
            utilization: "requires_administrator",
            storageOverview: "requires_administrator",
          },
          viewer(),
        ),
      },
      data: {
        dashboard: {
          systemInfo: { model: NAS_MODEL, version: "7.2" },
          utilization: null,
          storage: null,
          network: null,
        },
      },
    });
    render(<DashboardView mgr={mgr} />);
    expect(
      within(tableSection("NAS overview")).getByText(NAS_MODEL),
    ).toBeInTheDocument();
    expect(notices().map((n) => n.getAttribute("data-read-field"))).toEqual([
      "utilization",
      "storageOverview",
    ]);
    expect(
      within(tableSection("CPU overview")).getByTestId(
        "synology-read-restriction",
      ),
    ).toHaveTextContent("Requires administrator");
    expect(
      within(tableSection("Volume overview")).getByTestId(
        "synology-read-restriction",
      ),
    ).toHaveTextContent("Requires administrator");
    const network = tableSection("Network overview");
    expect(
      within(network).queryByTestId("synology-read-restriction"),
    ).toBeNull();
    expect(network).toHaveTextContent(
      "DSM did not return this part of the overview. Open Network for details.",
    );
  });

  it("Overview before the first load keeps the generic empty text", () => {
    const { mgr } = manager({ activeTab: "dashboard" });
    render(<DashboardView mgr={mgr} />);
    expect(notices()).toHaveLength(0);
    expect(screen.getAllByText(/No matching rows/)).toHaveLength(4);
    expect(screen.queryByText(/DSM did not return/)).toBeNull();
  });

  it("Docker with only projects missing names the package inline", () => {
    const { mgr } = manager({
      activeTab: "docker",
      sections: {
        docker: entry(
          "docker",
          { dockerProjects: "package_not_installed" },
          account(),
          {
            package: "Container Manager",
          },
        ),
      },
    });
    render(<DockerView mgr={mgr} />);
    expect(notices()).toHaveLength(1);
    const notice = within(tableSection("Projects")).getByTestId(
      "synology-read-restriction",
    );
    expect(notice).toHaveTextContent("Package not installed");
    expect(notice).toHaveTextContent(
      "Container Manager is not installed or not running on this NAS.",
    );
    expect(
      within(notice).queryByRole("button", { name: /Reconnect/ }),
    ).toBeNull();
    expect(screen.getByLabelText("Search Containers")).toBeInTheDocument();
  });

  it("Downloads without the application privilege names the application", () => {
    const { mgr } = manager({
      activeTab: "downloads",
      sections: {
        downloads: entry(
          "downloads",
          { downloadTasks: "requires_application_privilege" },
          viewer(),
          { application: "Download Station" },
        ),
      },
    });
    render(<DownloadsView mgr={mgr} />);
    const notice = within(tableSection("Downloads")).getByTestId(
      "synology-read-restriction",
    );
    expect(notice).toHaveTextContent("Requires application privilege");
    expect(notice).toHaveTextContent(
      "The signed-in account needs the Download Station application privilege (Control Panel › Application Privileges) to read this data.",
    );
    expect(
      within(tableSection("Transfer rates")).queryByTestId(
        "synology-read-restriction",
      ),
    ).toBeNull();
  });

  it("Hardware applies the hardware restriction to its fan and temperature tables", () => {
    const { mgr } = manager({
      activeTab: "hardware",
      sections: {
        hardware: entry("hardware", {
          hardwareInfo: "permission_denied",
          upsInfo: "not_supported",
        }),
      },
    });
    render(<HardwareView mgr={mgr} />);
    for (const title of ["Hardware", "Fans", "Temperatures"])
      expect(
        within(tableSection(title)).getByTestId("synology-read-restriction"),
      ).toHaveTextContent(
        "Permission deniedDSM denied this data for the signed-in account.",
      );
    expect(
      within(tableSection("UPS")).getByTestId("synology-read-restriction"),
    ).toHaveTextContent(
      "Not provided by this DSMThis DSM version does not provide this data.",
    );
    expect(
      within(tableSection("Power schedule")).queryByTestId(
        "synology-read-restriction",
      ),
    ).toBeNull();
  });
});

describe("full-panel section restriction", () => {
  it("Users denied for a standard account shows one panel with Recheck access and the account line", () => {
    const { mgr, recheck } = manager({
      activeTab: "users",
      identity: viewer(),
      sections: {
        users: entry(
          "users",
          { users: "requires_administrator", groups: "requires_administrator" },
          viewer(),
        ),
      },
    });
    render(<UsersView mgr={mgr} />);
    const panel = screen.getByTestId("synology-section-restriction");
    expect(panel).toHaveAttribute("data-section", "users");
    expect(panel).toHaveAttribute("data-requirement", "administrator");
    expect(panel).toHaveAccessibleName("Requires administrator");
    expect(
      within(panel).getByTestId("synology-section-restriction-reason"),
    ).toHaveTextContent(
      "This section needs a DSM administrator account or a delegated administration role.",
    );
    expect(
      within(within(panel).getByTestId("synology-section-restriction-reads"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Users: Requires administrator (SYNO.Core.User)",
      "Groups: Requires administrator (SYNO.Core.Group)",
    ]);
    expect(
      within(panel).getByTestId("synology-section-restriction-account"),
    ).toHaveTextContent(
      "Signed in as viewer · Administrator: no · Session: FileStation · Login handshake: DSM 7 secure (IK) · Route: Direct · 2FA: none",
    );
    expect(notices()).toHaveLength(0);
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: /Reconnect/ }),
    ).toBeNull();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Recheck access" }),
    );
    expect(recheck).toHaveBeenCalledWith("users");
  });

  it("Docker unavailable because the package is missing names the package", () => {
    const { mgr } = manager({
      activeTab: "docker",
      sections: {
        docker: entry(
          "docker",
          {
            dockerContainers: "package_not_installed",
            dockerImages: "package_not_installed",
            dockerNetworks: "package_not_installed",
            dockerProjects: "package_not_installed",
          },
          account(),
          { package: "Container Manager" },
        ),
      },
    });
    render(<DockerView mgr={mgr} />);
    const panel = screen.getByTestId("synology-section-restriction");
    expect(panel).toHaveAttribute("data-requirement", "package");
    expect(panel).toHaveAccessibleName("Package not installed");
    expect(panel).toHaveTextContent(
      "Container Manager is not installed or not running on this NAS.",
    );
    expect(
      screen.queryByRole("button", { name: "Start container" }),
    ).toBeNull();
  });

  it("an administrator's restricted session panel offers Reconnect", () => {
    const identity = account({ loginHandshake: "legacy" });
    const { mgr, reconnect, recheck } = manager({
      activeTab: "users",
      identity,
      sections: {
        users: entry(
          "users",
          { users: "session_restricted", groups: "session_restricted" },
          identity,
        ),
      },
    });
    render(<UsersView mgr={mgr} />);
    const panel = screen.getByTestId("synology-section-restriction");
    expect(panel).toHaveAccessibleName("Session restricted");
    expect(panel).toHaveTextContent("secure login handshake");
    expect(
      within(panel).getByTestId("synology-section-restriction-account"),
    ).toHaveTextContent("Administrator: yes");
    expect(panel).not.toHaveTextContent("Requires administrator");
    fireEvent.click(
      within(panel).getByTestId("synology-section-restriction-reconnect"),
    );
    expect(reconnect).toHaveBeenCalledWith();
    fireEvent.click(
      within(panel).getByTestId("synology-section-restriction-recheck"),
    );
    expect(recheck).toHaveBeenCalledWith("users");
  });

  it("a section DSM does not provide says so", () => {
    const { mgr } = manager({
      activeTab: "notifications",
      sections: {
        notifications: entry("notifications", {
          notificationConfig: "not_supported",
        }),
      },
    });
    render(<NotificationsView mgr={mgr} />);
    const panel = screen.getByTestId("synology-section-restriction");
    expect(panel).toHaveAccessibleName("Not provided by this DSM");
    expect(panel).toHaveTextContent(
      "This DSM version does not provide this section's API.",
    );
  });

  it("a legacy denied snapshot without per-read results still gets the panel", () => {
    const { mgr } = manager({
      activeTab: "logs",
      identity: null,
      sections: {
        logs: {
          section: "logs",
          status: "denied",
          requirement: "permission",
          reason: NATIVE_REASON,
          account: null,
          reads: [],
        },
      },
    });
    render(<LogsView mgr={mgr} />);
    const panel = screen.getByTestId("synology-section-restriction");
    expect(panel).toHaveAccessibleName("Permission denied");
    expect(
      within(panel).queryByTestId("synology-section-restriction-reads"),
    ).toBeNull();
    expect(
      within(panel).queryByTestId("synology-section-restriction-account"),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Next log page" })).toBeNull();
  });

  it("a partial section is not replaced by the panel", () => {
    const { mgr } = manager({
      activeTab: "storage",
      sections: {
        storage: entry("storage", {
          storageOverview: "requires_administrator",
        }),
      },
    });
    render(<StorageView mgr={mgr} />);
    expect(screen.queryByTestId("synology-section-restriction")).toBeNull();
    expect(notices().map((n) => n.getAttribute("data-read-field"))).toEqual([
      "storageOverview",
      "storageOverview",
      "storageOverview",
    ]);
    expect(screen.getByLabelText("Search Disks")).toBeInTheDocument();
  });
});

describe("loader restrictions (mgr.readRestrictions)", () => {
  const restriction = (
    field: SynologyReadField,
    state: SynologyReadRestriction["state"],
    overrides: Partial<SynologyReadRestriction> = {},
  ): SynologyReadRestriction => ({
    field,
    state,
    title: "native title",
    reason: RAW_DSM_ERROR,
    api: API[field],
    source: "access_check",
    ...overrides,
  });

  it("keeps notices while the active section is being rechecked", () => {
    const settled = manager({
      activeTab: "system",
      identity: viewer(),
      data: { systemInfo: { model: "DS920+" } },
      sections: {
        system: entry(
          "system",
          { utilization: "requires_administrator" },
          viewer(),
        ),
      },
    });
    const view = render(<SystemView mgr={settled.mgr} />);
    const before = notices();
    expect(before).toHaveLength(4);
    // Recheck in flight: the snapshot has no reads, the loader keeps the settled restriction.
    const rechecking = manager({
      activeTab: "system",
      identity: viewer(),
      data: { systemInfo: { model: "DS920+" } },
      sections: { system: checking("system") },
      readRestrictions: settled.mgr.readRestrictions,
    });
    expect(rechecking.mgr.sectionAccess.entries.system.reads).toEqual([]);
    view.rerender(<SystemView mgr={rechecking.mgr} />);
    expect(notices()).toHaveLength(4);
    notices().forEach((notice, index) => {
      expect(notice).toBe(before[index]);
      expect(notice).toHaveTextContent("Requires administrator");
    });
    for (const title of UTILIZATION_TABLES)
      expect(within(tableSection(title)).queryByRole("table")).toBeNull();
    expect(screen.queryByText(/No matching rows/)).toBeNull();
  });

  it("a read_response refusal that raced an available snapshot renders the notice, not an empty table", () => {
    const { mgr } = manager({
      activeTab: "system",
      identity: viewer(),
      data: { systemInfo: { model: "DS920+" } },
      readRestrictions: {
        utilization: restriction("utilization", "permission_denied", {
          source: "read_response",
        }),
      },
    });
    // The live snapshot still says every System read is available.
    expect(mgr.sectionAccess.entries.system.status).toBe("available");
    render(<SystemView mgr={mgr} />);
    expect(notices()).toHaveLength(4);
    for (const title of UTILIZATION_TABLES) {
      const table = tableSection(title);
      expect(
        within(table).getByTestId("synology-read-restriction"),
      ).toHaveTextContent(
        "Permission deniedDSM denied this data for the signed-in account.",
      );
      expect(within(table).queryByRole("table")).toBeNull();
      expect(table).not.toHaveTextContent(/No matching rows/);
    }
    expect(screen.queryByText(RAW_DSM_ERROR)).toBeNull();
    expect(
      within(tableSection("System information")).getByText("DS920+"),
    ).toBeInTheDocument();
  });

  it("a read_response session restriction for an administrator offers Reconnect", () => {
    const { mgr, reconnect } = manager({
      activeTab: "system",
      identity: account({ loginHandshake: "legacy" }),
      readRestrictions: {
        utilization: restriction("utilization", "session_restricted", {
          source: "read_response",
          api: undefined,
        }),
      },
    });
    render(<SystemView mgr={mgr} />);
    const notice = within(tableSection("CPU")).getByTestId(
      "synology-read-restriction",
    );
    expect(notice).toHaveTextContent("Session restricted");
    // No API prefix in the native message: nothing is guessed.
    expect(notice).not.toHaveTextContent("DSM API:");
    fireEvent.click(within(notice).getByRole("button", { name: "Reconnect" }));
    expect(reconnect).toHaveBeenCalledWith();
  });

  it("uses readRestrictions as the single source for notices", () => {
    const stale = manager({
      activeTab: "system",
      sections: {
        system: entry("system", { utilization: "requires_administrator" }),
      },
      readRestrictions: {},
    });
    const { unmount } = render(<SystemView mgr={stale.mgr} />);
    expect(notices()).toHaveLength(0);
    unmount();
    // readRestrictions describes the active tab only; another tab's snapshot is not consulted.
    const inactive = manager({
      activeTab: "dashboard",
      sections: {
        system: entry("system", { utilization: "requires_administrator" }),
      },
    });
    render(<SystemView mgr={inactive.mgr} />);
    expect(notices()).toHaveLength(0);
  });

  it("shows the whole-section panel when every read of the active tab was refused", () => {
    const { mgr } = manager({
      activeTab: "users",
      identity: viewer(),
      sections: { users: checking("users") },
      readRestrictions: {
        users: restriction("users", "requires_administrator"),
        groups: restriction("groups", "requires_administrator"),
      },
    });
    render(<UsersView mgr={mgr} />);
    expect(
      screen.getByTestId("synology-section-restriction"),
    ).toHaveAccessibleName("Requires administrator");
  });
});

describe("no NAS-provided strings in restriction text", () => {
  const texts = () =>
    [
      ...notices(),
      ...screen.queryAllByTestId("synology-section-restriction"),
    ].map((element) => element.textContent ?? "");

  it.each<[string, () => React.ReactElement]>([
    [
      "per-read notices from the snapshot",
      () => {
        const { mgr } = manager({
          identity: viewer(),
          sections: {
            system: entry(
              "system",
              { utilization: "requires_administrator" },
              viewer(),
            ),
          },
          data: { systemInfo: { model: NAS_MODEL, hostname: HOST } },
        });
        return <SystemView mgr={mgr} />;
      },
    ],
    [
      "session-restricted notices",
      () => {
        const identity = account({ signedInAs: "nas-admin" });
        const { mgr } = manager({
          identity,
          sections: {
            system: entry(
              "system",
              { utilization: "session_restricted" },
              identity,
            ),
          },
          data: { systemInfo: { model: NAS_MODEL } },
        });
        return <SystemView mgr={mgr} />;
      },
    ],
    [
      "loader restrictions carrying raw DSM text and hostile names",
      () => {
        const { mgr } = manager({
          activeTab: "docker",
          readRestrictions: {
            dockerContainers: {
              field: "dockerContainers",
              state: "package_not_installed",
              title: NAS_MODEL,
              reason: RAW_DSM_ERROR,
              api: `https://${HOST}/webapi/entry.cgi`,
              package: `Container‮Manager ${SID}`,
              source: "read_response",
            },
            dockerImages: {
              field: "dockerImages",
              state: "requires_application_privilege",
              title: HOST,
              reason: NATIVE_REASON,
              application: "x".repeat(65) + HOST,
              source: "read_response",
            },
          },
          data: {
            dockerNetworks: [{ name: HOST }],
          },
        });
        return <DockerView mgr={mgr} />;
      },
    ],
    [
      "the whole-section panel",
      () => {
        const { mgr } = manager({
          activeTab: "users",
          identity: viewer(),
          sections: {
            users: entry(
              "users",
              {
                users: "requires_administrator",
                groups: "requires_administrator",
              },
              viewer(),
            ),
          },
          data: { users: [{ name: HOST }] },
        });
        return <UsersView mgr={mgr} />;
      },
    ],
  ])("%s", (_name, view) => {
    render(view());
    const all = texts();
    expect(all.length).toBeGreaterThan(0);
    for (const text of all) {
      for (const secret of [...NAS_STRINGS, NATIVE_REASON, RAW_DSM_ERROR])
        expect(text).not.toContain(secret);
      expect(text).not.toMatch(/https?:\/\//);
    }
  });

  it("falls back to generic names for unsafe package and application names", () => {
    const { mgr } = manager({
      activeTab: "docker",
      readRestrictions: {
        dockerContainers: {
          field: "dockerContainers",
          state: "package_not_installed",
          title: "",
          reason: "",
          package: "Container‮Manager",
          source: "read_response",
        },
        dockerImages: {
          field: "dockerImages",
          state: "requires_application_privilege",
          title: "",
          reason: "",
          application: "y".repeat(65),
          source: "read_response",
        },
      },
    });
    render(<DockerView mgr={mgr} />);
    expect(
      within(tableSection("Containers")).getByTestId(
        "synology-read-restriction",
      ),
    ).toHaveTextContent(
      "The required package is not installed or not running on this NAS.",
    );
    expect(
      within(tableSection("Images")).getByTestId("synology-read-restriction"),
    ).toHaveTextContent("needs the matching application privilege");
    // An identifier that is not a DSM API name is omitted rather than shown.
    expect(screen.queryByText(/DSM API:/)).toBeNull();
  });
});

describe("administrator action gating", () => {
  const systemActions = ["processes", "update", "reboot", "shutdown"];
  const renderTools = (options: Parameters<typeof manager>[0]) => {
    const built = manager(options);
    render(<AdminTools mgr={built.mgr} />);
    return built;
  };

  it("disables reboot with a tooltip when every System read requires administrator", () => {
    const { open } = renderTools({
      activeTab: "system",
      identity: viewer(),
      sections: {
        system: entry(
          "system",
          {
            systemInfo: "requires_administrator",
            utilization: "requires_administrator",
          },
          viewer(),
        ),
      },
    });
    for (const id of systemActions) {
      const button = screen.getByTestId(`synology-action-${id}`);
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(
        SYNOLOGY_ADMINISTRATOR_ACTION_TOOLTIP,
      );
      expect(screen.getByTestId(`synology-action-gate-${id}`)).toHaveAttribute(
        "data-tooltip",
        "Requires a DSM administrator account",
      );
    }
    const reboot = screen.getByRole("button", { name: "Reboot NAS" });
    expect(reboot).not.toHaveAttribute("data-tooltip");
    fireEvent.click(reboot);
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps reboot enabled for partial (delegated) access", () => {
    const { open } = renderTools({
      activeTab: "system",
      identity: account({ role: "unknown" }),
      sections: {
        system: entry(
          "system",
          { utilization: "requires_administrator" },
          account({ role: "unknown" }),
        ),
      },
    });
    const reboot = screen.getByTestId("synology-action-reboot");
    expect(reboot).toBeEnabled();
    expect(reboot).toHaveAttribute(
      "data-tooltip",
      "Interrupts connections and running jobs on this NAS.",
    );
    expect(reboot).not.toHaveAccessibleDescription();
    expect(screen.queryByTestId("synology-action-gate-reboot")).toBeNull();
    fireEvent.click(reboot);
    expect(open).toHaveBeenCalledWith("reboot");
  });

  it.each<[string, Parameters<typeof manager>[0], string]>([
    [
      "session-restricted reads (a reconnect can lift them)",
      {
        activeTab: "system",
        sections: {
          system: entry("system", {
            systemInfo: "session_restricted",
            utilization: "session_restricted",
          }),
        },
      },
      "reboot",
    ],
    [
      "a mix of administrator and permission refusals",
      {
        activeTab: "system",
        sections: {
          system: entry("system", {
            systemInfo: "permission_denied",
            utilization: "requires_administrator",
          }),
        },
      },
      "reboot",
    ],
    [
      "a legacy snapshot without per-read results",
      {
        activeTab: "system",
        identity: null,
        sections: {
          system: {
            section: "system",
            status: "denied",
            requirement: "permission",
            reason: NATIVE_REASON,
            account: null,
            reads: [],
          },
        },
      },
      "reboot",
    ],
    [
      "an action whose API any user may call",
      {
        activeTab: "logs",
        sections: {
          logs: entry("logs", {
            systemLogs: "requires_administrator",
            connectionLogs: "requires_administrator",
          }),
        },
      },
      "connections",
    ],
    [
      "a section that is still being checked",
      { activeTab: "system", sections: { system: checking("system") } },
      "reboot",
    ],
  ])("does not gate for %s", (_name, options, id) => {
    renderTools(options);
    const button = screen.getByTestId(`synology-action-${id}`);
    expect(button).toBeEnabled();
    expect(screen.queryByTestId(`synology-action-gate-${id}`)).toBeNull();
  });

  it("stays gated while a recheck is in flight when the loader still refuses every read", () => {
    const refusal = (field: SynologyReadField): SynologyReadRestriction => ({
      field,
      state: "requires_administrator",
      title: "Requires administrator",
      reason: "",
      source: "access_check",
    });
    renderTools({
      activeTab: "system",
      sections: { system: checking("system") },
      readRestrictions: {
        systemInfo: refusal("systemInfo"),
        utilization: refusal("utilization"),
      },
    });
    expect(screen.getByTestId("synology-action-reboot")).toBeDisabled();
  });

  it("a busy action runner disables buttons without claiming an administrator requirement", () => {
    renderTools({ activeTab: "system", busy: true });
    const reboot = screen.getByTestId("synology-action-reboot");
    expect(reboot).toBeDisabled();
    expect(screen.queryByTestId("synology-action-gate-reboot")).toBeNull();
    expect(reboot).toHaveAttribute("data-tooltip");
  });

  it("marks exactly the administrator-only action tabs (plan §3b)", () => {
    const anyUserTabs = new Set([
      "fileStation",
      "downloads",
      "surveillance",
      "logs",
    ]);
    for (const action of SYNOLOGY_ADMIN_ACTIONS)
      expect([action.id, action.requires]).toEqual([
        action.id,
        anyUserTabs.has(action.tab) ? undefined : "administrator",
      ]);
    expect(
      SYNOLOGY_ADMIN_ACTIONS.find((action) => action.id === "reboot")?.requires,
    ).toBe("administrator");
  });

  it("synologyTabAccess.administratorOnly needs every read of the tab", () => {
    const all = manager({
      activeTab: "storage",
      sections: {
        storage: entry("storage", {
          storageOverview: "requires_administrator",
          disks: "requires_administrator",
          volumes: "requires_administrator",
        }),
      },
    });
    expect(synologyTabAccess(all.mgr, "storage").administratorOnly).toBe(true);
    const some = manager({
      activeTab: "storage",
      sections: {
        storage: entry("storage", {
          storageOverview: "requires_administrator",
          disks: "requires_administrator",
        }),
      },
    });
    expect(synologyTabAccess(some.mgr, "storage").administratorOnly).toBe(
      false,
    );
  });
});

describe("AdminTable restriction and empty text", () => {
  const columns = [["name", "Name"]] as const;
  it("uses the empty message only while no search is active", () => {
    render(
      <AdminTable
        title="Things"
        rows={[{ name: "alpha" }]}
        columns={columns}
        emptyMessage="Nothing was returned."
      />,
    );
    expect(screen.queryByText("Nothing was returned.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search Things"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/No matching rows/)).toBeInTheDocument();
    cleanup();
    render(
      <AdminTable
        title="Things"
        rows={[]}
        columns={columns}
        emptyMessage="Nothing was returned."
      />,
    );
    expect(screen.getByText("Nothing was returned.")).toBeInTheDocument();
  });
});

describe("SynologyHeader signed-in account", () => {
  const connection = (overrides: Record<string, unknown>) =>
    ({
      connectionStatus: "connected",
      host: "nas.example.test",
      username: "nas-admin",
      ...overrides,
    }) as unknown as Parameters<typeof SynologyHeader>[0]["connection"];

  it("shows the username next to the NAS name when connected", () => {
    render(
      <SynologyHeader
        connection={connection({ username: "  nas-admin " })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("synology-header-host")).toHaveTextContent(
      "nas.example.test",
    );
    expect(screen.getByTestId("synology-header-account")).toHaveTextContent(
      /^Signed in as nas-admin$/,
    );
    expect(
      screen.getByTestId("synology-header-host").parentElement,
    ).toHaveTextContent(/^nas\.example\.test · Signed in as nas-admin$/);
  });

  it.each([
    ["disconnected", { connectionStatus: "disconnected" }, "Not connected"],
    ["connected without a form username", { username: "" }, "nas.example.test"],
  ])("omits the account when %s", (_name, overrides, subtitle) => {
    render(
      <SynologyHeader connection={connection(overrides)} onClose={() => {}} />,
    );
    expect(screen.queryByTestId("synology-header-account")).toBeNull();
    expect(screen.getByText(subtitle)).toBeInTheDocument();
  });
});

describe("mounted panel", () => {
  const snapshot = (section: SynologyTab) => {
    const states: States =
      section === "system" ? { utilization: "requires_administrator" } : {};
    const base = entry(section, states, viewer());
    return {
      ...base,
      account: { ...viewer(), signedInAs: "alice" },
      reason:
        base.status === "available"
          ? "All data in this section was read successfully."
          : "Some data in this section needs additional DSM access; the parts you can read are shown.",
      reads: base.reads.map((read) => ({ ...read, reason: "Read result." })),
    };
  };
  // While set, System access probes wait so a recheck can be observed in flight.
  let holdSystem = false;
  let held: (() => void)[] = [];
  beforeEach(() => {
    holdSystem = false;
    held = [];
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation(async (command, args) => {
        const input = args as Record<string, unknown> | undefined;
        if (
          command === "syn_get_section_access" &&
          input?.section === "system" &&
          holdSystem
        )
          return new Promise((resolve) =>
            held.push(() => resolve(snapshot("system"))),
          );
        switch (command) {
          case "syn_fs_connect":
            return {
              status: "connected",
              sessionId: "receipt-a",
              message: "ok",
            };
          case "syn_fs_disconnect":
            return true;
          case "syn_fs_list":
            return {
              files: [{ name: "public", path: "/public", isdir: true }],
              total: 1,
              offset: 0,
            };
          case "syn_get_section_access":
            return snapshot(input?.section as SynologyTab);
          case "syn_get_system_info":
            return { model: "DS920+", version: "7.2" };
          default:
            return null;
        }
      });
  });
  const openSystem = async () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "nas.example.test" },
    });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "private-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByTestId("synology-file-station");
    await waitFor(() =>
      expect(screen.getByTestId("synology-tab-system")).toHaveAttribute(
        "data-access-status",
        "partial",
      ),
    );
    fireEvent.click(screen.getByTestId("synology-tab-system"));
    await screen.findByText("DS920+");
    await waitFor(() => expect(notices()).toHaveLength(4));
  };
  const calls = (command: string, section?: string) =>
    vi
      .mocked(invoke)
      .mock.calls.filter(
        ([name, args]) =>
          name === command &&
          (!section ||
            (args as Record<string, unknown> | undefined)?.section === section),
      ).length;

  it("keeps the notices through a real Recheck access, without flickering to empty tables", async () => {
    await openSystem();
    const probes = calls("syn_get_section_access", "system");
    holdSystem = true;
    fireEvent.click(
      within(tableSection("CPU")).getByRole("button", {
        name: "Recheck access",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("synology-tab-system")).toHaveAttribute(
        "data-access-status",
        "checking",
      ),
    );
    expect(calls("syn_get_section_access", "system")).toBe(probes + 1);
    expect(notices()).toHaveLength(4);
    for (const title of UTILIZATION_TABLES) {
      expect(within(tableSection(title)).queryByRole("table")).toBeNull();
      expect(tableSection(title)).toHaveTextContent("Requires administrator");
    }
    expect(screen.queryByText(/No matching rows/)).toBeNull();
    expect(screen.getByText("DS920+")).toBeInTheDocument();
    holdSystem = false;
    await act(async () => held.splice(0).forEach((resolve) => resolve()));
    await waitFor(() =>
      expect(screen.getByTestId("synology-tab-system")).toHaveAttribute(
        "data-access-status",
        "partial",
      ),
    );
    expect(notices()).toHaveLength(4);
    expect(calls("syn_get_utilization")).toBe(0);
  });

  it("shows the signed-in user and the utilization notices on the real System tab", async () => {
    render(<SynologyPanel isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "nas.example.test" },
    });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "private-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByTestId("synology-file-station");
    expect(screen.getByTestId("synology-header-account")).toHaveTextContent(
      "Signed in as alice",
    );
    await waitFor(() =>
      expect(screen.getByTestId("synology-tab-system")).toHaveAttribute(
        "data-access-status",
        "partial",
      ),
    );
    fireEvent.click(screen.getByTestId("synology-tab-system"));
    await screen.findByText("DS920+");
    await waitFor(() => expect(notices()).toHaveLength(4));
    expect(notices()[0]).toHaveTextContent("Requires administrator");
    expect(screen.getByTestId("synology-action-reboot")).toBeEnabled();
    expect(screen.queryByTestId("synology-section-restriction")).toBeNull();
  });
});
