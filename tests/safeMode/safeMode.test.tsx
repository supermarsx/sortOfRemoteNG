import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => true,
}));

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
    // Dismissing the banner does not leave safe mode.
    expect(isSafeModeActive()).toBe(true);
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
