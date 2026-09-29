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
afterEach(cleanup);
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
});
