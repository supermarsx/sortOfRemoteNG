import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors IntegrationsHub.test).
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import { LxdPanel, lxdDescriptor } from "./LxdPanel";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null); // read_app_data / is_connected default
  (
    globalThis as unknown as {
      __TAURI__?: { core: { invoke: typeof invokeMock } };
    }
  ).__TAURI__ = {
    core: {
      invoke: ((cmd: string, args?: Record<string, unknown>) =>
        invokeMock(cmd, args)) as unknown as typeof invokeMock,
    },
  };
});

describe("lxdDescriptor", () => {
  it("registers under the infra category with a lazy panel import", async () => {
    expect(lxdDescriptor.key).toBe("lxd");
    expect(lxdDescriptor.category).toBe("virtualization");
    const mod = await lxdDescriptor.importPanel();
    expect(mod.default).toBeTypeOf("function");
  });
});

describe("LxdPanel shell", () => {
  it("connects via lxd_connect with the assembled config", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "lxd_connect")
        return Promise.resolve({
          connected: true,
          serverUrl: "https://10.0.0.1:8443",
          project: "default",
        });
      if (cmd === "lxd_is_connected") return Promise.resolve(false);
      return Promise.resolve(null);
    });

    render(<LxdPanel isOpen onClose={() => {}} />);

    // Default TLS auth: a trust token satisfies validation without a cert.
    // The trust-token field is the only <input type=password> in the form.
    await screen.findByText("Connect");
    const pwInput = document.querySelector('input[type="password"]');
    fireEvent.change(pwInput as Element, { target: { value: "trust-me" } });

    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "lxd_connect",
        expect.objectContaining({
          config: expect.objectContaining({
            url: "https://127.0.0.1:8443",
            trustPassword: "trust-me",
          }),
        }),
      ),
    );
  });

  it("blocks connect and shows an error when no credentials are provided", async () => {
    render(<LxdPanel isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByText("Connect"));
    expect(
      await screen.findByText(
        "Provide a client certificate/key or an OIDC token",
      ),
    ).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "lxd_connect",
      expect.anything(),
    );
  });
});
