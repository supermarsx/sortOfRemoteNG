import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TrustedScriptMark } from "../../src/components/recording/scriptTrust/TrustedScriptMark";

const SOURCE = "src/components/recording/scriptTrust/TrustedScriptMark.tsx";

describe("TrustedScriptMark", () => {
  it("says it in words, with the scope in its accessible name", () => {
    const { rerender } = render(
      <TrustedScriptMark scope="connection" name="Disk report" />,
    );
    const mark = screen.getByTestId("trusted-script-mark");
    expect(mark.textContent).toContain("Trusted");
    expect(mark.getAttribute("aria-label")).toBe(
      "Disk report: trusted on this connection",
    );
    rerender(<TrustedScriptMark scope="everywhere" name="Disk report" />);
    expect(
      screen.getByTestId("trusted-script-mark").getAttribute("aria-label"),
    ).toBe("Disk report: trusted everywhere");
  });

  it("has no revoke button without a revoke action", () => {
    render(<TrustedScriptMark scope="everywhere" name="Disk report" />);
    expect(screen.queryByTestId("trusted-script-mark-revoke")).toBeNull();
  });

  it("revokes with a real button that names the script and keeps the click from the row", async () => {
    const onRevoke = vi.fn(async () => undefined);
    const onRow = vi.fn();
    const onRowKey = vi.fn();
    render(
      <div onClick={onRow} onKeyDown={onRowKey} role="presentation">
        <TrustedScriptMark
          scope="connection"
          name="Disk report"
          onRevoke={onRevoke}
        />
      </div>,
    );
    const button = screen.getByTestId("trusted-script-mark-revoke");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe(
      "Revoke trust for Disk report",
    );
    expect(button.closest("button")).toBe(button);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onRowKey).not.toHaveBeenCalled();
  });

  it("revokes once while a revoke is in flight", async () => {
    let release!: () => void;
    const onRevoke = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <TrustedScriptMark scope="everywhere" name="Disk" onRevoke={onRevoke} />,
    );
    const button = screen.getByTestId("trusted-script-mark-revoke");
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      release();
    });
    expect(button.getAttribute("aria-disabled")).toBeNull();
  });

  it("keeps the mark usable when a revoke fails", async () => {
    const onRevoke = vi.fn(async () => {
      throw new Error("SENTINEL-SCRIPT-TEXT");
    });
    render(
      <TrustedScriptMark scope="everywhere" name="Disk" onRevoke={onRevoke} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("trusted-script-mark-revoke"));
    });
    expect(document.body.textContent).not.toContain("SENTINEL");
    expect(
      screen
        .getByTestId("trusted-script-mark-revoke")
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("uses theme tokens only, never a literal colour", () => {
    const source = readFileSync(SOURCE, "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(source).not.toMatch(
      /\b(text|bg|border)-(red|green|blue|yellow|amber|orange|gray|slate|zinc|white|black)\b/,
    );
  });
});
