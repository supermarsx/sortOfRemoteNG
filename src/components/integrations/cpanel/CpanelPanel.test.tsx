import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";

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

import CpanelPanel from "./CpanelPanel";
import { cpanelDescriptor } from "./descriptor";
import { cpanelConnectionApi } from "../../../hooks/integration/cpanel/useCpanelConnection";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "write_app_data":
      case "vault_store_secret":
        return Promise.resolve(null);
      case "cpanel_connect":
        return Promise.resolve({
          host: "server.example.com",
          hostname: "server.example.com",
          version: "118.0",
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("CpanelPanel", () => {
  it("renders the connect form when no instance is bound", async () => {
    render(<CpanelPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("server.example.com"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Connect/i }),
    ).toBeInTheDocument();
  });

  it("connect maps to cpanel_connect with a snake_case config", async () => {
    const { container } = render(<CpanelPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("server.example.com"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("server.example.com"), {
      target: { value: "server.example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("root"), {
      target: { value: "root" },
    });
    const pw = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(pw, { target: { value: "hunter2" } });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "cpanel_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "server.example.com",
            username: "root",
            password: "hunter2",
            auth_mode: "password",
            whm_port: 2087,
            cpanel_port: 2083,
            use_tls: true,
          }),
        }),
      ),
    );
  });

  it("stores the secret in the vault, never in the config blob", async () => {
    const { container } = render(<CpanelPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("server.example.com"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("server.example.com"), {
      target: { value: "server.example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("root"), {
      target: { value: "root" },
    });
    const pw = container.querySelector(
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

  it("exposes a well-formed infra descriptor", () => {
    expect(cpanelDescriptor.key).toBe("cpanel");
    expect(cpanelDescriptor.category).toBe("management");
    expect(typeof cpanelDescriptor.importPanel).toBe("function");
  });

  it("connection api wrappers map to the correct command names", () => {
    cpanelConnectionApi.disconnect("inst-1");
    cpanelConnectionApi.ping("inst-1");
    cpanelConnectionApi.listConnections();
    expect(invokeMock).toHaveBeenCalledWith("cpanel_disconnect", {
      id: "inst-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("cpanel_ping", { id: "inst-1" });
    expect(invokeMock).toHaveBeenCalledWith("cpanel_list_connections", undefined);
  });
});
