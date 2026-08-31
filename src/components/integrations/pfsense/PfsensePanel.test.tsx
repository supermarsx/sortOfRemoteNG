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

import PfsensePanel from "./PfsensePanel";
import { pfsenseDescriptor } from "../descriptors";
import { resetIntegrationConfigStoreForTests } from "../../../hooks/integrations/useIntegrationConfigStore";
import { clearRuntimeConnectionsForTests } from "../../../utils/session/runtimeConnectionRegistry";

let persisted: string | null;

beforeEach(() => {
  persisted = null;
  invokeMock.mockReset();
  resetIntegrationConfigStoreForTests();
  clearRuntimeConnectionsForTests();
  invokeMock.mockImplementation(
    (command: string, args?: Record<string, unknown>) => {
      switch (command) {
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
        case "stop_basic_auth_proxy":
        case "pfsense_disconnect":
          return Promise.resolve(undefined);
        case "start_basic_auth_proxy":
          return Promise.resolve({
            local_port: 43123,
            session_id: "api-proxy-session",
            proxy_url:
              "http://p0123456789abcdef0123456789abcdef.localhost:43123/",
          });
        case "pfsense_connect":
          return Promise.resolve({
            host: "192.168.1.1",
            version: "2.7.2",
            hostname: "fw",
            platform: "amd64",
          });
        default:
          return Promise.resolve(undefined);
      }
    },
  );
  (
    globalThis as unknown as {
      __TAURI__?: { core: { invoke: typeof invokeMock } };
    }
  ).__TAURI__ = { core: { invoke: invokeMock } };
});

