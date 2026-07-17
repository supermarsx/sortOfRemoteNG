import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import CaddyPanel, { caddyDescriptor } from "./CaddyPanel";
import { caddyApi } from "../../hooks/integration/useCaddy";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "caddy_connect":
        return Promise.resolve({
          admin_url: "http://localhost:2019",
          version: "2.8.4",
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("CaddyPanel", () => {
  it("renders the connect form when disconnected", async () => {
    render(<CaddyPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("http://localhost:2019"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeInTheDocument();
  });

  it("connect maps to caddy_connect with a snake_case wire-shape config", async () => {
    render(<CaddyPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("http://localhost:2019"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("http://localhost:2019"), {
      target: { value: "http://caddy.lab.local:2019" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "caddy_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            admin_url: "http://caddy.lab.local:2019",
            tls_skip_verify: false,
          }),
        }),
      ),
    );
  });

  it("exposes a well-formed web-category descriptor", () => {
    expect(caddyDescriptor.key).toBe("caddy");
    expect(caddyDescriptor.category).toBe("web-server");
    expect(typeof caddyDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to the correct registered command names + camelCase args", () => {
    caddyApi.getConfigPath("c1", "apps/http");
    caddyApi.setRoute("c1", "srv0", 2, { handle: [] });
    caddyApi.setAutomateDomains("c1", ["example.com"]);
    expect(invokeMock).toHaveBeenCalledWith("caddy_get_config_path", {
      id: "c1",
      path: "apps/http",
    });
    expect(invokeMock).toHaveBeenCalledWith("caddy_set_route", {
      id: "c1",
      server: "srv0",
      index: 2,
      route: { handle: [] },
    });
    expect(invokeMock).toHaveBeenCalledWith("caddy_set_automate_domains", {
      id: "c1",
      domains: ["example.com"],
    });
  });
});
