import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OathTab } from "../../src/components/ssh/yubiKey/OathTab";
import type { Mgr } from "../../src/components/ssh/yubiKey/types";
import type { OathAccount, OathCode } from "../../src/types/security/yubikey";
import {
  advance,
  closingSentence,
  expiredSentence,
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
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// The start of a 30 s time step; every value below is synthetic.
const STEP = Date.parse("2026-09-11T00:00:00Z");
const account = (credential_id: string, timed: boolean): OathAccount => ({
  issuer: "Issuer",
  name: credential_id,
  oath_type: timed ? "Totp" : "Hotp",
  algorithm: "Sha1",
  digits: 6,
  period: 30,
  touch_required: false,
  credential_id,
});
const code = (value: string, timed: boolean): OathCode => ({
  code: value,
  valid_from: timed ? STEP / 1000 : 0,
  valid_to: timed ? STEP / 1000 + 30 : 0,
  touch_required: false,
});
const secrets = ["135790", "246802", "975310"];

let clipboard: SecureClipboardFake;
let logs: ReturnType<typeof watchConsole>;

function open(elapsedInStep: number) {
  vi.setSystemTime(STEP + elapsedInStep);
  const mgr = {
    selectedDevice: { serial: 1 },
    loading: false,
    oathAccounts: [
      account("alpha", true),
      account("bravo", true),
      account("counter", false),
    ],
    oathCodes: {
      alpha: code("135790", true),
      bravo: code("246802", true),
      counter: code("975310", false),
    },
    fetchOathAccounts: vi.fn(),
    oathCalculate: vi.fn(),
    oathCalculateAll: vi.fn(),
    oathDeleteAccount: vi.fn(),
    oathAddAccount: vi.fn(),
    oathSetPassword: vi.fn(),
    oathReset: vi.fn(),
  } as unknown as Mgr;
  render(<OathTab mgr={mgr} />);
}
/** The one button beside each calculated code. */
const copyButtons = () =>
  secrets.map((shown) =>
    within(screen.getByText(shown).parentElement!).getByRole("button"),
  );

describe("YubiKey OATH tab: copying a calculated code", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboard = installSecureClipboard(bridge.getInvoke);
    logs = watchConsole();
  });
  afterEach(() => {
    try {
      clipboard.expectNoRawClipboard();
      logs.expectSilentAbout(...secrets);
    } finally {
      cleanup();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("names the copy button for assistive technology", () => {
    open(10_000);
    expect(screen.getAllByRole("button", { name: "Copy code" })).toEqual(
      copyButtons(),
    );
  });

  it("copies a timed code as a one-time code that leaves the clipboard when it stops being valid", async () => {
    open(10_000);
    fireEvent.click(copyButtons()[0]);
    await settle();
    clipboard.expectOnlyCopy({
      value: "135790",
      kind: "totpCode",
      field: "totpCode",
      clearAfterSecs: 20,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("copies a counter-based code as a one-time code under the default clear policy", async () => {
    open(29_000);
    fireEvent.click(copyButtons()[2]);
    await settle();
    clipboard.expectOnlyCopy({
      value: "975310",
      kind: "totpCode",
      field: "totpCode",
    });
  });

  it("shows the tick only after the write succeeded, on that account alone, for 1.5 s", async () => {
    open(10_000);
    const write = clipboard.hold();
    fireEvent.click(copyButtons()[1]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(copyButtons().some(hasTick)).toBe(false);
    write.release();
    await settle();
    expect(copyButtons().map(hasTick)).toEqual([false, true, false]);
    await advance(1499);
    expect(copyButtons().map(hasTick)).toEqual([false, true, false]);
    await advance(1);
    expect(copyButtons().some(hasTick)).toBe(false);
  });

  it("shows why a refused write failed, with no tick and no code in the message", async () => {
    open(10_000);
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(copyButtons()[0]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(lockedSentence);
    for (const secret of secrets)
      expect(screen.getByRole("alert")).not.toHaveTextContent(secret);
    expect(copyButtons().some(hasTick)).toBe(false);
    // The next success replaces the message.
    fireEvent.click(copyButtons()[0]);
    await settle();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(copyButtons().map(hasTick)).toEqual([true, false, false]);
  });

  it("ignores every copy click while one write is pending", async () => {
    open(10_000);
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
    expect(copyButtons().map(hasTick)).toEqual([true, false, false]);
    // The tab accepts the next copy as soon as the first has settled.
    fireEvent.click(copyButtons()[1]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
    expect(copyButtons().map(hasTick)).toEqual([false, true, false]);
  });

  it("keeps a later tick for its full time when an earlier one was still showing", async () => {
    open(5_000);
    fireEvent.click(copyButtons()[0]);
    await settle();
    await advance(1000);
    fireEvent.click(copyButtons()[1]);
    await settle();
    // 1.5 s after the first copy: its timer must not clear the second tick.
    await advance(600);
    expect(copyButtons().map(hasTick)).toEqual([false, true, false]);
    await advance(900);
    expect(copyButtons().some(hasTick)).toBe(false);
  });

  it("copies a timed code with exactly 3 s of validity left", async () => {
    open(27_000);
    fireEvent.click(copyButtons()[0]);
    await settle();
    clipboard.expectOnlyCopy({
      value: "135790",
      kind: "totpCode",
      field: "totpCode",
      clearAfterSecs: 3,
    });
  });

  it("does not copy a timed code with under 3 s of validity left, and says so", async () => {
    open(27_001);
    fireEvent.click(copyButtons()[0]);
    await settle();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(closingSentence);
    expect(copyButtons().some(hasTick)).toBe(false);
  });

  it("does not copy a timed code that is no longer valid", async () => {
    open(30_200);
    fireEvent.click(copyButtons()[0]);
    await settle();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(expiredSentence);
    expect(copyButtons().some(hasTick)).toBe(false);
  });

  it("leaves no tick timer or late update behind when the tab closes mid-copy", async () => {
    open(10_000);
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
});
