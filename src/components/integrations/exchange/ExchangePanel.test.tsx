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
    const config = { environment: "online" as const, online: { tenantId: "t", clientId: "c" } };
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
    expect(exchangeDescriptor.category).toBe("app-service");
    const mod = await exchangeDescriptor.importPanel();
    expect(mod.default).toBeTypeOf("function");
  });

  it("starts with an empty per-crate tab registry (category execs append)", () => {
    expect(Array.isArray(exchangeTabs)).toBe(true);
    expect(exchangeTabs).toHaveLength(0);
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
});