describe("PfsensePanel", () => {
  it("exports the descriptor and offers API plus WebGUI simultaneously", async () => {
    expect(pfsenseDescriptor.key).toBe("pfsense");
    expect(pfsenseDescriptor.category).toBe("networking");
    render(<PfsensePanel isOpen onClose={() => {}} />);

    expect(
      await screen.findByLabelText("Use REST API management"),
    ).toBeChecked();
    expect(screen.getByLabelText("Use browser WebGUI")).toBeChecked();
    expect(screen.getByRole("button", { name: "Connect API" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open WebGUI" })).toBeVisible();
  });

  it("stores named secrets and connects the API only through the internal proxy", async () => {
    render(<PfsensePanel isOpen onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Host"), {
      target: { value: "192.168.1.1" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "api-key" },
    });
    fireEvent.change(screen.getByLabelText("API secret"), {
      target: { value: "api-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect API" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "start_basic_auth_proxy",
        expect.objectContaining({
          config: expect.objectContaining({
            target_url: "https://192.168.1.1/",
            username: "api-key",
            password: "api-secret",
            upstream_auth_mode: "pfSenseV1",
          }),
        }),
      ),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "pfsense_connect",
      expect.objectContaining({
        id: expect.any(String),
        config: expect.objectContaining({
          host: "192.168.1.1",
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

    const storedSecrets = invokeMock.mock.calls
      .filter(([command]) => command === "vault_store_secret")
      .map(([, args]) => (args as { secret: string }).secret);
    expect(storedSecrets).toEqual(
      expect.arrayContaining(["api-key", "api-secret"]),
    );
    expect(persisted).not.toContain("api-key");
    expect(persisted).not.toContain("api-secret");
    expect(JSON.parse(persisted!)[0]).toEqual(
      expect.objectContaining({
        integrationKey: "pfsense",
        credentialRefIds: expect.objectContaining({
          apiKey: expect.any(String),
          apiSecret: expect.any(String),
        }),
      }),
    );
  });

  it("allows WebGUI-only auto-login without starting or connecting the API", async () => {
    const listener = vi.fn();
    window.addEventListener("open-runtime-connection", listener);
    try {
      render(<PfsensePanel isOpen onClose={() => {}} />);
      fireEvent.click(await screen.findByLabelText("Use REST API management"));
      fireEvent.change(screen.getByLabelText("Host"), {
        target: { value: "fw.example.test" },
      });
      fireEvent.change(screen.getByLabelText("WebGUI username"), {
        target: { value: "admin" },
      });
      fireEvent.change(screen.getByLabelText("WebGUI password"), {
        target: { value: "web-secret" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Open WebGUI" }));

      await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
      const connection = (listener.mock.calls[0][0] as CustomEvent).detail
        .connection;
      expect(connection).toMatchObject({
        protocol: "https",
        hostname: "fw.example.test",
        username: "admin",
        password: "web-secret",
        httpAutoLogin: true,
      });
      expect(connection.httpAutoLoginSelectors).toEqual({
        usernameSelector: "input#usernamefld",
        passwordSelector: "input#passwordfld",
        submitSelector: 'input[type="submit"][name="login"]',
      });
      expect(
        invokeMock.mock.calls.some(
          ([command]) =>
            command === "start_basic_auth_proxy" ||
            command === "pfsense_connect",
        ),
      ).toBe(false);
      expect(persisted).not.toContain("web-secret");
      expect(JSON.parse(persisted!)[0].credentialRefIds.webPassword).toEqual(
        expect.any(String),
      );
    } finally {
      window.removeEventListener("open-runtime-connection", listener);
    }
  });

  it("preserves every credential reference when vault reads fail before a WebGUI launch", async () => {
    const credentialRefIds = {
      apiKey: "api-key-ref",
      apiSecret: "api-secret-ref",
      webPassword: "web-password-ref",
    };
    persisted = JSON.stringify([
      {
        id: "fw-vault-failure-web",
        integrationKey: "pfsense",
        name: "Firewall",
        host: "fw.example.test",
        fields: {
          apiEnabled: "false",
          webEnabled: "true",
          webAutoLogin: "false",
          webUseTls: "true",
          webPort: "443",
        },
        credentialRefIds,
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T00:00:00.000Z",
      },
    ]);
    const defaultInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "vault_read_secret") {
          return Promise.reject(new Error("temporary vault lock"));
        }
        return defaultInvoke(command, args);
      },
    );

    render(
      <PfsensePanel
        isOpen
        onClose={() => {}}
        instanceId="fw-vault-failure-web"
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Host")).toHaveValue("fw.example.test"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open WebGUI" }));

    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(
          ([command]) => command === "compare_and_swap_app_data",
        ),
      ).toHaveLength(1),
    );
    expect(JSON.parse(persisted!)[0].credentialRefIds).toEqual(
      credentialRefIds,
    );
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "vault_delete_secret",
      ),
    ).toEqual([]);
  });

  it("preserves untouched API and WebGUI refs when one vault read fails before API connect", async () => {
    const credentialRefIds = {
      apiKey: "api-key-ref",
      apiSecret: "api-secret-ref",
      webPassword: "web-password-ref",
    };
    persisted = JSON.stringify([
      {
        id: "fw-vault-failure-api",
        integrationKey: "pfsense",
        name: "Firewall",
        host: "fw.example.test",
        fields: {
          apiEnabled: "true",
          apiUseTls: "true",
          apiPort: "443",
          webEnabled: "true",
          webAutoLogin: "true",
        },
        credentialRefIds,
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T00:00:00.000Z",
      },
    ]);
    const defaultInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "vault_read_secret") {
          if (args?.account === "api-key-ref") return Promise.resolve("key");
          if (args?.account === "api-secret-ref") {
            return Promise.resolve("secret");
          }
          if (args?.account === "web-password-ref") {
            return Promise.reject(new Error("temporary vault lock"));
          }
        }
        return defaultInvoke(command, args);
      },
    );

    render(
      <PfsensePanel
        isOpen
        onClose={() => {}}
        instanceId="fw-vault-failure-api"
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("API key")).toHaveValue("key"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect API" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "pfsense_connect",
        expect.anything(),
      ),
    );
    expect(JSON.parse(persisted!)[0].credentialRefIds).toEqual(
      credentialRefIds,
    );
    expect(
      invokeMock.mock.calls.filter(
        ([command]) =>
          command === "vault_store_secret" || command === "vault_delete_secret",
      ),
    ).toEqual([]);
  });

  it("commits named legacy secrets before retiring the packed primary blob", async () => {
    persisted = JSON.stringify([
      {
        id: "fw-legacy-packed",
        integrationKey: "pfsense",
        name: "Firewall",
        host: "fw.example.test",
        fields: {
          apiEnabled: "true",
          apiUseTls: "true",
          apiPort: "443",
          webEnabled: "false",
        },
        credentialRefId: "legacy-primary-ref",
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T00:00:00.000Z",
      },
    ]);
    const operationOrder: string[] = [];
    const defaultInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (
          command === "vault_read_secret" &&
          args?.account === "legacy-primary-ref"
        ) {
          return Promise.resolve(
            JSON.stringify({
              apiKey: "legacy-key",
              apiSecret: "legacy-secret",
            }),
          );
        }
        if (command === "vault_store_secret") {
          operationOrder.push(`store:${String(args?.account)}`);
        }
        if (command === "compare_and_swap_app_data") operationOrder.push("cas");
        if (command === "vault_delete_secret") {
          operationOrder.push(`delete:${String(args?.account)}`);
        }
        return defaultInvoke(command, args);
      },
    );

    render(
      <PfsensePanel isOpen onClose={() => {}} instanceId="fw-legacy-packed" />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("API key")).toHaveValue("legacy-key"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect API" }));

    await waitFor(() =>
      expect(operationOrder).toContain("delete:legacy-primary-ref"),
    );
    const durable = JSON.parse(persisted!)[0];
    expect(durable).not.toHaveProperty("credentialRefId");
    expect(durable.credentialRefIds).toEqual({
      apiKey: expect.any(String),
      apiSecret: expect.any(String),
    });
    expect(persisted).not.toContain("legacy-key");
    expect(persisted).not.toContain("legacy-secret");
    const firstCas = operationOrder.indexOf("cas");
    const finalCas = operationOrder.lastIndexOf("cas");
    const finalDelete = operationOrder.indexOf("delete:legacy-primary-ref");
    expect(firstCas).toBeGreaterThan(operationOrder.indexOf(operationOrder[0]));
    expect(finalDelete).toBeGreaterThan(finalCas);
  });
});
