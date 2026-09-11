import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RuntimeVaultTotpPanel from "../../src/components/security/RuntimeVaultTotpPanel";
import type { RuntimeVaultTotpController } from "../../src/hooks/security/useRuntimeVaultTotp";

const activity = vi.hoisted(() => ({ isActive: true }));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => activity,
}));
// Exercise the real panel and visibility hook; portal positioning is unrelated.
vi.mock("../../src/components/ui/overlays/PopoverSurface", () => ({
  PopoverSurface: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

function controller(): RuntimeVaultTotpController {
  return {
    scopeKey: "owner-a:revision-1",
    available: true,
    unavailableReason: "Unlock the owning database.",
    load: vi.fn().mockResolvedValue([
      {
        id: "vault-totp",
        label: "Vault authenticator",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      },
    ]),
    generate: vi.fn().mockImplementation(async () => ({
      code: "123456",
      expires: Date.now() + 5000,
      assertCurrent: vi.fn(),
    })),
  };
}
const anchorRef = { current: null };
const flush = async () => {
  await act(async () => {});
};

describe("RuntimeVaultTotpPanel manual disclosure", () => {
  let clipboard: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T00:00:00Z"));
    activity.isActive = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard },
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  it("loads vault metadata only, generates and copies only on explicit clicks", async () => {
    const api = controller();
    render(
      <RuntimeVaultTotpPanel
        controller={api}
        onClose={vi.fn()}
        anchorRef={anchorRef}
      />,
    );
    await flush();
    expect(api.load).toHaveBeenCalledTimes(1);
    expect(api.generate).not.toHaveBeenCalled();
    expect(clipboard).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Generated authenticator code"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Connection-local authenticators are ignored/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /^Generate\s*Vault authenticator$/ }),
    );
    await flush();
    expect(api.generate).toHaveBeenCalledExactlyOnceWith("vault-totp");
    expect(
      screen.getByLabelText("Generated authenticator code"),
    ).toHaveTextContent("123456");
    expect(clipboard).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy authenticator code" }),
    );
    await flush();
    expect(clipboard).toHaveBeenCalledExactlyOnceWith("123456");
  });

  it("expires the visible code without automatic generation or metadata polling", async () => {
    const api = controller();
    render(
      <RuntimeVaultTotpPanel
        controller={api}
        onClose={vi.fn()}
        anchorRef={anchorRef}
      />,
    );
    await flush();
    fireEvent.click(
      screen.getByRole("button", { name: /^Generate\s*Vault authenticator$/ }),
    );
    await flush();
    act(() => vi.advanceTimersByTime(5000));
    expect(
      screen.queryByLabelText("Generated authenticator code"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("expired");
    act(() => vi.advanceTimersByTime(60000));
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["hidden", "inactive", "locked"] as const)(
    "clears code and stops its timer when %s",
    async (reason) => {
      const api = controller();
      const props = { controller: api, onClose: vi.fn(), anchorRef };
      const view = render(<RuntimeVaultTotpPanel {...props} />);
      await flush();
      fireEvent.click(
        screen.getByRole("button", {
          name: /^Generate\s*Vault authenticator$/,
        }),
      );
      await flush();
      if (reason === "hidden") {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        fireEvent(document, new Event("visibilitychange"));
      } else {
        if (reason === "inactive") activity.isActive = false;
        view.rerender(
          <RuntimeVaultTotpPanel
            {...props}
            controller={{ ...api, available: reason !== "locked" }}
          />,
        );
      }
      expect(
        screen.queryByLabelText("Generated authenticator code"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: /^Generate\s*Vault authenticator$/,
        }),
      ).toBeDisabled();
      act(() => vi.advanceTimersByTime(60000));
      expect(api.load).toHaveBeenCalledTimes(1);
      expect(api.generate).toHaveBeenCalledTimes(1);
      expect(clipboard).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("guards copying again immediately instead of waiting for the expiry timer", async () => {
    const api = controller();
    let revoked = false;
    api.generate = vi.fn().mockResolvedValue({
      code: "123456",
      expires: Date.now() + 5000,
      assertCurrent: () => {
        if (revoked) throw new Error("revoked");
      },
    });
    render(
      <RuntimeVaultTotpPanel
        controller={api}
        onClose={vi.fn()}
        anchorRef={anchorRef}
      />,
    );
    await flush();
    fireEvent.click(
      screen.getByRole("button", { name: /^Generate\s*Vault authenticator$/ }),
    );
    await flush();
    revoked = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Copy authenticator code" }),
    );
    await flush();
    expect(clipboard).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Generated authenticator code"),
    ).not.toBeInTheDocument();
  });

  it.each(["scope", "close"] as const)(
    "rejects late generated results after %s and does not poll while closed",
    async (reason) => {
      const api = controller();
      let resolve!: (
        value: Awaited<ReturnType<RuntimeVaultTotpController["generate"]>>,
      ) => void;
      api.generate = vi.fn().mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const close = vi.fn();
      const view = render(
        <RuntimeVaultTotpPanel
          controller={api}
          onClose={close}
          anchorRef={anchorRef}
        />,
      );
      await flush();
      fireEvent.click(
        screen.getByRole("button", {
          name: /^Generate\s*Vault authenticator$/,
        }),
      );
      if (reason === "scope") {
        view.rerender(
          <RuntimeVaultTotpPanel
            controller={{ ...controller(), scopeKey: "owner-b:revision-2" }}
            onClose={close}
            anchorRef={anchorRef}
          />,
        );
      } else {
        fireEvent.click(
          screen.getByRole("button", { name: "Close authenticator codes" }),
        );
        expect(close).toHaveBeenCalledTimes(1);
        view.unmount();
      }
      await act(async () =>
        resolve({
          code: "654321",
          expires: Date.now() + 30000,
          assertCurrent: vi.fn(),
        }),
      );
      expect(screen.queryByText("654321")).not.toBeInTheDocument();
      view.unmount();
      act(() => vi.advanceTimersByTime(60000));
      expect(api.load).toHaveBeenCalledTimes(1);
      expect(api.generate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("keeps failures safe and never falls back to a local authenticator", async () => {
    const api = controller();
    api.load = vi.fn().mockRejectedValue(new Error("PRIVATE_SEED"));
    render(
      <RuntimeVaultTotpPanel
        controller={api}
        onClose={vi.fn()}
        anchorRef={anchorRef}
      />,
    );
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unlock the owning database",
    );
    expect(screen.queryByText(/PRIVATE_SEED/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Generate/ }),
    ).not.toBeInTheDocument();
    expect(api.generate).not.toHaveBeenCalled();
  });
});
