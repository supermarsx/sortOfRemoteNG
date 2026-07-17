import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  renderHook,
  act,
} from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import ExchangePanel from "./ExchangePanel";
import { exchangeDescriptor } from "./descriptor";
import { exchangeTabs } from "./registry";
import {
  exchangeConnectionApi,
  useExchangeConnection,
} from "../../../hooks/integration/exchange";

beforeEach(() => {
  invokeMock.mockReset();
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

describe("exchangeConnectionApi", () => {
  it("maps setConfig/connect to their singleton commands (no id)", async () => {
    invokeMock.mockResolvedValue(undefined);
    const config = {
      environment: "online" as const,
      online: { tenantId: "t", clientId: "c" },
    };
    await exchangeConnectionApi.setConfig(config);
    await exchangeConnectionApi.connect();
    expect(invokeMock).toHaveBeenCalledWith("exchange_set_config", { config });
    expect(invokeMock).toHaveBeenCalledWith("exchange_connect", undefined);
  });
});

describe("useExchangeConnection", () => {
  it("set_config THEN connect, then exposes the summary", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "exchange_is_connected") return Promise.resolve(false);
      if (cmd === "exchange_set_config") return Promise.resolve(undefined);
      if (cmd === "exchange_connect")
        return Promise.resolve({
          connected: true,
          environment: "online",
          exchangeVersion: "15.2",
        });
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useExchangeConnection());
    await act(async () => {
      const ok = await result.current.connect({
        environment: "online",
        online: { tenantId: "t", clientId: "c" },
      });
      expect(ok).toBe(true);
    });
    // set_config precedes connect
    const order = invokeMock.mock.calls.map((c) => c[0]);
    expect(order.indexOf("exchange_set_config")).toBeLessThan(
      order.indexOf("exchange_connect"),
    );
    expect(result.current.isConnected).toBe(true);
    expect(result.current.summary?.exchangeVersion).toBe("15.2");
  });
});

describe("exchangeDescriptor", () => {
  it("registers as an app-service integration with a lazy panel import", async () => {
    expect(exchangeDescriptor.key).toBe("exchange");
    expect(exchangeDescriptor.category).toBe("mail-server");
    const mod = await exchangeDescriptor.importPanel();
    expect(mod.default).toBeTypeOf("function");
  });

  it("registers all five category sub-tabs in display order", () => {
    expect(Array.isArray(exchangeTabs)).toBe(true);
    expect(exchangeTabs.map((t) => t.categoryKey)).toEqual([
      "recipients",
      "mailflow",
      "servers",
      "clientaccess",
      "orgsecurity",
    ]);
    for (const tab of exchangeTabs) {
      expect(tab.labelKey).toMatch(/^integrations\.exchange\./);
      expect(typeof tab.importTab).toBe("function");
    }
  });
});

