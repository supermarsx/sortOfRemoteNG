import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TerminalStatusBar from "../../src/components/ssh/webTerminal/TerminalStatusBar";
import type { WebTerminalMgr } from "../../src/components/ssh/webTerminal/types";

const mocks = vi.hoisted(() => ({ stored: vi.fn(), toggleKey: vi.fn() }));
vi.mock("../../src/utils/auth/trustStore", () => ({
  getStoredIdentity: mocks.stored,
  formatFingerprint: (fingerprint: string) => fingerprint,
}));

function manager(overrides: Partial<WebTerminalMgr> = {}): WebTerminalMgr {
  return {
    isSsh: true,
    status: "connected",
    statusToneClass: "app-badge--success",
    error: null,
    session: { hostname: "ssh.example.test" },
    connection: { id: "fixture-connection", port: 22 },
    hostKeyIdentity: {
      fingerprint: "SHA256:fixture-host-key",
      keyType: "ssh-ed25519",
      keyBits: 256,
    },
    terminalRecorder: { isRecording: false, duration: 12 },
    macroRecorder: { isRecording: false, steps: [] },
    replayingMacro: false,
    formatDuration: () => "00:12",
    setShowKeyPopup: mocks.toggleKey,
    ...overrides,
  } as WebTerminalMgr;
}

beforeEach(() => {
  mocks.stored.mockReset().mockReturnValue({ userApproved: true });
  mocks.toggleKey.mockReset();
});
afterEach(cleanup);

describe("SSH session status badges", () => {
  it.each([
    ["connected", "Connected"],
    ["reconnecting", "Reconnecting"],
    ["connecting", "Connecting"],
    ["error", "Error"],
    ["idle", "Idle"],
  ] as const)(
    "preserves the %s status without the irrelevant SSH implementation label",
    (status, label) => {
      render(<TerminalStatusBar mgr={manager({ status })} />);
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.queryByText(/SSH lib|Rust/)).toBeNull();
    },
  );

  it("keeps trust, algorithm, fingerprint inspection and active recording indicators", () => {
    const mgr = manager();
    mgr.terminalRecorder.isRecording = true;
    mgr.macroRecorder.isRecording = true;
    mgr.replayingMacro = true;
    mgr.error = "Fixture reconnect warning";
    render(<TerminalStatusBar mgr={mgr} />);
    expect(screen.getByText("Fixture reconnect warning")).toBeVisible();
    expect(screen.getByText("REC 00:12")).toHaveClass(
      "app-badge--error",
      "animate-pulse",
    );
    expect(screen.getByText("MACRO (0 steps)")).toHaveClass(
      "app-badge--warning",
    );
    expect(screen.getByText("Replaying...")).toBeVisible();
    expect(screen.getByText("Trusted")).toHaveClass("app-badge--success");
    expect(screen.getByText("ssh-ed25519 (256)")).toBeVisible();
    fireEvent.click(screen.getByTitle("SHA-256: SHA256:fixture-host-key"));
    expect(mocks.toggleKey).toHaveBeenCalledOnce();
    expect(mocks.toggleKey.mock.calls[0][0](false)).toBe(true);
    expect(mocks.stored).toHaveBeenCalledWith(
      "ssh.example.test",
      22,
      "ssh",
      "fixture-connection",
    );
  });

  it.each([
    [undefined, "Unknown"],
    [{ userApproved: false }, "Remembered (TOFU)"],
  ])("keeps the existing unapproved host-key status (%s)", (stored, label) => {
    mocks.stored.mockReturnValue(stored);
    render(<TerminalStatusBar mgr={manager()} />);
    expect(screen.getByText(label as string)).toBeVisible();
  });

  it("applies the actual small-radius CSS only to SSH pills, including nested trust badges", () => {
    const css = readFileSync(
      resolve(process.cwd(), "app/styles/app-shell.css"),
      "utf8",
    );
    const globalRule = css.match(/\.app-badge\s*\{[^}]+\}/)?.[0];
    const sshRule = css.match(
      /\.ssh-terminal-status\s+\.app-badge\s*\{[^}]+\}/,
    )?.[0];
    expect(globalRule).toContain("border-radius: 999px");
    expect(sshRule).toContain("border-radius: 0.25rem");
    const styles = document.createElement("style");
    styles.textContent = `${globalRule}\n${sshRule}`;
    document.head.append(styles);
    try {
      const { container, rerender } = render(
        <TerminalStatusBar mgr={manager()} />,
      );
      const badges = container.querySelectorAll(".app-badge");
      expect(badges.length).toBe(4);
      for (const badge of badges)
        expect(getComputedStyle(badge).borderRadius).toBe("0.25rem");
      rerender(<TerminalStatusBar mgr={manager({ isSsh: false })} />);
      expect(container.querySelector(".ssh-terminal-status")).toBeNull();
      expect(getComputedStyle(screen.getByText("Connected")).borderRadius).toBe(
        "999px",
      );
      expect(screen.queryByText("Trusted")).toBeNull();
    } finally {
      styles.remove();
    }
  });
});
