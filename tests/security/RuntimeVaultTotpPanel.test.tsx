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

  it.each(["vault", "connection"] as const)(
    "labels %s panels according to credential actions",
    async (sourceKind) => {
      const props = {
        controller: { ...controller(), sourceKind },
        onClose: vi.fn(),
        anchorRef,
      };
      const view = render(<RuntimeVaultTotpPanel {...props} />);
      await flush();
      expect(
        screen.getByRole("heading", {
          name: `${sourceKind === "vault" ? "Vault" : "Connection"} authenticator codes`,
        }),
      ).toBeInTheDocument();
      view.rerender(
        <RuntimeVaultTotpPanel
          {...props}
          credentialActions={<button>Copy username</button>}
        />,
      );
      expect(
        screen.getByRole("region", { name: "Credentials & 2FA" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Credentials & 2FA" }),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Close Credentials & 2FA" }),
      );
      expect(props.onClose).toHaveBeenCalledOnce();
    },
  );

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
      screen.getByRole("button", { name: "Copy code Vault authenticator (1)" }),
    ).toBeEnabled();
    expect(
      screen.queryByLabelText("Generated authenticator code"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Connection-local authenticators are ignored/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy code Vault authenticator (1)" }),
    );
    await flush();
    expect(api.generate).toHaveBeenCalledExactlyOnceWith("vault-totp");
    expect(
      screen.getByLabelText("Generated authenticator code"),
    ).toHaveTextContent("123456");
    expect(clipboard).toHaveBeenCalledExactlyOnceWith("123456");
    const copy = screen.getByRole("button", {
      name: "Copy code Vault authenticator (1)",
    });
    expect(copy).toHaveAttribute("title", "Copy code Vault authenticator (1)");
    expect(copy.textContent).toBe("");
    expect(
      screen.queryByRole("button", { name: /^Generate/ }),
    ).not.toBeInTheDocument();
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
      screen.getByRole("button", { name: "Copy code Vault authenticator (1)" }),
    );
    await flush();
    act(() => vi.advanceTimersByTime(5000));
    expect(
      screen.queryByLabelText("Generated authenticator code"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("expired");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Copy or type a fresh code.",
    );
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
          name: "Copy code Vault authenticator (1)",
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
          name: "Copy code Vault authenticator (1)",
        }),
      ).toBeDisabled();
      act(() => vi.advanceTimersByTime(60000));
      expect(api.load).toHaveBeenCalledTimes(1);
      expect(api.generate).toHaveBeenCalledTimes(1);
      expect(clipboard).toHaveBeenCalledExactlyOnceWith("123456");
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
      screen.getByRole("button", { name: "Copy code Vault authenticator (1)" }),
    );
    await flush();
    clipboard.mockClear();
    revoked = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Copy code Vault authenticator (1)" }),
    );
    await flush();
    expect(clipboard).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Generated authenticator code"),
    ).not.toBeInTheDocument();
  });

  it.each([
    "scope",
    "close",
    "hidden",
    "inactive",
    "locked",
    "expired",
    "revoked",
  ] as const)(
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
          name: "Copy code Vault authenticator (1)",
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
      } else if (reason === "close") {
        fireEvent.click(
          screen.getByRole("button", { name: "Close authenticator codes" }),
        );
        expect(close).toHaveBeenCalledTimes(1);
        view.unmount();
      } else if (reason === "hidden") {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
      } else if (reason === "inactive" || reason === "locked") {
        activity.isActive = reason !== "inactive";
        view.rerender(
          <RuntimeVaultTotpPanel
            controller={{ ...api, available: reason !== "locked" }}
            onClose={close}
            anchorRef={anchorRef}
          />,
        );
      }
      await act(async () =>
        resolve({
          code: "654321",
          expires: Date.now() + (reason === "expired" ? -1 : 30000),
          assertCurrent: () => {
            if (reason === "revoked") throw new Error("revoked");
          },
        }),
      );
      expect(screen.queryByText("654321")).not.toBeInTheDocument();
      expect(clipboard).not.toHaveBeenCalled();
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
      screen.queryByRole("button", { name: /^Copy code/ }),
    ).not.toBeInTheDocument();
    expect(api.generate).not.toHaveBeenCalled();
  });

  it("names duplicate entries uniquely and copies only the selected entry on each click", async () => {
    const api = controller();
    const entries = await api.load();
    vi.mocked(api.load).mockResolvedValue([
      entries[0],
      { ...entries[0], id: "second" },
    ]);
    render(
      <RuntimeVaultTotpPanel
        controller={api}
        onClose={vi.fn()}
        anchorRef={anchorRef}
        renderTypeCode={(id) => <button aria-label={`Type ${id}`} />}
      />,
    );
    await flush();
    expect(api.generate).not.toHaveBeenCalled();
    const first = screen.getByRole("button", {
      name: "Copy code Vault authenticator (1)",
    });
    const second = screen.getByRole("button", {
      name: "Copy code Vault authenticator (2)",
    });
    expect(first.title).not.toBe(second.title);
    expect(second.parentElement?.querySelectorAll("button")).toHaveLength(2);
    fireEvent.click(second);
    await flush();
    expect(api.generate).toHaveBeenLastCalledWith("second");
    expect(clipboard).toHaveBeenCalledExactlyOnceWith("123456");
    expect(second.parentElement?.parentElement).toContainElement(
      screen.getByLabelText("Generated authenticator code"),
    );
    fireEvent.click(first);
    await flush();
    expect(api.generate).toHaveBeenLastCalledWith("vault-totp");
    expect(api.generate).toHaveBeenCalledTimes(2);
    expect(clipboard).toHaveBeenCalledTimes(2);
  });
});
