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

import NetboxPanel from "./NetboxPanel";
import { netboxDescriptor } from "./descriptor";
import { netboxTabs } from "./registry";
import {
  netboxConnectionApi,
  useNetboxConnection,
} from "../../../hooks/integration/netbox";

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

describe("netboxConnectionApi", () => {
  it("maps connect to netbox_connect with { id, config }", async () => {
    invokeMock.mockResolvedValue("conn-1");
    const config = { host: "nb.test", apiToken: "tok" };
    await netboxConnectionApi.connect("conn-1", config);
    expect(invokeMock).toHaveBeenCalledWith("netbox_connect", {
      id: "conn-1",
      config,
    });
  });

  it("maps ping/disconnect/listConnections to their commands", async () => {
    invokeMock.mockResolvedValue(undefined);
    await netboxConnectionApi.ping("c");
    await netboxConnectionApi.disconnect("c");
    await netboxConnectionApi.listConnections();
    expect(invokeMock).toHaveBeenCalledWith("netbox_ping", { id: "c" });
    expect(invokeMock).toHaveBeenCalledWith("netbox_disconnect", { id: "c" });
    expect(invokeMock).toHaveBeenCalledWith(
      "netbox_list_connections",
      undefined,
    );
  });
});

describe("useNetboxConnection", () => {
  it("connects, exposes the live id, and pulls a ping summary", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "netbox_connect") return Promise.resolve("c1");
      if (cmd === "netbox_ping")
        return Promise.resolve({ host: "nb.test", version: "3.7.0" });
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useNetboxConnection());
    await act(async () => {
      const ok = await result.current.connect("c1", {
        host: "nb.test",
        apiToken: "tok",
      });
      expect(ok).toBe(true);
    });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionId).toBe("c1");
    expect(result.current.summary?.version).toBe("3.7.0");
  });
});

describe("netboxDescriptor", () => {
  it("registers as an infra integration with a lazy panel import", async () => {
    expect(netboxDescriptor.key).toBe("netbox");
    expect(netboxDescriptor.category).toBe("infra");
    const mod = await netboxDescriptor.importPanel();
    expect(mod.default).toBeTypeOf("function");
  });

  it("starts with an empty per-crate tab registry (lead stage)", () => {
    expect(Array.isArray(netboxTabs)).toBe(true);
    expect(netboxTabs.length).toBe(0);
  });
});

describe("NetboxPanel shell", () => {
  it("connect form drives netbox_connect", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_app_data") return Promise.resolve(null);
      if (cmd === "netbox_connect") return Promise.resolve("id");
      if (cmd === "netbox_ping")
        return Promise.resolve({ host: "nb.test" });
      return Promise.resolve(undefined);
    });

    render(<NetboxPanel isOpen onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("netbox.example.com"), {
      target: { value: "nb.test" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Your NetBox API token"),
      { target: { value: "tok" } },
    );
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "netbox_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({ host: "nb.test", apiToken: "tok" }),
        }),
      ),
    );
  });
});
