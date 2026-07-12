import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  renderHook,
  act,
} from "@testing-library/react";

// Hoisted so the module-mock factory (hoisted above imports) can see it.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

// The config store imports `invoke` directly from @tauri-apps/api/core, so
// mocking the module intercepts read_app_data / write_app_data. `isTauri: true`
// also lets SecureStorage's ESM branch resolve, but we additionally route the
// legacy global path (which getInvoke checks first) to the same mock below.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import { IntegrationsHub } from "./IntegrationsHub";
import {
  useIntegrationConfigStore,
  INTEGRATION_CONFIG_KEY,
  INTEGRATION_VAULT_SERVICE,
} from "../../hooks/integrations/useIntegrationConfigStore";
import {
  createToolSession,
  TOOL_LABELS,
  getToolKeyFromProtocol,
} from "../app/toolSession";
import { integrationRegistry } from "../../types/integrations/registry";

beforeEach(() => {
  invokeMock.mockReset();
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

describe("IntegrationsHub", () => {
  it("renders registered integrations from the registry", async () => {
    // Wave-0 shipped an empty registry; Wave 1+ populates it. This asserts the
    // hub renders whatever is registered (generic — not coupled to any one
    // integration) rather than the empty state.
    expect(integrationRegistry.length).toBeGreaterThan(0);
    invokeMock.mockResolvedValue(null); // read_app_data -> no instances

    render(<IntegrationsHub isOpen onClose={() => {}} />);

    await waitFor(() =>
      expect(
        screen.queryByTestId("integrations-empty"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getAllByTestId(/^integration-card-/).length,
    ).toBeGreaterThan(0);
  });

  it("is wired as a Tool-surface tab", () => {
    const session = createToolSession("integrations");
    expect(session.protocol).toBe("tool:integrations");
    expect(getToolKeyFromProtocol(session.protocol)).toBe("integrations");
    expect(TOOL_LABELS.integrations).toBe("Integrations");
  });
});

describe("useIntegrationConfigStore (R1: encrypted cred persistence)", () => {
  it("stores the secret in the vault and never in the config blob", async () => {
    const secret = "super-secret-token-123";
    const writes: { key: string; value: string }[] = [];

    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        switch (cmd) {
          case "read_app_data":
            return Promise.resolve(null);
          case "write_app_data":
            writes.push(args as { key: string; value: string });
            return Promise.resolve(undefined);
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
});
