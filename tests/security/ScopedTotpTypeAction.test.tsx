import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScopedTotpTypeAction } from "../../src/components/security/ScopedTotpTypeAction";
import type { RuntimeVaultTotpController } from "../../src/hooks/security/useRuntimeVaultTotp";
import type { CredentialTypingTarget } from "../../src/utils/security/credentialTyping";
import { CredentialFailure } from "../../src/utils/security/credentialFailure";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("reviewed redirect authenticator typing", () => {
  const setup = () => {
    const value = {
      code: "123456",
      expires: Date.now() + 30000,
      assertCurrent: vi.fn(),
    };
    const controller: RuntimeVaultTotpController = {
      scopeKey: "reviewed-source",
      sourceKind: "connection",
      available: true,
      unavailableReason: "",
      load: vi.fn(),
      generate: vi.fn(async () => value),
    };
    const target: CredentialTypingTarget = {
      sessionId: "redirect-tab",
      assertCurrent: vi.fn(),
      dispose: vi.fn(),
      type: vi.fn(async (_value, check) => check()),
    };
    return { controller, target, value };
  };
  it("uses the reviewed source controller and never keeps a generated code in the UI", async () => {
    const { controller, target } = setup();
    const view = render(
      <ScopedTotpTypeAction
        controller={controller}
        target={target}
        id="opaque-local-or-vault-entry"
      />,
    );
    expect(controller.generate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Type code" })).toHaveAttribute(
      "title",
      "Type code",
    );
    expect(screen.getByRole("button", { name: "Type code" }).textContent).toBe(
      "",
    );
    fireEvent.click(screen.getByRole("button", { name: "Type code" }));
    await act(async () => {});
    expect(controller.generate).toHaveBeenCalledExactlyOnceWith(
      "opaque-local-or-vault-entry",
    );
    expect(target.type).toHaveBeenCalledExactlyOnceWith(
      "123456",
      expect.any(Function),
      expect.objectContaining({ expires: expect.any(Number) }),
    );
    expect(view.container.innerHTML).not.toContain("123456");
    expect(screen.getByRole("status")).toHaveTextContent("Code typed.");
    const status = screen.getByRole("status");
    expect(status).not.toHaveClass("absolute");
    expect(status).toHaveClass(
      "max-w-full",
      "whitespace-normal",
      "[overflow-wrap:anywhere]",
    );
    expect(status.parentElement).toHaveClass(
      "flex-col",
      "items-end",
      "max-w-32",
    );
    expect(status.previousElementSibling).toBe(
      screen.getByRole("button", { name: "Type code" }),
    );
  });
  it.each(["source", "target", "unmount", "expired", "revoked"])(
    "blocks a code after %s changes during generation",
    async (reason) => {
      const { controller, target, value } = setup();
      let finish!: (code: typeof value) => void;
      vi.mocked(controller.generate).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const view = render(
        <ScopedTotpTypeAction
          controller={controller}
          target={target}
          id="entry"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Type code" }));
      if (reason === "source")
        view.rerender(
          <ScopedTotpTypeAction
            controller={{ ...controller, scopeKey: "other" }}
            target={target}
            id="entry"
          />,
        );
      if (reason === "target")
        view.rerender(
          <ScopedTotpTypeAction
            controller={controller}
            target={null}
            id="entry"
          />,
        );
      if (reason === "unmount") view.unmount();
      if (reason === "expired") value.expires = Date.now() - 1;
      if (reason === "revoked")
        value.assertCurrent.mockImplementation(() => {
          throw new Error("revoked");
        });
      await act(async () => finish(value));
      expect(target.type).not.toHaveBeenCalled();
    },
  );
  it.each([
    [
      "a closing code window",
      "The current code is about to expire. Wait for the next code, then try again.",
    ],
    [
      "a session that refused the input",
      "The session did not accept the input. Review the field before trying again.",
    ],
    [
      "an unknown error",
      "Could not type the code. Focus the session field and reopen Credentials & 2FA.",
    ],
  ])("names %s", async (cause, sentence) => {
    const { controller, target } = setup();
    if (cause === "a closing code window")
      vi.mocked(controller.generate).mockRejectedValue(
        new CredentialFailure("code-window-closing"),
      );
    if (cause === "a session that refused the input")
      vi.mocked(target.type).mockRejectedValue(
        new CredentialFailure("typing-rejected"),
      );
    if (cause === "an unknown error")
      vi.mocked(target.type).mockRejectedValue(
        new Error("SYNTHETIC_NATIVE_DETAIL"),
      );
    const view = render(
      <ScopedTotpTypeAction controller={controller} target={target} id="e" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Type code" }));
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent(sentence);
    expect(view.container.innerHTML).not.toMatch(/SYNTHETIC|123456/);
    expect(screen.getByRole("button", { name: "Type code" })).toBeEnabled();
  });
  it("says sent, not typed, when the target only queues the input", async () => {
    const { controller, target } = setup();
    render(
      <ScopedTotpTypeAction
        controller={controller}
        target={{ ...target, confirmation: "sent" }}
        id="e"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Type code" }));
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent(
      "Code sent to the session.",
    );
  });
  it("stops waiting for a generator that never answers and lets the next action work", async () => {
    vi.useFakeTimers();
    const { controller, target, value } = setup();
    vi.mocked(controller.generate)
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue({ ...value, expires: Date.now() + 60_000 });
    render(
      <ScopedTotpTypeAction controller={controller} target={target} id="e" />,
    );
    const type = screen.getByRole("button", { name: "Type code" });
    fireEvent.click(type);
    await act(async () => {});
    expect(type).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(type).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reading the credential took too long and was stopped.",
    );
    expect(type).toBeEnabled();
    expect(target.type).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(type);
    await act(async () => {});
    expect(target.type).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Code typed.");
  });
});
