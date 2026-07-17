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

import PhpPanel from "./PhpPanel";
import { phpDescriptor } from "./descriptor";
import { phpConnectionApi } from "../../../hooks/integration/php/usePhpConnection";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "write_app_data":
      case "vault_store_secret":
        return Promise.resolve(null);
      case "php_connect":
        return Promise.resolve({
          host: "server.example.com",
          default_version: "8.3",
          installed_versions: ["8.3", "8.2"],
          fpm_running: true,
          config_dir: "/etc/php",
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("PhpPanel", () => {
  it("renders the connect form when no instance is bound", async () => {
    render(<PhpPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("server.example.com"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /^Connect$/i }),
    ).toBeInTheDocument();
  });

  it("connect maps to php_connect with a snake_case SSH config", async () => {
    render(<PhpPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("server.example.com"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("server.example.com"), {
      target: { value: "server.example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("root"), {
      target: { value: "deploy" },
    });
    const pw = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(pw, { target: { value: "hunter2" } });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "php_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "server.example.com",
            ssh_user: "deploy",
            ssh_password: "hunter2",
            port: 22,
          }),
        }),
      ),
    );
  });

  it("stores the secret in the vault, never in the config blob", async () => {
    render(<PhpPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("server.example.com"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("server.example.com"), {
      target: { value: "server.example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("root"), {
      target: { value: "deploy" },
    });
    const pw = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(pw, { target: { value: "hunter2" } });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "vault_store_secret",
        expect.objectContaining({ secret: expect.stringContaining("hunter2") }),
      ),
    );
    const configWrite = invokeMock.mock.calls.find(
      (c) => c[0] === "write_app_data",
    );
    expect(configWrite?.[1]?.value).not.toContain("hunter2");
  });

  it("exposes a well-formed web descriptor", () => {
    expect(phpDescriptor.key).toBe("php");
    expect(phpDescriptor.category).toBe("web-server");
    expect(typeof phpDescriptor.importPanel).toBe("function");
  });

  it("connection api wrappers map to the correct command names", () => {
    phpConnectionApi.disconnect("inst-1");
    phpConnectionApi.listConnections();
    expect(invokeMock).toHaveBeenCalledWith("php_disconnect", { id: "inst-1" });
    expect(invokeMock).toHaveBeenCalledWith("php_list_connections", undefined);
  });
});
