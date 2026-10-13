import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import RDPTotpPanel from "../../src/components/rdp/RDPTotpPanel";
import type { TOTPConfig } from "../../src/types/settings/settings";
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

// The start of a 30 s time step; every value below is synthetic.
const STEP = Date.parse("2026-09-11T00:00:00Z");
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
};
const shownCodes: Record<string, string> = {
  [ALPHA.secret]: "111111",
  [BRAVO.secret]: "222222",
};
const secrets = [
  ALPHA.secret,
  BRAVO.secret,
  "111111",
  "222222",
  "BACK-ALPHA-1",
  "BACK-ALPHA-2",
];

let clipboard: SecureClipboardFake;
let logs: ReturnType<typeof watchConsole>;

async function open(elapsedInStep: number) {
  vi.setSystemTime(STEP + elapsedInStep);
  render(
    <RDPTotpPanel
      configs={[ALPHA, BRAVO]}
      onUpdate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await settle();
  expect(screen.getByText("111111")).toBeInTheDocument();
  expect(screen.getByText("222222")).toBeInTheDocument();
}
const copyCodeButtons = () =>
  screen.getAllByRole("button", { name: "Copy code" });
const exportButton = () => screen.getByTitle("Export configs to clipboard");
async function openBackupCodes() {
  fireEvent.click(screen.getAllByTitle("Backup codes")[0]);
  await settle();
  return screen.getByRole("button", { name: /Copy all/ });
}

describe("RDP 2FA panel: secret copies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboard = installSecureClipboard(bridge.getInvoke);
    logs = watchConsole();
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === "totp_compute_code"
        ? shownCodes[(args as { secret: string }).secret]
        : undefined,
    );
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

  it("copies a code as a one-time code that leaves the clipboard with its time step", async () => {
    await open(10_000);
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    clipboard.expectOnlyCopy({
      value: "111111",
      kind: "totpCode",
      field: "totpCode",
      clearAfterSecs: 20,
    });
  });

  it("shows the tick only after the write succeeded, on that code alone, for 1.5 s", async () => {
    await open(10_000);
    const write = clipboard.hold();
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(copyCodeButtons().some(hasTick)).toBe(false);
    write.release();
    await settle();
    expect(copyCodeButtons().map(hasTick)).toEqual([true, false]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await advance(1499);
    expect(copyCodeButtons().map(hasTick)).toEqual([true, false]);
    await advance(1);
    expect(copyCodeButtons().some(hasTick)).toBe(false);
  });

  it("shows why a refused write failed, with no tick and no secret in the message", async () => {
    await open(10_000);
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(lockedSentence);
    for (const secret of secrets)
      expect(screen.getByRole("alert")).not.toHaveTextContent(secret);
    expect(copyCodeButtons().some(hasTick)).toBe(false);
  });

  it("replaces an earlier failure message with the next success", async () => {
    await open(10_000);
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(copyCodeButtons()[1]);
    await settle();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(copyCodeButtons().map(hasTick)).toEqual([false, true]);
  });

  it("ignores every copy click while one write is pending", async () => {
    await open(10_000);
    const write = clipboard.hold();
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    fireEvent.click(copyCodeButtons()[0]);
    fireEvent.click(copyCodeButtons()[1]);
    fireEvent.click(exportButton());
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(clipboard.secureCopy.mock.calls[0][0].value).toBe("111111");
    write.release();
    await settle();
    // The outcome belongs to the one write that was made.
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(copyCodeButtons().map(hasTick)).toEqual([true, false]);
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    // The panel accepts the next copy as soon as the first has settled.
    fireEvent.click(copyCodeButtons()[1]);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
    expect(copyCodeButtons().map(hasTick)).toEqual([false, true]);
  });

  it("keeps a later tick for its full time when an earlier one was still showing", async () => {
    await open(5_000);
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    await advance(1000);
    fireEvent.click(copyCodeButtons()[1]);
    await settle();
    expect(copyCodeButtons().map(hasTick)).toEqual([false, true]);
    // 1.5 s after the first copy: its timer must not clear the second tick.
    await advance(600);
    expect(copyCodeButtons().map(hasTick)).toEqual([false, true]);
    await advance(900);
    expect(copyCodeButtons().some(hasTick)).toBe(false);
  });

  it("copies a code with exactly 3 s of its time step left", async () => {
    await open(27_000);
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    clipboard.expectOnlyCopy({
      value: "111111",
      kind: "totpCode",
      field: "totpCode",
      clearAfterSecs: 3,
    });
  });

  it("does not copy a code with under 3 s of its time step left, and says so", async () => {
    await open(27_001);
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(closingSentence);
    expect(copyCodeButtons().some(hasTick)).toBe(false);
  });

  it("does not copy a code that is still on screen after its time step ended", async () => {
    await open(25_000);
    // The clock passes the step boundary before the next one-second refresh.
    vi.setSystemTime(STEP + 30_200);
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(expiredSentence);
    expect(copyCodeButtons().some(hasTick)).toBe(false);
  });

  it("copies all backup codes as recovery codes and ticks only after the write", async () => {
    await open(10_000);
    const copyAll = await openBackupCodes();
    const write = clipboard.hold();
    fireEvent.click(copyAll);
    await settle();
    clipboard.expectOnlyCopy({
      value: "BACK-ALPHA-1\nBACK-ALPHA-2",
      kind: "genericSecret",
      field: "recoveryCode",
    });
    expect(hasTick(copyAll)).toBe(false);
    write.release();
    await settle();
    expect(hasTick(screen.getByRole("button", { name: /Copy all/ }))).toBe(
      true,
    );
    expect(copyCodeButtons().some(hasTick)).toBe(false);
  });

  it("shows why refused backup codes were not copied, with no tick", async () => {
    await open(10_000);
    const copyAll = await openBackupCodes();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(copyAll);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(lockedSentence);
    expect(hasTick(screen.getByRole("button", { name: /Copy all/ }))).toBe(
      false,
    );
  });

  it("copies the export, which holds every seed, as an export kept 60 s and says Copied! only after the write", async () => {
    await open(10_000);
    const write = clipboard.hold();
    fireEvent.click(exportButton());
    await settle();
    clipboard.expectOnlyCopy({
      value: JSON.stringify([ALPHA, BRAVO], null, 2),
      kind: "genericSecret",
      field: "export",
      clearAfterSecs: 60,
    });
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    write.release();
    await settle();
    expect(screen.getByText("Copied!")).toBeInTheDocument();
    await advance(1500);
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
  });

  it("shows why a refused export was not copied instead of Copied!", async () => {
    await open(10_000);
    clipboard.secureCopy.mockRejectedValueOnce("too-large");
    fireEvent.click(exportButton());
    await settle();
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nothing was copied because the value is too large for the secure clipboard.",
    );
    for (const secret of secrets)
      expect(screen.getByRole("alert")).not.toHaveTextContent(secret);
  });

  it("leaves no tick timer or late update behind when the panel closes mid-copy", async () => {
    await open(10_000);
    // A tick is showing and a second write is pending when it closes.
    fireEvent.click(copyCodeButtons()[0]);
    await settle();
    const write = clipboard.hold();
    fireEvent.click(copyCodeButtons()[1]);
    await settle();
    cleanup();
    write.release();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
});
