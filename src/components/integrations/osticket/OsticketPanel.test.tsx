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

import OsticketPanel from "./OsticketPanel";
import { osticketDescriptor } from "./descriptor";
import { osticketConnectionApi } from "../../../hooks/integration/osticket/useOsticketConnection";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "write_app_data":
      case "vault_store_secret":
        return Promise.resolve(null);
      case "osticket_connect":
        return Promise.resolve({ connected: true, version: "1.18.1" });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("OsticketPanel", () => {
  it("renders the connect form when no instance is bound", async () => {
    render(<OsticketPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("https://helpdesk.example.com"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /^Connect$/i }),
    ).toBeInTheDocument();
  });

  it("connect maps to osticket_connect with a snake_case config", async () => {
    const { container } = render(<OsticketPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("https://helpdesk.example.com"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(
      screen.getByPlaceholderText("https://helpdesk.example.com"),
      { target: { value: "https://helpdesk.example.com" } },
    );
    const apiKey = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(apiKey, { target: { value: "SECRET_KEY" } });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "osticket_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "https://helpdesk.example.com",
            api_key: "SECRET_KEY",
            timeout_seconds: 30,
            skip_tls_verify: false,
          }),
        }),
      ),
    );
  });

  it("stores the api key in the vault, never in the config blob", async () => {
    const { container } = render(<OsticketPanel isOpen onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("https://helpdesk.example.com"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(
      screen.getByPlaceholderText("https://helpdesk.example.com"),
      { target: { value: "https://helpdesk.example.com" } },
    );
    const apiKey = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(apiKey, { target: { value: "SECRET_KEY" } });

    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "vault_store_secret",
        expect.objectContaining({
          secret: expect.stringContaining("SECRET_KEY"),
        }),
      ),
    );
    const configWrite = invokeMock.mock.calls.find(
      (c) => c[0] === "write_app_data",
    );
    expect(configWrite?.[1]?.value).not.toContain("SECRET_KEY");
  });

  it("exposes a well-formed app-service descriptor", () => {
    expect(osticketDescriptor.key).toBe("osticket");
    expect(osticketDescriptor.category).toBe("app-service");
    expect(typeof osticketDescriptor.importPanel).toBe("function");
  });

  it("connection api wrappers map to the correct command names", () => {
    osticketConnectionApi.disconnect("inst-1");
    osticketConnectionApi.ping("inst-1");
    osticketConnectionApi.listConnections();
    expect(invokeMock).toHaveBeenCalledWith("osticket_disconnect", {
      id: "inst-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("osticket_ping", { id: "inst-1" });
    expect(invokeMock).toHaveBeenCalledWith(
      "osticket_list_connections",
      undefined,
    );
  });
});
