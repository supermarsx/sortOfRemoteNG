import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Hoisted so the module-mock factory (hoisted above imports) can see it.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

// The config store imports `invoke` directly from @tauri-apps/api/core, so
// mocking the module intercepts read_app_data / compare_and_swap_app_data.
// also lets SecureStorage's ESM branch resolve, but we additionally route the
// legacy global path (which getInvoke checks first) to the same mock below.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

import {
  useIntegrationConfigStore,
  INTEGRATION_CONFIG_KEY,
  INTEGRATION_VAULT_SERVICE,
  resetIntegrationConfigStoreForTests,
} from "./useIntegrationConfigStore";

beforeEach(() => {
  invokeMock.mockReset();
  resetIntegrationConfigStoreForTests();
  // SecureStorage.getInvoke() checks window.__TAURI__.core.invoke first — route
  // it to the same mock so vault_* calls are captured too.
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

describe("useIntegrationConfigStore (R1: encrypted cred persistence)", () => {
  it("stores the secret in the vault and never in the config blob", async () => {
    const secret = "super-secret-token-123";
    const writes: { key: string; value: string }[] = [];
    let stored: string | null = null;

    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        switch (cmd) {
          case "read_app_data":
            return Promise.resolve(stored);
          case "compare_and_swap_app_data": {
            const request = args as {
              key: string;
              expected: string | null;
              replacement: string;
            };
            if (request.expected !== stored) return Promise.resolve(false);
            stored = request.replacement;
            writes.push({ key: request.key, value: request.replacement });
            return Promise.resolve(true);
          }
          case "vault_store_secret":
            return Promise.resolve(undefined);
          default:
            return Promise.resolve(undefined);
        }
      },
    );

    const { result } = renderHook(() => useIntegrationConfigStore());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createInstance({
        integrationKey: "netbox",
        name: "prod",
        host: "nb.example.com",
        secret,
      });
    });

    // Secret went to the OS vault under the integrations service namespace.
    expect(invokeMock).toHaveBeenCalledWith(
      "vault_store_secret",
      expect.objectContaining({ service: INTEGRATION_VAULT_SERVICE, secret }),
    );

    // The persisted config blob holds only a reference, never the secret.
    expect(writes.length).toBeGreaterThan(0);
    const lastWrite = writes[writes.length - 1];
    expect(lastWrite.key).toBe(INTEGRATION_CONFIG_KEY);
    expect(lastWrite.value).not.toContain(secret);

    const parsed = JSON.parse(lastWrite.value);
    expect(parsed[0].host).toBe("nb.example.com");
    expect(parsed[0].credentialRefId).toBeTruthy();
    expect(parsed[0].secret).toBeUndefined();
  });

  it("filters secret-shaped direct fields while retaining legitimate provider metadata", async () => {
    let stored: string | null = null;
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(stored);
        if (cmd === "compare_and_swap_app_data") {
          if (args?.expected !== stored) return Promise.resolve(false);
          stored = String(args?.replacement ?? "");
          return Promise.resolve(true);
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useIntegrationConfigStore());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createInstance({
        integrationKey: "exchange",
        name: "Exchange",
        fields: {
          environment: "hybrid",
          tenantId: "tenant-1",
          Password: "must-not-persist",
          client_secret: "must-not-persist",
          "api-key": "must-not-persist",
          authToken: "must-not-persist",
          token: "must-not-persist",
          tokenType: "Bearer",
          tokenEndpoint: "https://login.example.test/token",
        },
      });
    });

    expect(stored).not.toContain("must-not-persist");
    expect(JSON.parse(stored!)[0].fields).toEqual({
      environment: "hybrid",
      tenantId: "tenant-1",
      tokenType: "Bearer",
      tokenEndpoint: "https://login.example.test/token",
    });
  });

  it("does not rehydrate secret-shaped fields from legacy instance storage", async () => {
    const legacy = JSON.stringify([
      {
        id: "legacy-exchange",
        integrationKey: "exchange",
        name: "Legacy Exchange",
        fields: {
          environment: "hybrid",
          Password: "must-not-rehydrate",
          client_secret: "must-not-rehydrate",
          "api-key": "must-not-rehydrate",
          authToken: "must-not-rehydrate",
          token: "must-not-rehydrate",
          tokenType: "Bearer",
        },
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    ]);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_app_data") return Promise.resolve(legacy);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useIntegrationConfigStore());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.instances[0]?.fields).toEqual({
      environment: "hybrid",
      tokenType: "Bearer",
    });
  });

  it("merges adopted named vault references with newly supplied named secrets", async () => {
    let stored: string | null = null;
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(stored);
        if (cmd === "compare_and_swap_app_data") {
          const request = args as {
            expected: string | null;
            replacement: string;
          };
          if (request.expected !== stored) return Promise.resolve(false);
          stored = request.replacement;
          return Promise.resolve(true);
        }
        if (cmd === "vault_store_secret") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useIntegrationConfigStore());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let created:
      | Awaited<ReturnType<typeof result.current.createInstance>>
      | undefined;
    await act(async () => {
      created = await result.current.createInstance({
        id: "adopt-and-extend",
        integrationKey: "exchange",
        name: "Exchange",
        credentialRefIds: {
          password: "existing-password-ref",
        },
        secrets: {
          clientSecret: "new-client-secret",
        },
      });
    });

    expect(created?.credentialRefIds).toEqual({
      password: "existing-password-ref",
      clientSecret: expect.any(String),
    });
    expect(created?.credentialRefIds?.clientSecret).not.toBe(
      "existing-password-ref",
    );
    expect(stored).not.toContain("new-client-secret");
  });

  it("retires only explicitly cleared named secrets after the durable CAS", async () => {
    let stored: string | null = JSON.stringify([
      {
        id: "exchange-switch",
        integrationKey: "exchange",
        name: "Exchange",
        credentialRefIds: {
          clientSecret: "client-secret-ref",
          password: "password-ref",
        },
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    ]);
    const operationOrder: string[] = [];
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(stored);
        if (cmd === "compare_and_swap_app_data") {
          if (args?.expected !== stored) return Promise.resolve(false);
          stored = String(args?.replacement ?? "");
          operationOrder.push("cas");
          return Promise.resolve(true);
        }
        if (cmd === "vault_delete_secret") {
          operationOrder.push(`delete:${String(args?.account)}`);
          return Promise.resolve(undefined);
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useIntegrationConfigStore());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // An omitted/read-failed value is not an instruction to erase anything.
    await act(async () => {
      await result.current.updateInstance("exchange-switch", { secrets: {} });
    });
    expect(JSON.parse(stored!)[0].credentialRefIds).toEqual({
      clientSecret: "client-secret-ref",
      password: "password-ref",
    });
    expect(operationOrder).toEqual(["cas"]);

    await act(async () => {
      await result.current.updateInstance("exchange-switch", {
        secrets: { clientSecret: undefined },
      });
    });

    expect(JSON.parse(stored!)[0].credentialRefIds).toEqual({
      password: "password-ref",
    });
    expect(operationOrder).toEqual(["cas", "cas", "delete:client-secret-ref"]);
  });

  it("surfaces corrupt durable JSON instead of silently replacing it", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_app_data") return Promise.resolve("{not-json");
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useIntegrationConfigStore());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.instances).toEqual([]);
    expect(result.current.error).toContain(
      "Integration configuration is corrupted",
    );
  });

  it("rebases a CAS conflict on the newly durable instances", async () => {
    const external = {
      id: "external",
      integrationKey: "grafana",
      name: "External",
      host: "https://grafana.example",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    let stored: string | null = null;
    let casAttempts = 0;
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(stored);
        if (cmd === "compare_and_swap_app_data") {
          casAttempts += 1;
          if (casAttempts === 1) {
            stored = JSON.stringify([external]);
            return Promise.resolve(false);
          }
          const request = args as {
            expected: string | null;
            replacement: string;
          };
          if (request.expected !== stored) return Promise.resolve(false);
          stored = request.replacement;
          return Promise.resolve(true);
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useIntegrationConfigStore());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.createInstance({
        id: "local",
        integrationKey: "netbox",
        name: "Local",
      });
    });

    expect(casAttempts).toBe(2);
    expect(result.current.instances.map((instance) => instance.id)).toEqual([
      "external",
      "local",
    ]);
  });

  it("rolls back every newly written vault reference when CAS never commits", async () => {
    const storedRefs: string[] = [];
    const deletedRefs: string[] = [];
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(null);
        if (cmd === "compare_and_swap_app_data") return Promise.resolve(false);
        if (cmd === "vault_store_secret") {
          storedRefs.push(String(args?.account));
          return Promise.resolve(undefined);
        }
        if (cmd === "vault_delete_secret") {
          deletedRefs.push(String(args?.account));
          return Promise.resolve(undefined);
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useIntegrationConfigStore());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      result.current.createInstance({
        integrationKey: "netbox",
        name: "Never committed",
        secret: "temporary",
      }),
    ).rejects.toThrow("changed concurrently");

    expect(storedRefs).toHaveLength(5);
    expect(new Set(deletedRefs)).toEqual(new Set(storedRefs));
    expect(result.current.instances).toEqual([]);
  });

  it("publishes committed mutations to every mounted hook instance", async () => {
    let stored: string | null = null;
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(stored);
        if (cmd === "compare_and_swap_app_data") {
          const request = args as {
            expected: string | null;
            replacement: string;
          };
          if (request.expected !== stored) return Promise.resolve(false);
          stored = request.replacement;
          return Promise.resolve(true);
        }
        return Promise.resolve(undefined);
      },
    );

    const first = renderHook(() => useIntegrationConfigStore());
    const second = renderHook(() => useIntegrationConfigStore());
    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
      expect(second.result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await first.result.current.createInstance({
        id: "shared",
        integrationKey: "caddy",
        name: "Initial",
      });
    });
    await waitFor(() =>
      expect(second.result.current.instances[0]?.name).toBe("Initial"),
    );

    await act(async () => {
      await second.result.current.updateInstance("shared", {
        name: "Updated",
      });
    });
    await waitFor(() =>
      expect(first.result.current.instances[0]?.name).toBe("Updated"),
    );
  });
});
