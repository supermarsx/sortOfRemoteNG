import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupCodesSection } from "../../src/components/connectionEditor/BackupCodesSection";
import { ToastContext } from "../../src/contexts/ToastContext";
import type { TOTPConfig } from "../../src/types/settings/settings";
import {
  advance,
  hasTick,
  installSecureClipboard,
  lockedSentence,
  settle,
  watchConsole,
  type SecureClipboardFake,
} from "./secretCopyHarness";

const bridge = vi.hoisted(() => ({ getInvoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: bridge.getInvoke,
}));

// Every value below is synthetic.
const ALPHA: TOTPConfig = {
  secret: "SEEDALPHA2345672",
  issuer: "Issuer",
  account: "alpha",
  digits: 6,
  period: 30,
  algorithm: "sha1",
  backupCodes: ["BACK-ALPHA-1", "BACK-ALPHA-2"],
};
const BRAVO: TOTPConfig = {
  secret: "SEEDBRAVO2345672",
  issuer: "Issuer",
  account: "bravo",
  digits: 6,
  period: 30,
  algorithm: "sha1",
  backupCodes: ["BACK-BRAVO-1"],
};
const secrets = [
  ALPHA.secret,
  BRAVO.secret,
  "BACK-ALPHA-1",
  "BACK-ALPHA-2",
  "BACK-BRAVO-1",
];

let clipboard: SecureClipboardFake;
let logs: ReturnType<typeof watchConsole>;
const toast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
};

function open(withToasts = true) {
  const section = (
    <BackupCodesSection
      formData={{ id: "connection", totpConfigs: [ALPHA, BRAVO] }}
      setFormData={vi.fn()}
    />
  );
  render(
    withToasts ? (
      <ToastContext.Provider value={{ toast, removeAll: vi.fn() }}>
        {section}
      </ToastContext.Provider>
    ) : (
      section
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Backup \/ Recovery Codes/ }),
  );
}
const copyButtons = () => screen.getAllByTitle("Copy all codes");

describe("connection editor recovery codes: copy all", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboard = installSecureClipboard(bridge.getInvoke);
    logs = watchConsole();
    Object.values(toast).forEach((spy) => spy.mockReset());
  });
  afterEach(() => {
    try {
      clipboard.expectNoRawClipboard();
      logs.expectSilentAbout(...secrets);
      // A copy reports through the tick or one error toast, nothing else.
      for (const level of ["success", "warning", "info", "loading"] as const)
        expect(toast[level]).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("copies one authenticator's codes as recovery codes through the secure clipboard", async () => {
    open();
    fireEvent.click(copyButtons()[0]);
    await settle();
    clipboard.expectOnlyCopy({
      value: "BACK-ALPHA-1\nBACK-ALPHA-2",
      kind: "genericSecret",
      field: "recoveryCode",
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows the tick only after the write succeeded, on that authenticator alone, for 1.5 s", async () => {
    open();
    const write = clipboard.hold();
    fireEvent.click(copyButtons()[1]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(copyButtons().some(hasTick)).toBe(false);
    write.release();
    await settle();
    expect(copyButtons().map(hasTick)).toEqual([false, true]);
    await advance(1499);
    expect(copyButtons().map(hasTick)).toEqual([false, true]);
    await advance(1);
    expect(copyButtons().some(hasTick)).toBe(false);
  });

  it("reports why a refused write failed in one error toast, with no tick", async () => {
    open();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(copyButtons()[0]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(lockedSentence);
    expect(copyButtons().some(hasTick)).toBe(false);
  });

  it("ignores every copy click while one write is pending", async () => {
    open();
    const write = clipboard.hold();
    fireEvent.click(copyButtons()[0]);
    await settle();
    fireEvent.click(copyButtons()[0]);
    fireEvent.click(copyButtons()[1]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    write.release();
    await settle();
    // The outcome belongs to the one write that was made.
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(copyButtons().map(hasTick)).toEqual([true, false]);
    expect(toast.error).not.toHaveBeenCalled();
    // The section accepts the next copy as soon as the first has settled.
    fireEvent.click(copyButtons()[1]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
    expect(clipboard.secureCopy.mock.calls[1][0].value).toBe("BACK-BRAVO-1");
    expect(copyButtons().map(hasTick)).toEqual([false, true]);
  });

  it("keeps a later tick for its full time when an earlier one was still showing", async () => {
    open();
    fireEvent.click(copyButtons()[0]);
    await settle();
    await advance(1000);
    fireEvent.click(copyButtons()[1]);
    await settle();
    // 1.5 s after the first copy: its timer must not clear the second tick.
    await advance(600);
    expect(copyButtons().map(hasTick)).toEqual([false, true]);
    await advance(900);
    expect(copyButtons().some(hasTick)).toBe(false);
  });

  it("leaves no tick timer or late update behind when the section closes mid-copy", async () => {
    open();
    // A tick is showing and a second write is pending when it closes.
    fireEvent.click(copyButtons()[0]);
    await settle();
    const write = clipboard.hold();
    fireEvent.click(copyButtons()[1]);
    await settle();
    cleanup();
    write.release();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still reports a failed write when the section was closed mid-copy", async () => {
    open();
    const write = clipboard.hold();
    fireEvent.click(copyButtons()[0]);
    await settle();
    cleanup();
    write.refuse("locked");
    await settle();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(lockedSentence);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still copies, without a toast, when no toast provider is mounted", async () => {
    open(false);
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(copyButtons()[0]);
    await settle();
    expect(copyButtons().some(hasTick)).toBe(false);
    fireEvent.click(copyButtons()[0]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
    expect(copyButtons().map(hasTick)).toEqual([true, false]);
  });
});
