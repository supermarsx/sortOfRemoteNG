import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invokeMock(command, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("./registry", () => ({ pfsenseCategoryTabs: [] }));

import PfsensePanel from "./PfsensePanel";
import {
  IntegrationSessionLifecycleProvider,
  disconnectIntegrationSession,
  reconnectIntegrationSession,
} from "../../../hooks/integrations/IntegrationSessionLifecycle";
import { resetIntegrationConfigStoreForTests } from "../../../hooks/integrations/useIntegrationConfigStore";

describe("PfsensePanel session lifecycle", () => {
  let stored: string | null;

  beforeEach(() => {
    invokeMock.mockReset();
    resetIntegrationConfigStoreForTests();
    stored = null;
    invokeMock.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "read_app_data") return Promise.resolve(stored);
        if (command === "compare_and_swap_app_data") {
          const request = args as {
            expected: string | null;
            replacement: string;
          };
          if (request.expected !== stored) return Promise.resolve(false);
          stored = request.replacement;
          return Promise.resolve(true);
        }
        if (command === "vault_store_secret") return Promise.resolve(undefined);
        if (command === "start_basic_auth_proxy") {
          return Promise.resolve({
            local_port: 43123,
            session_id: "api-proxy-session",
            proxy_url:
              "http://p0123456789abcdef0123456789abcdef.localhost:43123/",
          });
        }
        if (command === "stop_basic_auth_proxy")
          return Promise.resolve(undefined);
        if (command === "pfsense_connect") {
          return Promise.resolve({
            hostname: "fw-edge",
            version: "2.8.0",
          });
        }
        if (command === "pfsense_disconnect") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      },
    );
    (
      globalThis as unknown as {
        __TAURI__?: { core: { invoke: typeof invokeMock } };
      }
    ).__TAURI__ = { core: { invoke: invokeMock } };
  });

  it("keeps header disconnect and reconnect synchronized with the real provider handle", async () => {
    render(
      <IntegrationSessionLifecycleProvider sessionId="pfsense-session">
        <PfsensePanel isOpen onClose={() => {}} />
      </IntegrationSessionLifecycleProvider>,
    );

    fireEvent.change(await screen.findByPlaceholderText("192.168.1.1"), {
      target: { value: "fw.example.test" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "api-key" },
    });
    fireEvent.change(screen.getByLabelText("API secret"), {
      target: { value: "api-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Connect API$/i }));

    expect(
      await screen.findByRole("button", { name: /^Disconnect API$/i }),
    ).toBeVisible();
    expect(invokeMock).toHaveBeenCalledWith(
      "pfsense_connect",
      expect.objectContaining({
        id: expect.any(String),
        config: expect.objectContaining({
          host: "fw.example.test",
          internalProxyUrl:
            "http://p0123456789abcdef0123456789abcdef.localhost:43123/",
          acknowledgeInvalidCertRisk: false,
        }),
      }),
    );
    const nativeConfig = invokeMock.mock.calls.find(
      ([command]) => command === "pfsense_connect",
    )?.[1]?.config as Record<string, unknown>;
    expect(nativeConfig).not.toHaveProperty("apiKey");
    expect(nativeConfig).not.toHaveProperty("apiSecret");

    await disconnectIntegrationSession("pfsense-session");
    expect(
      await screen.findByRole("button", { name: /^Connect API$/i }),
    ).toBeVisible();
    expect(invokeMock).toHaveBeenCalledWith("pfsense_disconnect", {
      id: expect.any(String),
    });

    await expect(reconnectIntegrationSession("pfsense-session")).resolves.toBe(
      true,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Disconnect API$/i }),
      ).toBeVisible(),
    );
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "pfsense_connect",
      ),
    ).toHaveLength(2);
  });
});
