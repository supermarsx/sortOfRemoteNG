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

import DrayTekPanel from "./DrayTekPanel";
import { draytekDescriptor } from "../descriptors";
import { integrationRegistry } from "../../../types/integrations/registry";
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
        case "draytek_connect":
          return Promise.resolve({
            host: "192.168.1.1",
            model: "Vigor2865",
            firmware: "4.4.3.1",
            hostname: "vigor-office",
          });
        case "draytek_get_status":
          return Promise.resolve({
            model: "Vigor2865",
            firmware: "4.4.3.1",
            build: "2023-10-01",
            uptime: "3 days 4:12",
            wan: [
              {
                name: "WAN1",
                status: "Up",
                ip: "203.0.113.7",
                gateway: "203.0.113.1",
                mode: "PPPoE",
                uptime: "3 days",
              },
            ],
          });
        case "draytek_reboot":
          return Promise.resolve({ accepted: true, message: "rebooting" });
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

async function fillAndConnect() {
  render(<DrayTekPanel isOpen onClose={() => {}} />);
  await screen.findByText("Connect");
  fireEvent.change(screen.getByPlaceholderText("192.168.1.1"), {
    target: { value: "192.168.1.1" },
  });
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "admin" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "s3cret" },
  });
  fireEvent.click(screen.getByText("Connect"));
  await screen.findByRole("button", { name: /^Disconnect$/i });
}

describe("DrayTekPanel (shell)", () => {
  it("exports a networking descriptor keyed 'draytek' discoverable in the registry", () => {
    expect(draytekDescriptor.key).toBe("draytek");
    expect(draytekDescriptor.category).toBe("networking");
    expect(typeof draytekDescriptor.importPanel).toBe("function");
    const found = integrationRegistry.find((d) => d.key === "draytek");
    expect(found).toBe(draytekDescriptor);
    expect(found?.category).toBe("networking");
  });

  it("renders the connect form", async () => {
    render(<DrayTekPanel isOpen onClose={() => {}} />);
    expect(await screen.findByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Username")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByText("Use TLS (HTTPS)")).toBeInTheDocument();
  });

  it("persists creds in the vault and maps connect to draytek_connect", async () => {
    await fillAndConnect();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "draytek_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "192.168.1.1",
            port: 443,
            username: "admin",
            password: "s3cret",
            use_tls: true,
            accept_invalid_certs: false,
            acknowledge_invalid_cert_risk: false,
            timeout_secs: 30,
            vendor: "draytek",
          }),
        }),
      ),
    );

    // Secret packed into the vault, config blob written reference-only (D4).
    expect(invokeMock).toHaveBeenCalledWith(
      "vault_store_secret",
      expect.objectContaining({
        service: "com.sortofremoteng.integrations",
        secret: JSON.stringify({ username: "admin", password: "s3cret" }),
      }),
    );
    expect(persisted).not.toBeNull();
    expect(persisted).not.toContain("s3cret");
    expect(JSON.parse(persisted!)).toEqual([
      expect.objectContaining({
        integrationKey: "draytek",
        credentialRefId: expect.any(String),
      }),
    ]);
  });

  it("shows the summary in the header and the Status tab from draytek_get_status", async () => {
    await fillAndConnect();

    expect(
      await screen.findByText("vigor-office · Vigor2865 · 4.4.3.1"),
    ).toBeInTheDocument();

    // Status tab is the default sub-tab; it loads on mount.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("draytek_get_status", {
        id: expect.any(String),
      }),
    );
    expect(await screen.findByText("WAN1")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.7")).toBeInTheDocument();
    expect(screen.getByText("PPPoE")).toBeInTheDocument();
    expect(screen.getByText("2023-10-01")).toBeInTheDocument();
  });

  it("reboot requires a confirm before calling draytek_reboot", async () => {
    await fillAndConnect();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));

    fireEvent.click(await screen.findByText("Reboot router"));
    expect(invokeMock).not.toHaveBeenCalledWith(
      "draytek_reboot",
      expect.anything(),
    );

    fireEvent.click(screen.getByText("Yes, reboot"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("draytek_reboot", {
        id: expect.any(String),
      }),
    );
    expect(
      await screen.findByText(/Reboot accepted by the device/),
    ).toBeInTheDocument();
  });

  it("Open Web UI opens the device admin URL through the external-open path", async () => {
    await fillAndConnect();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));

    fireEvent.click(await screen.findByText("Open Web UI"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("open_url_external", {
        url: "https://192.168.1.1/",
      }),
    );
  });

  it("disconnect maps to draytek_disconnect and returns to the form", async () => {
    await fillAndConnect();
    fireEvent.click(screen.getByRole("button", { name: /^Disconnect$/i }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("draytek_disconnect", {
        id: expect.any(String),
      }),
    );
    expect(await screen.findByText("Connect")).toBeInTheDocument();
  });
});
