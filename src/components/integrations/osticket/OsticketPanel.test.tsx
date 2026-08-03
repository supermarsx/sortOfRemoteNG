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

import OsticketPanel from "./OsticketPanel";
import { osticketDescriptor } from "./descriptor";
import { osticketConnectionApi } from "../../../hooks/integration/osticket/useOsticketConnection";
import { resetIntegrationConfigStoreForTests } from "../../../hooks/integrations/useIntegrationConfigStore";

let persisted: string | null;

beforeEach(() => {
  persisted = null;
  invokeMock.mockReset();
  resetIntegrationConfigStoreForTests();
  invokeMock.mockImplementation(
    (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "read_app_data":
          return Promise.resolve(persisted);
        case "compare_and_swap_app_data": {
          const request = args as {
            expected: string | null;
            replacement: string;
          };
          if (request.expected !== persisted) return Promise.resolve(false);
          persisted = request.replacement;
          return Promise.resolve(true);
        }
        case "vault_store_secret":
        case "vault_delete_secret":
          return Promise.resolve(undefined);
        case "osticket_connect":
          return Promise.resolve({ connected: true, version: "1.18.1" });
        default:
          return Promise.resolve(null);
      }
    },
  );
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
            acknowledge_invalid_cert_risk: false,
          }),
        }),
      ),
    );
  });

  it("requires a one-shot acknowledgement before an insecure TLS attempt", async () => {
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
    fireEvent.change(container.querySelector('input[type="password"]')!, {
      target: { value: "SECRET_KEY" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Skip TLS certificate verification/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    expect(
      await screen.findByText("Insecure TLS connection"),
    ).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "osticket_connect",
      expect.anything(),
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "I understand the risks" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue insecurely" }),
    );

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "osticket_connect",
        expect.objectContaining({
          config: expect.objectContaining({
            skip_tls_verify: true,
            acknowledge_invalid_cert_risk: true,
          }),
        }),
      ),
    );
    expect(persisted).not.toContain("acknowledge_invalid_cert_risk");
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
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "compare_and_swap_app_data",
        expect.objectContaining({
          expected: null,
          replacement: expect.any(String),
        }),
      ),
    );
    expect(persisted).not.toBeNull();
    expect(persisted).not.toContain("SECRET_KEY");
    expect(JSON.parse(persisted!)).toEqual([
      expect.objectContaining({
        integrationKey: "osticket",
        credentialRefId: expect.any(String),
      }),
    ]);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "write_app_data",
      expect.anything(),
    );
  });

  it("exposes a well-formed app-service descriptor", () => {
    expect(osticketDescriptor.key).toBe("osticket");
    expect(osticketDescriptor.category).toBe("business-app");
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
