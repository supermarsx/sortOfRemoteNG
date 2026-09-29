import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCredentialTyping,
  type CaptureCredentialTarget,
} from "../../src/hooks/security/useCredentialTyping";
import {
  captureNativeCredentialTarget,
  type CredentialTypingTarget,
} from "../../src/utils/security/credentialTyping";

function Harness({
  capture,
  refresh = 0,
}: {
  capture: CaptureCredentialTarget;
  refresh?: number;
}) {
  const [open, setOpen] = useState(false);
  const typing = useCredentialTyping(open, capture);
  return (
    <>
      <div id="session">
        <input aria-label="Session input" />
      </div>
      <button
        onPointerDown={typing.onPointerDown}
        onClick={() => setOpen(!open)}
      >
        Credentials
      </button>
      {open && (
        <div ref={typing.popupRef}>
          <span>{refresh}</span>
          <button
            disabled={!typing.target}
            onClick={() => void typing.target?.type("päss!", () => {})}
          >
            Type password
          </button>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </>
  );
}
beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("popup credential target lifecycle", () => {
  it("preserves exact session focus at open, permits its popup and disables after one dispatch", async () => {
    const invoke = vi.fn(async () => {});
    const capture = vi.fn((contains: (element: Element) => boolean) =>
      captureNativeCredentialTarget(
        () => ({
          sessionId: "tab",
          backendSessionId: "native",
          shellId: "shell-exact",
          ownerDatabaseId: "owner",
          generation: 1,
          connected: true,
          protocol: "ssh",
          surface: document.querySelector("#session")!,
        }),
        contains,
        invoke,
      ),
    );
    const view = render(<Harness capture={capture} />);
    const input = screen.getByRole("textbox");
    input.focus();
    const trigger = screen.getByRole("button", { name: "Credentials" });
    fireEvent.pointerDown(trigger, { button: 0 });
    expect(document.activeElement).toBe(input);
    fireEvent.click(trigger);
    await act(async () => {});
    view.rerender(<Harness capture={capture} refresh={1} />);
    const button = screen.getByRole("button", { name: "Type password" });
    button.focus();
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await act(async () => {});
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "send_ssh_credential_input",
      {
        sessionId: "native",
        data: "päss!",
        expectedShellId: "shell-exact",
      },
    );
    expect(button).toBeDisabled();
    expect(capture).toHaveBeenCalledOnce();
    expect(view.container.innerHTML).not.toContain("päss!");
  });
  it("does not invent focus when opened by click/keyboard without a capture", () => {
    const capture = vi.fn();
    render(<Harness capture={capture} />);
    fireEvent.click(screen.getByRole("button", { name: "Credentials" }));
    expect(
      screen.getByRole("button", { name: "Type password" }),
    ).toBeDisabled();
    expect(capture).not.toHaveBeenCalled();
  });
  it.each(["close", "unmount"])(
    "disposes an asynchronous capture after %s",
    async (reason) => {
      let finish!: (target: CredentialTypingTarget) => void;
      const capture = vi.fn(
        () =>
          new Promise<CredentialTypingTarget>((resolve) => {
            finish = resolve;
          }),
      );
      const view = render(<Harness capture={capture} />);
      const trigger = screen.getByRole("button", { name: "Credentials" });
      fireEvent.pointerDown(trigger, { button: 0 });
      fireEvent.click(trigger);
      if (reason === "unmount") view.unmount();
      else fireEvent.click(screen.getByRole("button", { name: "Close" }));
      const target = {
        sessionId: "tab",
        assertCurrent: vi.fn(),
        type: vi.fn(),
        dispose: vi.fn(),
      };
      await act(async () => finish(target));
      expect(target.dispose).toHaveBeenCalledOnce();
      expect(target.type).not.toHaveBeenCalled();
    },
  );
});
