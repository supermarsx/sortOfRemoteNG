import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => true,
}));

import SafeModeSection from "../../src/components/SettingsDialog/sections/behavior/SafeModeSection";
import { SafeModeBanner } from "../../src/components/app/SafeModeBanner";
import {
  __resetSafeModeForTests,
  __setSafeModeForTests,
  isSafeModeActive,
  isWorkspaceRestoreBlocked,
  loadSafeModeStatus,
  type SafeModeStatus,
} from "../../src/utils/safeMode/safeModeState";
import { schedulePreload } from "../../src/utils/perf/preloadScheduler";

const status = (over: Partial<SafeModeStatus> = {}): SafeModeStatus => ({
  active: true,
  reason: "unclean-exits",
  consecutiveUnclean: 5,
  threshold: 5,
  lastUncleanMs: [1_700_000_000_000],
  previousMarker: {
    pid: 4242,
    startedAtMs: 1_700_000_000_000,
    version: "9.9.9",
    consecutiveUnclean: 4,
  },
  startedAtMs: 1_700_000_100_000,
  startNextTime: false,
  tracking: true,
  devExempt: false,
  ...over,
});

beforeEach(() => {
  invokeMock.mockReset();
  __resetSafeModeForTests();
});
afterEach(() => __resetSafeModeForTests());

describe("safe mode state", () => {
  it("is inactive until the backend says otherwise and fails open", async () => {
    expect(isSafeModeActive()).toBe(false);
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    expect(await loadSafeModeStatus()).toBeNull();
    expect(isSafeModeActive()).toBe(false);
    invokeMock.mockResolvedValueOnce(status());
    await loadSafeModeStatus();
    expect(isSafeModeActive()).toBe(true);
    expect(isWorkspaceRestoreBlocked()).toBe(true);
  });

  it("an explicit restore unblocks only the workspace restore", () => {
    __setSafeModeForTests({ status: status() });
    __setSafeModeForTests({ restoreAllowed: true });
    expect(isWorkspaceRestoreBlocked()).toBe(false);
    expect(isSafeModeActive()).toBe(true);
  });

  it("skips preload scheduling in safe mode and schedules otherwise", () => {
    const run = vi.fn();
    __setSafeModeForTests({ status: status() });
    const cancel = schedulePreload({ id: "t:safe", priority: 3, run });
    expect(typeof cancel).toBe("function");
    expect(run).not.toHaveBeenCalled();
    __resetSafeModeForTests();
    // Outside safe mode the task is accepted by the real scheduler.
    const cancelNormal = schedulePreload({ id: "t:normal", priority: 3, run });
    cancelNormal();
  });
});

describe("SafeModeBanner", () => {
  it("renders nothing when not in safe mode", () => {
    render(<SafeModeBanner />);
    expect(screen.queryByTestId("safe-mode-banner")).toBeNull();
  });

  it("shows the message and details, and can be dismissed", () => {
    __setSafeModeForTests({ status: status() });
    render(<SafeModeBanner />);
    expect(screen.getByTestId("safe-mode-banner").textContent).toContain(
      "safeMode.banner",
    );
    expect(screen.queryByTestId("safe-mode-details-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("safe-mode-details"));
    expect(screen.getByTestId("safe-mode-details-panel").textContent).toContain(
      "safeMode.detailsMarker",
    );
    fireEvent.click(screen.getByTestId("safe-mode-stay"));
    expect(screen.queryByTestId("safe-mode-banner")).toBeNull();
    // Dismissing the banner does not leave safe mode: a chip stays behind.
    expect(isSafeModeActive()).toBe(true);
    const chip = screen.getByTestId("safe-mode-chip");
    // Details were open when dismissed; the chip toggles them.
    fireEvent.click(chip);
    expect(screen.queryByTestId("safe-mode-details-panel")).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByTestId("safe-mode-details-panel")).toBeTruthy();
  });

  it("is a single in-flow row with an upward popover, not a top banner", () => {
    __setSafeModeForTests({ status: status() });
    render(<SafeModeBanner />);
    const bar = screen.getByTestId("safe-mode-banner");
    expect(bar.className).toContain("shrink-0");
    expect(bar.className).toContain("border-t");
    expect(bar.className).not.toMatch(/(?:^|\s)(?:fixed|border-b)(?:\s|$)/);
    fireEvent.click(screen.getByTestId("safe-mode-details"));
    expect(screen.getByTestId("safe-mode-popover").className).toContain(
      "bottom-full",
    );
  });

  it("is mounted in the bottom bar stack, not at the top of App", () => {
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).not.toContain("SafeModeBanner");
    const bars = readFileSync(
      resolve(process.cwd(), "src/components/app/AppBottomBars.tsx"),
      "utf8",
    );
    expect(bars).toContain("<SafeModeBanner />");
  });

  it("restart normally calls the backend command", async () => {
    invokeMock.mockResolvedValue(undefined);
    __setSafeModeForTests({ status: status() });
    render(<SafeModeBanner />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("safe-mode-restart-normally"));
    });
    expect(invokeMock).toHaveBeenCalledWith("safe_mode_restart_normally");
  });

  it("restoring the workspace needs a confirmation", () => {
    __setSafeModeForTests({ status: status() });
    render(<SafeModeBanner />);
    fireEvent.click(screen.getByTestId("safe-mode-restore"));
    expect(isWorkspaceRestoreBlocked()).toBe(true);
    expect(screen.getByTestId("safe-mode-restore-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("safe-mode-restore-yes"));
    expect(isWorkspaceRestoreBlocked()).toBe(false);
    expect(screen.queryByTestId("safe-mode-restore")).toBeNull();
  });

  it("uses the forced-start wording", () => {
    __setSafeModeForTests({
      status: status({ reason: "forced", consecutiveUnclean: 0 }),
    });
    render(<SafeModeBanner />);
    expect(screen.getByTestId("safe-mode-banner").textContent).toContain(
      "safeMode.bannerForced",
    );
  });
});

describe("safe mode theming", () => {
  it("settings section uses the shared settings primitives", async () => {
    invokeMock.mockResolvedValue(status());
    const { container } = render(<SafeModeSection />);
    await screen.findByTestId("safe-mode-settings");
    expect(
      container.querySelector("h4.sor-settings-section-header"),
    ).not.toBeNull();
    expect(container.querySelector(".sor-settings-card")).not.toBeNull();
    expect(
      container.querySelector("input[type=number].sor-settings-input"),
    ).not.toBeNull();
    expect(
      container.querySelector("input[type=checkbox].sor-settings-checkbox"),
    ).not.toBeNull();
    expect(
      container.querySelector("button.sor-btn.sor-btn-secondary"),
    ).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}|amber|rgb\(/i);
  });

  it("banner uses themed warning tokens, not hard-coded colors", () => {
    __setSafeModeForTests({ status: status() });
    render(<SafeModeBanner />);
    const banner = screen.getByTestId("safe-mode-banner");
    expect(banner.className).toContain("border-warning");
    expect(banner.className).toContain("bg-warning");
    expect(banner.innerHTML).not.toMatch(/amber/i);
    expect(
      screen.getByTestId("safe-mode-restart-normally").className,
    ).toContain("sor-btn");
  });
});