describe("ExchangePanel shell", () => {
  it("online connect form drives exchange_set_config then exchange_connect", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_app_data") return Promise.resolve(null);
      if (cmd === "exchange_is_connected") return Promise.resolve(false);
      if (cmd === "exchange_connect")
        return Promise.resolve({ connected: true, environment: "online" });
      return Promise.resolve(undefined);
    });

    render(<ExchangePanel isOpen onClose={() => {}} />);

    // tenantId + organization share this placeholder; the first is tenantId.
    fireEvent.change(
      screen.getAllByPlaceholderText("contoso.onmicrosoft.com")[0],
      { target: { value: "tenant.onmicrosoft.com" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000"),
      { target: { value: "client-guid" } },
    );
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "exchange_set_config",
        expect.objectContaining({
          config: expect.objectContaining({
            environment: "online",
            online: expect.objectContaining({
              tenantId: "tenant.onmicrosoft.com",
              clientId: "client-guid",
            }),
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("exchange_connect", undefined),
    );
  });

  it("prefills from connection metadata and connects with a hybrid config", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_app_data") return Promise.resolve(null);
      if (cmd === "exchange_is_connected") return Promise.resolve(false);
      if (cmd === "exchange_connect")
        return Promise.resolve({ connected: true, environment: "hybrid" });
      return Promise.resolve(undefined);
    });

    render(
      <ExchangePanel
        isOpen
        onClose={() => {}}
        integrationSettings={{
          descriptorKey: "exchange",
          descriptorLabel: "Exchange",
          category: "app-service",
          host: "mail01.contoso.local",
          username: "admin@tenant.onmicrosoft.com",
          timeout: 180,
          providerFields: {
            environment: "hybrid",
            timeoutSecs: "180",
            tenantId: "tenant.onmicrosoft.com",
            clientId: "client-guid",
            onlineUsername: "admin@tenant.onmicrosoft.com",
            organization: "tenant.onmicrosoft.com",
            server: "mail01.contoso.local",
            port: "5986",
            onPremUsername: "CONTOSO\\administrator",
            useSsl: false,
            authMethod: "ntlm",
            skipCertCheck: true,
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("exchange-environment")).toHaveValue("hybrid"),
    );
    expect(screen.getByTestId("exchange-tenant-id")).toHaveValue(
      "tenant.onmicrosoft.com",
    );
    expect(screen.getByTestId("exchange-server")).toHaveValue(
      "mail01.contoso.local",
    );
    expect(screen.getByTestId("exchange-auth-method")).toHaveValue("ntlm");
    expect(screen.getByTestId("exchange-use-ssl")).not.toBeChecked();
    expect(screen.getByTestId("exchange-skip-cert-check")).toBeChecked();

    fireEvent.change(screen.getByTestId("exchange-client-secret"), {
      target: { value: "online-secret" },
    });
    fireEvent.change(screen.getByTestId("exchange-onprem-password"), {
      target: { value: "onprem-secret" },
    });
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "exchange_set_config",
        expect.objectContaining({
          config: expect.objectContaining({
            environment: "hybrid",
            timeoutSecs: 180,
            online: expect.objectContaining({
              tenantId: "tenant.onmicrosoft.com",
              clientId: "client-guid",
              clientSecret: "online-secret",
              username: "admin@tenant.onmicrosoft.com",
              organization: "tenant.onmicrosoft.com",
            }),
            onPrem: expect.objectContaining({
              server: "mail01.contoso.local",
              port: 5986,
              username: "CONTOSO\\administrator",
              password: "onprem-secret",
              useSsl: false,
              authMethod: "ntlm",
              skipCertCheck: true,
            }),
          }),
        }),
      ),
    );
  });

  it("saves hybrid Exchange secrets as named vault entries only", async () => {
    const writes: { key: string; value: string }[] = [];
    invokeMock.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_app_data") return Promise.resolve(null);
        if (cmd === "write_app_data") {
          writes.push(args as { key: string; value: string });
          return Promise.resolve(undefined);
        }
        if (cmd === "vault_store_secret") return Promise.resolve(undefined);
        if (cmd === "exchange_is_connected") return Promise.resolve(false);
        return Promise.resolve(undefined);
      },
    );

    render(<ExchangePanel isOpen onClose={() => {}} />);

    fireEvent.change(screen.getByTestId("exchange-environment"), {
      target: { value: "hybrid" },
    });
    fireEvent.change(screen.getByTestId("exchange-tenant-id"), {
      target: { value: "tenant.onmicrosoft.com" },
    });
    fireEvent.change(screen.getByTestId("exchange-client-id"), {
      target: { value: "client-guid" },
    });
    fireEvent.change(screen.getByTestId("exchange-client-secret"), {
      target: { value: "online-secret" },
    });
    fireEvent.change(screen.getByTestId("exchange-organization"), {
      target: { value: "tenant.onmicrosoft.com" },
    });
    fireEvent.change(screen.getByTestId("exchange-server"), {
      target: { value: "mail01.contoso.local" },
    });
    fireEvent.change(screen.getByTestId("exchange-onprem-username"), {
      target: { value: "CONTOSO\\administrator" },
    });
    fireEvent.change(screen.getByTestId("exchange-onprem-password"), {
      target: { value: "onprem-secret" },
    });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(writes.length).toBeGreaterThan(0));

    expect(invokeMock).toHaveBeenCalledWith(
      "vault_store_secret",
      expect.objectContaining({ secret: "online-secret" }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "vault_store_secret",
      expect.objectContaining({ secret: "onprem-secret" }),
    );

    const lastWrite = writes[writes.length - 1];
    expect(lastWrite.value).not.toContain("online-secret");
    expect(lastWrite.value).not.toContain("onprem-secret");

    const parsed = JSON.parse(lastWrite.value);
    expect(parsed[0]).toMatchObject({
      integrationKey: "exchange",
      host: "mail01.contoso.local",
      fields: expect.objectContaining({
        environment: "hybrid",
        tenantId: "tenant.onmicrosoft.com",
        clientId: "client-guid",
        server: "mail01.contoso.local",
        onPremUsername: "CONTOSO\\administrator",
      }),
    });
    expect(parsed[0].credentialRefIds.clientSecret).toBeTruthy();
    expect(parsed[0].credentialRefIds.onPremPassword).toBeTruthy();
    expect(parsed[0].credentialRefId).toBeUndefined();
  });
});
