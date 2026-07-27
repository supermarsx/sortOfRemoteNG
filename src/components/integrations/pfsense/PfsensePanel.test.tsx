import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Hoisted so the module-mock factory (hoisted above imports) can see it.
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

import PfsensePanel from "./PfsensePanel";
import { pfsenseDescriptor } from "../descriptors";
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
  // Route SecureStorage's legacy global path to the same mock (vault_* calls).
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

describe("PfsensePanel (shell)", () => {
  it("exports an infra descriptor keyed 'pfsense'", () => {
    expect(pfsenseDescriptor.key).toBe("pfsense");
    expect(pfsenseDescriptor.category).toBe("networking");
    expect(typeof pfsenseDescriptor.importPanel).toBe("function");
  });

  it("renders the connect form", async () => {
    render(<PfsensePanel isOpen onClose={() => {}} />);
    expect(await screen.findByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("API secret")).toBeInTheDocument();
  });

  it("persists creds and maps connect to pfsense_connect", async () => {
    render(<PfsensePanel isOpen onClose={() => {}} />);
    await screen.findByText("Connect");

    fireEvent.change(screen.getByPlaceholderText("192.168.1.1"), {
      target: { value: "192.168.1.1" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "api-key" },
    });
    fireEvent.change(screen.getByLabelText("API secret"), {
      target: { value: "api-secret" },
    });
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "pfsense_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "192.168.1.1",
            apiKey: "api-key",
            apiSecret: "api-secret",
          }),
        }),
      ),
    );

    // Secret packed into the vault, config blob written reference-only.
    expect(invokeMock).toHaveBeenCalledWith(
      "vault_store_secret",
      expect.objectContaining({
        service: "com.sortofremoteng.integrations",
        secret: JSON.stringify({
          apiKey: "api-key",
          apiSecret: "api-secret",
        }),
      }),
    );
    expect(persisted).not.toBeNull();
    expect(persisted).not.toContain("api-key");
    expect(persisted).not.toContain("api-secret");
    expect(JSON.parse(persisted!)).toEqual([
      expect.objectContaining({
        integrationKey: "pfsense",
        credentialRefId: expect.any(String),
      }),
    ]);
  });
});
