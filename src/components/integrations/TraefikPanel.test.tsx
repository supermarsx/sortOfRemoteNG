import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

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

import TraefikPanel, { traefikDescriptor } from "./TraefikPanel";
import { traefikApi } from "../../hooks/integration/useTraefik";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "traefik_connect":
        return Promise.resolve({
          api_url: "http://traefik.lab.local:8080",
          version: "3.0.0",
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("TraefikPanel", () => {
  it("renders the connect form when disconnected", async () => {
    render(<TraefikPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("http://traefik.lab.local:8080"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeInTheDocument();
  });

  it("connect maps to traefik_connect with a snake_case wire config", async () => {
    render(<TraefikPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("http://traefik.lab.local:8080"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(
      screen.getByPlaceholderText("http://traefik.lab.local:8080"),
      { target: { value: "http://traefik.lab.local:8080" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "traefik_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            api_url: "http://traefik.lab.local:8080",
            tls_skip_verify: false,
          }),
        }),
      ),
    );
  });

  it("exposes a well-formed web descriptor", () => {
    expect(traefikDescriptor.key).toBe("traefik");
    expect(traefikDescriptor.category).toBe("web-server");
    expect(typeof traefikDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to the correct registered command names", () => {
    traefikApi.listHttpRouters("c1");
    traefikApi.getTcpService("c1", "svc");
    traefikApi.getTlsCertificate("c1", "example.com");
    traefikApi.getOverview("c1");
    expect(invokeMock).toHaveBeenCalledWith("traefik_list_http_routers", {
      id: "c1",
    });
    expect(invokeMock).toHaveBeenCalledWith("traefik_get_tcp_service", {
      id: "c1",
      name: "svc",
    });
    expect(invokeMock).toHaveBeenCalledWith("traefik_get_tls_certificate", {
      id: "c1",
      name: "example.com",
    });
    expect(invokeMock).toHaveBeenCalledWith("traefik_get_overview", {
      id: "c1",
    });
  });
});
