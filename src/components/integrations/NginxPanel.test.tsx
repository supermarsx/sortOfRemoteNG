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

import NginxPanel, { nginxDescriptor } from "./NginxPanel";
import { nginxApi } from "../../hooks/integration/useNginx";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "ngx_connect":
        return Promise.resolve({
          host: "web01.lab.local",
          version: "1.24.0",
          config_path: "/etc/nginx/nginx.conf",
          worker_processes: "auto",
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("NginxPanel", () => {
  it("renders the connect form when disconnected", async () => {
    render(<NginxPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("web01.lab.local"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Connect$/i })).toBeInTheDocument();
  });

  it("connect maps to ngx_connect with a snake_case wire-shape config", async () => {
    render(<NginxPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("web01.lab.local"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("web01.lab.local"), {
      target: { value: "web01.lab.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "ngx_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "web01.lab.local",
            port: 22,
          }),
        }),
      ),
    );
  });

  it("exposes a well-formed web descriptor", () => {
    expect(nginxDescriptor.key).toBe("nginx");
    expect(nginxDescriptor.category).toBe("web-server");
    expect(typeof nginxDescriptor.importPanel).toBe("function");
  });

  it("api wrappers map to the correct registered command names + camelCase args", () => {
    nginxApi.getSslConfig("c1", "example.com");
    nginxApi.listSslCertificates("c1", "/etc/nginx/ssl");
    nginxApi.updateSnippet("c1", "gzip", "gzip on;");
    nginxApi.listLogFiles("c1", "/var/log/nginx");
    expect(invokeMock).toHaveBeenCalledWith("ngx_get_ssl_config", {
      id: "c1",
      siteName: "example.com",
    });
    expect(invokeMock).toHaveBeenCalledWith("ngx_list_ssl_certificates", {
      id: "c1",
      certDir: "/etc/nginx/ssl",
    });
    expect(invokeMock).toHaveBeenCalledWith("ngx_update_snippet", {
      id: "c1",
      name: "gzip",
      content: "gzip on;",
    });
    expect(invokeMock).toHaveBeenCalledWith("ngx_list_log_files", {
      id: "c1",
      logDir: "/var/log/nginx",
    });
  });
});
