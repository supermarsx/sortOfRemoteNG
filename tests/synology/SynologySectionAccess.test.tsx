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
import { SYNOLOGY_SECTION_LABELS } from "../../src/utils/synology/synologySectionLabels";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
afterEach(cleanup);
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
          Object.keys(SYNOLOGY_SECTION_LABELS).map((section) => [
            section,
            {
              section,
              status: "available",
              reason:
                "Primary read verified. Changes still require permission.",
            },
          ]),
        ),
        ...overrides,
      },
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
      system: {
        section: "system",
        status: "checking",
        reason: "Checking read access…",
      },
      vms: {
        section: "vms",
        status: "unknown",
        reason: "Could not verify. Try or recheck.",
      },
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
    fireEvent.click(unknown);
    expect(mgr.changeTab).toHaveBeenCalledWith("vms");
    expect(
      screen.getByRole("button", { name: "Recheck section access" }),
    ).toBeDisabled();
  });
  it("collapses denied and unavailable sections with distinct explanations, never a fake empty menu", () => {
    const mgr = manager({
      security: {
        section: "security",
        status: "denied",
        reason: "This account cannot read security settings.",
      },
      docker: {
        section: "docker",
        status: "unavailable",
        reason: "Container Manager is not installed.",
      },
    });
    render(<Sidebar mgr={mgr} />);
    const summary = screen.getByText("Unavailable sections (2)");
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(
      screen.queryByRole("button", { name: "Security" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Containers" }),
    ).not.toBeInTheDocument();
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(
      within(details).getByText(/Access denied. This account/),
    ).toBeInTheDocument();
    expect(
      within(details).getByText(/Not available. Container Manager/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Recheck section access" }),
    );
    expect(mgr.sectionAccess.recheck).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Changes still require NAS permission/),
    ).toBeInTheDocument();
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
