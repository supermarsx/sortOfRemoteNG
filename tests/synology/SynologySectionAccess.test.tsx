import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "../../src/components/synology/synologyPanel/Sidebar";
import type { SubProps } from "../../src/components/synology/synologyPanel/types";
import type { SynologyTab } from "../../src/hooks/synology/synologyAdminData";
import type { SynologySectionAccess } from "../../src/hooks/synology/useSynologySectionAccess";
import type {
  SynologyAccessRequirement,
  SynologySectionStatus,
} from "../../src/utils/synology/synologyAccess";
import { SYNOLOGY_SECTION_LABELS } from "../../src/utils/synology/synologySectionLabels";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
afterEach(cleanup);
const entry = (
  section: SynologyTab,
  status: SynologySectionStatus | "checking",
  reason: string,
  requirement: SynologyAccessRequirement | null = null,
): SynologySectionAccess => ({
  section,
  status,
  requirement,
  reason,
  account: null,
  reads: [],
});
function manager(
  overrides: Partial<Record<SynologyTab, SynologySectionAccess>> = {},
) {
  return {
    activeTab: "fileStation",
    changeTab: vi.fn(),
    loadTabData: vi.fn(),
    disconnect: vi.fn(),
    dataLoading: false,
    lastRefreshed: null,
    sectionAccess: {
      entries: {
        ...Object.fromEntries(
          (Object.keys(SYNOLOGY_SECTION_LABELS) as SynologyTab[]).map(
            (section) => [
              section,
              entry(
                section,
                "available",
                "All data in this section was read successfully.",
              ),
            ],
          ),
        ),
        ...overrides,
      },
      account: null,
      active: true,
      checking: false,
      recheck: vi.fn(),
    },
  } as unknown as SubProps["mgr"];
}
describe("NAS sections navigation", () => {
  it("uses friendly fallback names for all eighteen sections and existing outlined accent states", () => {
    const mgr = manager();
    render(<Sidebar mgr={mgr} />);
    const nav = screen.getByRole("navigation", { name: "NAS sections" });
    for (const label of Object.values(SYNOLOGY_SECTION_LABELS))
      expect(within(nav).getByRole("button", { name: label })).toBeEnabled();
    const files = within(nav).getByRole("button", { name: "File Station" });
    expect(files).toHaveClass("sor-accent-choice");
    expect(files).toHaveAttribute("aria-current", "page");
    expect(nav).not.toHaveTextContent(/fileStation|\bvms\b/);
    fireEvent.click(
      within(nav).getByRole("button", { name: "Virtual machines" }),
    );
    expect(mgr.changeTab).toHaveBeenCalledWith("vms");
  });
  it("disables checking entries without blocking files, and lets unknown sections be attempted", () => {
    const mgr = manager({
      system: entry("system", "checking", "Checking read access…"),
      vms: entry("vms", "unknown", "Could not verify. Try or recheck."),
    });
    mgr.sectionAccess.checking = true;
    render(<Sidebar mgr={mgr} />);
    expect(screen.getByRole("button", { name: "System" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "File Station" })).toBeEnabled();
    const unknown = screen.getByRole("button", {
      name: "Virtual machines",
    });
    expect(unknown).toHaveAttribute(
      "data-tooltip",
      "Could not verify. Try or recheck.",
    );
    expect(unknown).toHaveTextContent("Could not verify");
    expect(unknown).toHaveAttribute("data-access-status", "unknown");
    fireEvent.click(unknown);
    expect(mgr.changeTab).toHaveBeenCalledWith("vms");
    expect(
      screen.getByRole("button", { name: "Recheck section access" }),
    ).toBeDisabled();
  });
  it("keeps partial sections in the main list with a warning icon and the reason as tooltip", () => {
    const reason =
      "Some data in this section needs additional DSM access; the parts you can read are shown.";
    const mgr = manager({
      system: entry("system", "partial", reason, "administrator"),
    });
    render(<Sidebar mgr={mgr} />);
    const nav = screen.getByRole("navigation", { name: "NAS sections" });
    const system = within(nav).getByRole("button", { name: "System" });
    expect(system).toBeEnabled();
    expect(system).toHaveAttribute("data-tooltip", reason);
    expect(system).toHaveAttribute("aria-description", reason);
    expect(system).toHaveTextContent("Partial access");
    expect(system.querySelector('[data-status-icon="partial"]')).toHaveClass(
      "lucide-shield-alert",
    );
    expect(
      within(nav)
        .getByRole("button", { name: "Storage" })
        .querySelector('[data-status-icon="available"]'),
    ).toHaveClass("lucide-circle-check");
    expect(
      screen.queryByTestId("synology-sections-needs-access"),
    ).not.toBeInTheDocument();
    fireEvent.click(system);
    expect(mgr.changeTab).toHaveBeenCalledWith("system");
  });
  it("groups denied sections under Needs more access with requirement titles, clickable to open the section", () => {
    const mgr = manager({
      users: entry(
        "users",
        "denied",
        "This section needs a DSM administrator account or a delegated administration role.",
        "administrator",
      ),
      security: entry(
        "security",
        "denied",
        "DSM identifies nas-admin as an administrator but limited this API session.",
        "session",
      ),
      downloads: entry(
        "downloads",
        "denied",
        "This section needs the Download Station application privilege.",
        "application_privilege",
      ),
    });
    render(<Sidebar mgr={mgr} />);
    const group = screen.getByTestId("synology-sections-needs-access");
    const summary = within(group).getByText("Needs more access (3)");
    expect(group).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(group).toHaveAttribute("open");
    const users = within(group).getByRole("button", {
      name: "Users and groups",
    });
    expect(users).toHaveTextContent("Requires administrator");
    expect(users).toHaveAttribute("data-access-status", "denied");
    expect(users).toHaveAttribute(
      "aria-description",
      "Requires administrator. This section needs a DSM administrator account or a delegated administration role.",
    );
    expect(
      within(group).getByRole("button", { name: "Security" }),
    ).toHaveTextContent("Session restricted");
    expect(
      within(group).getByRole("button", { name: "Downloads" }),
    ).toHaveTextContent("Requires application privilege");
    expect(group.querySelectorAll(".lucide-lock")).toHaveLength(3);
    // Each denied section appears once, only inside the group.
    expect(screen.getAllByTestId("synology-tab-users")).toEqual([users]);
    fireEvent.click(users);
    expect(mgr.changeTab).toHaveBeenCalledWith("users");
    expect(
      screen.queryByTestId("synology-sections-not-provided"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Unavailable sections/)).not.toBeInTheDocument();
  });
  it("groups unavailable sections under Not installed or not provided, also clickable", () => {
    const mgr = manager({
      docker: entry(
        "docker",
        "unavailable",
        "Container Manager is not installed or not running on this NAS.",
        "package",
      ),
      notifications: entry(
        "notifications",
        "unavailable",
        "This DSM version does not provide this section's API.",
        "dsm_version",
      ),
    });
    mgr.activeTab = "docker";
    render(<Sidebar mgr={mgr} />);
    const group = screen.getByTestId("synology-sections-not-provided");
    fireEvent.click(
      within(group).getByText("Not installed or not provided (2)"),
    );
    const docker = within(group).getByRole("button", { name: "Containers" });
    expect(docker).toHaveTextContent("Package not installed");
    expect(docker).toHaveAttribute("aria-current", "page");
    expect(
      within(group).getByRole("button", { name: "Notifications" }),
    ).toHaveTextContent("Not provided by this DSM");
    fireEvent.click(
      within(group).getByRole("button", { name: "Notifications" }),
    );
    expect(mgr.changeTab).toHaveBeenCalledWith("notifications");
    expect(
      within(
        screen.getByRole("navigation", { name: "NAS sections" }),
      ).getAllByRole("button"),
    ).toHaveLength(18);
  });
  it("falls back to generic titles for legacy entries without a requirement", () => {
    const mgr = manager({
      security: entry("security", "denied", "Legacy denial."),
      vms: entry("vms", "unavailable", "Legacy unavailable."),
    });
    render(<Sidebar mgr={mgr} />);
    expect(
      within(screen.getByTestId("synology-sections-needs-access")).getByRole(
        "button",
        { name: "Security" },
      ),
    ).toHaveTextContent("Access denied");
    expect(
      within(screen.getByTestId("synology-sections-not-provided")).getByRole(
        "button",
        { name: "Virtual machines" },
      ),
    ).toHaveTextContent("Not available");
  });
  it("rechecks every section from the footer button without passing the click event", () => {
    const mgr = manager();
    render(<Sidebar mgr={mgr} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Recheck section access" }),
    );
    expect(mgr.sectionAccess.recheck).toHaveBeenCalledTimes(1);
    expect(mgr.sectionAccess.recheck).toHaveBeenCalledWith();
    expect(
      screen.getByText(/Changes still require NAS permission/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("synology-account-access")).toBeInTheDocument();
  });
  it("explains paused checks and preserves existing refresh/disconnect actions", () => {
    const mgr = manager();
    mgr.sectionAccess.active = false;
    mgr.sectionAccess.checking = true;
    render(<Sidebar mgr={mgr} />);
    expect(screen.getByText(/Access checks paused/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Refresh"));
    fireEvent.click(screen.getByTitle("Disconnect"));
    expect(mgr.loadTabData).toHaveBeenCalledWith("fileStation");
    expect(mgr.disconnect).toHaveBeenCalledTimes(1);
  });
});
