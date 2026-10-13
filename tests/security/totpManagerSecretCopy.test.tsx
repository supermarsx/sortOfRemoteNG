import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TOTPManager } from "../../src/components/security/TOTPManager";
import { ToastContext } from "../../src/contexts/ToastContext";
import type { TotpEntry, TotpGeneratedCode } from "../../src/types/totp";
import {
  closingSentence,
  emptySentence,
  expiredSentence,
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
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// The start of a 30 s time step; every value below is synthetic.
const STEP = Date.parse("2026-09-11T00:00:00Z");
const entry = (id: string, secret: string, timed: boolean): TotpEntry => ({
  id,
  issuer: "Issuer",
  label: id,
  secret,
  algorithm: "SHA1",
  digits: 6,
  otp_type: timed ? "totp" : "hotp",
  period: timed ? 30 : 0,
  counter: 0,
  favourite: false,
  sort_order: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  use_count: 0,
  tags: [],
});
const TIMED = entry("timed", "SEEDTIMED2345672", true);
const COUNTER = entry("counter", "SEEDCOUNTER23456", false);
const generated = (
  entry_id: string,
  code: string,
  period: number,
): TotpGeneratedCode => ({
  code,
  remaining_seconds: period ? 20 : 0,
  period,
  progress: 0,
  counter: 0,
  entry_id,
});
const secrets = [TIMED.secret, COUNTER.secret, "123456", "654321"];

let clipboard: SecureClipboardFake;
let logs: ReturnType<typeof watchConsole>;
let codes: TotpGeneratedCode[];
const toast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
};

async function open(elapsedInStep: number) {
  vi.setSystemTime(STEP + elapsedInStep);
  render(
    <ToastContext.Provider value={{ toast, removeAll: vi.fn() }}>
      <TOTPManager isOpen onClose={vi.fn()} />
    </ToastContext.Provider>,
  );
  await settle();
  expect(screen.getByText("timed")).toBeInTheDocument();
  expect(screen.getByText("counter")).toBeInTheDocument();
}
const copyCode = (index: number) =>
  fireEvent.click(screen.getAllByTitle("Copy code")[index]);
const copySecret = (index: number) =>
  fireEvent.click(screen.getAllByTitle("Copy secret")[index]);
function expectOnlyFailureToast(sentence: string) {
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(sentence);
  for (const secret of secrets) expect(sentence).not.toContain(secret);
}

describe("TOTP authenticator dialog: secret copies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboard = installSecureClipboard(bridge.getInvoke);
    logs = watchConsole();
    Object.values(toast).forEach((spy) => spy.mockReset());
    codes = [
      generated("timed", "123456", 30),
      generated("counter", "654321", 0),
    ];
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "totp_list_entries"
        ? [TIMED, COUNTER]
        : command === "totp_generate_all_codes"
          ? codes
          : undefined,
    );
  });
  afterEach(() => {
    try {
      clipboard.expectNoRawClipboard();
      logs.expectSilentAbout(...secrets);
      // A copy reports only a failure, in one error toast.
      for (const level of ["success", "warning", "info", "loading"] as const)
        expect(toast[level]).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("copies a timed code as a one-time code that leaves the clipboard with its time step", async () => {
    await open(10_000);
    copyCode(0);
    await settle();
    clipboard.expectOnlyCopy({
      value: "123456",
      kind: "totpCode",
      field: "totpCode",
      clearAfterSecs: 20,
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("copies a counter-based code as a one-time code under the default clear policy", async () => {
    await open(27_500);
    copyCode(1);
    await settle();
    clipboard.expectOnlyCopy({
      value: "654321",
      kind: "totpCode",
      field: "totpCode",
    });
  });

  it("copies an authenticator secret as a secret, never as a one-time code", async () => {
    await open(27_500);
    copySecret(0);
    await settle();
    clipboard.expectOnlyCopy({
      value: TIMED.secret,
      kind: "genericSecret",
      field: "secret",
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("copies a secret as a secret even when it reads like a code on screen", async () => {
    // The counter-based entry's secret is the timed entry's current code.
    const lookalike = { ...COUNTER, secret: "123456" };
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "totp_list_entries"
        ? [TIMED, lookalike]
        : command === "totp_generate_all_codes"
          ? codes
          : undefined,
    );
    await open(10_000);
    copySecret(1);
    await settle();
    clipboard.expectOnlyCopy({
      value: "123456",
      kind: "genericSecret",
      field: "secret",
    });
  });

  it("reports why a refused write failed in one error toast", async () => {
    await open(10_000);
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    copySecret(0);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expectOnlyFailureToast(lockedSentence);
  });

  it("ignores every copy click while one write is pending", async () => {
    await open(10_000);
    const write = clipboard.hold();
    copyCode(0);
    await settle();
    copyCode(0);
    copySecret(0);
    copySecret(1);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(clipboard.secureCopy.mock.calls[0][0].value).toBe("123456");
    write.refuse("busy");
    await settle();
    // The outcome belongs to the one write that was made.
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expectOnlyFailureToast(
      "Nothing was copied because another program is using the clipboard. Try again in a moment.",
    );
    // The dialog accepts the next copy as soon as the first has settled.
    copySecret(1);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
    expect(clipboard.secureCopy.mock.calls[1][0]).toMatchObject({
      value: COUNTER.secret,
      field: "secret",
    });
  });

  it("copies a timed code with exactly 3 s of its time step left", async () => {
    await open(27_000);
    copyCode(0);
    await settle();
    clipboard.expectOnlyCopy({
      value: "123456",
      kind: "totpCode",
      field: "totpCode",
      clearAfterSecs: 3,
    });
  });

  it("does not copy a timed code with under 3 s of its time step left, and says so", async () => {
    await open(27_001);
    copyCode(0);
    await settle();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    expectOnlyFailureToast(closingSentence);
  });

  it("does not copy a timed code that is still on screen after its time step ended", async () => {
    await open(25_000);
    // The clock passes the step boundary before the next one-second refresh.
    vi.setSystemTime(STEP + 30_200);
    copyCode(0);
    await settle();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    expectOnlyFailureToast(expiredSentence);
  });

  it("says there is nothing to copy while no code has been generated", async () => {
    codes = [];
    await open(10_000);
    copyCode(0);
    await settle();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    expectOnlyFailureToast(emptySentence);
  });

  it("still reports a failed write when the dialog was closed mid-copy", async () => {
    await open(10_000);
    const write = clipboard.hold();
    copySecret(0);
    await settle();
    cleanup();
    write.refuse("locked");
    await settle();
    expectOnlyFailureToast(lockedSentence);
    expect(vi.getTimerCount()).toBe(0);
  });
});
