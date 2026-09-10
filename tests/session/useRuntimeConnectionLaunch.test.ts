import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OPEN_RUNTIME_CONNECTION_EVENT,
  useRuntimeConnectionLaunch,
} from "../../src/hooks/session/useRuntimeConnectionLaunch";
import type { Connection } from "../../src/types/connection/connection";
import {
  clearRuntimeConnectionsForTests,
  getRuntimeWebNavigation,
  registerRuntimeConnection,
  resolveRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

const connection: Connection = {
  id: "pfsense-web-runtime",
  name: "pfSense WebGUI",
  protocol: "https",
  hostname: "firewall.example.test",
  port: 443,
  isGroup: false,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function announce(candidate: Connection, source: string): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_RUNTIME_CONNECTION_EVENT, {
      detail: { connection: candidate, source },
    }),
  );
}

describe("runtime integration connection launches", () => {
  beforeEach(() => clearRuntimeConnectionsForTests());
  afterEach(() => clearRuntimeConnectionsForTests());

  it("opens a registered pfSense WebGUI connection through the app session path", async () => {
    registerRuntimeConnection(connection);
    const openConnection = vi.fn().mockResolvedValue("session-one");
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "pfsense"));

    await waitFor(() =>
      expect(openConnection).toHaveBeenCalledWith(connection),
    );
    expect(resolveRuntimeConnection([], connection.id)).toBe(connection);
  });

  it("rejects unknown sources and unregistered or substituted connection objects", () => {
    registerRuntimeConnection(connection);
    const openConnection = vi.fn().mockResolvedValue("session-one");
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => {
      announce(connection, "unknown-provider");
      announce({ ...connection }, "pfsense");
      announce({ ...connection, id: "not-registered" }, "pfsense");
    });

    expect(openConnection).not.toHaveBeenCalled();
  });

  it("rejects a malformed runtime connection", () => {
    registerRuntimeConnection(connection);
    const openConnection = vi.fn().mockResolvedValue("session-one");
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce({ ...connection, port: 0 }, "pfsense"));

    expect(openConnection).not.toHaveBeenCalled();
  });

  it("releases an ephemeral registration when the session open is declined", async () => {
    registerRuntimeConnection(connection);
    const openConnection = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "pfsense"));

    await waitFor(() => expect(openConnection).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(resolveRuntimeConnection([], connection.id)).toBeUndefined(),
    );
  });

  it("uses the latest handler without replacing the event listener", async () => {
    registerRuntimeConnection(connection);
    const firstHandler = vi.fn().mockResolvedValue("first-session");
    const latestHandler = vi.fn().mockResolvedValue("latest-session");
    const addListener = vi.spyOn(window, "addEventListener");
    const { rerender } = renderHook(
      ({ handler }) => useRuntimeConnectionLaunch(handler),
      { initialProps: { handler: firstHandler } },
    );

    rerender({ handler: latestHandler });
    act(() => announce(connection, "pfsense"));

    await waitFor(() => expect(latestHandler).toHaveBeenCalledWith(connection));
    expect(firstHandler).not.toHaveBeenCalled();
    expect(
      addListener.mock.calls.filter(
        ([eventName]) => eventName === OPEN_RUNTIME_CONNECTION_EVENT,
      ),
    ).toHaveLength(1);
    addListener.mockRestore();
  });

  it("releases an ephemeral registration when opening throws", async () => {
    registerRuntimeConnection(connection);
    const openError = new Error("session open failed");
    const openConnection = vi.fn().mockRejectedValue(openError);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "pfsense"));

    await waitFor(() =>
      expect(resolveRuntimeConnection([], connection.id)).toBeUndefined(),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to open pfsense runtime connection:",
      openError,
    );
    consoleError.mockRestore();
  });

  it.each(["http", "https"] as const)(
    "opens a registered %s redirect with its exact live navigation guard",
    async (protocol) => {
      const redirect = {
        ...connection,
        id: `redirect-${protocol}`,
        protocol,
        port: protocol === "https" ? 443 : 80,
      };
      const assertCurrent = vi.fn();
      const navigation = {
        initialUrl: `${protocol}://${redirect.hostname}/reviewed/path?view=files`,
        redirectHops: 1,
        assertCurrent,
      };
      registerRuntimeConnection(redirect, navigation);
      const openConnection = vi.fn().mockResolvedValue("redirect-session");
      renderHook(() => useRuntimeConnectionLaunch(openConnection));

      act(() => announce(redirect, "httpRedirect"));

      await waitFor(() =>
        expect(openConnection).toHaveBeenCalledWith(redirect, assertCurrent),
      );
      expect(assertCurrent).toHaveBeenCalledOnce();
      expect(resolveRuntimeConnection([], redirect.id)).toBe(redirect);
      expect(getRuntimeWebNavigation(redirect.id)).toBe(navigation);
    },
  );

  it("rejects redirects without registration, exact object identity or navigation metadata", () => {
    const assertCurrent = vi.fn();
    const openConnection = vi.fn().mockResolvedValue("redirect-session");
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "httpRedirect"));
    registerRuntimeConnection(connection);
    act(() => announce(connection, "httpRedirect"));
    registerRuntimeConnection(connection, {
      initialUrl: "https://firewall.example.test/",
      redirectHops: 1,
      assertCurrent,
    });
    act(() => announce({ ...connection }, "httpRedirect"));

    expect(openConnection).not.toHaveBeenCalled();
    expect(assertCurrent).not.toHaveBeenCalled();
  });

  it.each(["ssh", "rdp", "vnc"] as const)(
    "rejects a registered %s connection as an HTTP redirect",
    (protocol) => {
      const redirect = { ...connection, protocol };
      const assertCurrent = vi.fn();
      registerRuntimeConnection(redirect, {
        initialUrl: "https://firewall.example.test/",
        redirectHops: 1,
        assertCurrent,
      });
      const openConnection = vi.fn().mockResolvedValue("redirect-session");
      renderHook(() => useRuntimeConnectionLaunch(openConnection));

      act(() => announce(redirect, "httpRedirect"));

      expect(openConnection).not.toHaveBeenCalled();
      expect(assertCurrent).not.toHaveBeenCalled();
    },
  );

  it("releases the connection and navigation when its redirect owner guard is stale", () => {
    const assertCurrent = vi.fn(() => {
      throw new Error("redirect owner changed");
    });
    registerRuntimeConnection(connection, {
      initialUrl: "https://firewall.example.test/",
      redirectHops: 1,
      assertCurrent,
    });
    const openConnection = vi.fn().mockResolvedValue("redirect-session");
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "httpRedirect"));

    expect(assertCurrent).toHaveBeenCalledOnce();
    expect(openConnection).not.toHaveBeenCalled();
    expect(resolveRuntimeConnection([], connection.id)).toBeUndefined();
    expect(getRuntimeWebNavigation(connection.id)).toBeUndefined();
  });

  it("forwards the guard so the canonical launcher can reject after asynchronous work", async () => {
    let current = true;
    const revoked = new Error("redirect owner changed during launch");
    const assertCurrent = vi.fn(() => {
      if (!current) throw revoked;
    });
    registerRuntimeConnection(connection, {
      initialUrl: "https://firewall.example.test/",
      redirectHops: 1,
      assertCurrent,
    });
    let finishWork!: () => void;
    const pendingWork = new Promise<void>((resolve) => {
      finishWork = resolve;
    });
    const commitSession = vi.fn();
    const openConnection = vi.fn(
      async (_candidate: Connection, launchGuard?: () => void) => {
        await pendingWork;
        launchGuard?.();
        commitSession();
        return "redirect-session";
      },
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "httpRedirect"));
    expect(openConnection).toHaveBeenCalledWith(connection, assertCurrent);
    expect(assertCurrent).toHaveBeenCalledOnce();
    current = false;
    await act(async () => finishWork());

    await waitFor(() =>
      expect(resolveRuntimeConnection([], connection.id)).toBeUndefined(),
    );
    expect(getRuntimeWebNavigation(connection.id)).toBeUndefined();
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(commitSession).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to open httpRedirect runtime connection:",
      revoked,
    );
    consoleError.mockRestore();
  });

  it("releases both redirect records when the canonical open is declined", async () => {
    registerRuntimeConnection(connection, {
      initialUrl: "https://firewall.example.test/",
      redirectHops: 1,
      assertCurrent: vi.fn(),
    });
    const openConnection = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useRuntimeConnectionLaunch(openConnection));

    act(() => announce(connection, "httpRedirect"));

    await waitFor(() => expect(openConnection).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(resolveRuntimeConnection([], connection.id)).toBeUndefined(),
    );
    expect(getRuntimeWebNavigation(connection.id)).toBeUndefined();
  });

  it.each(["nginxProxyMgr", "pfsense", "portainer", "proxmox"])(
    "preserves the one-argument %s launcher contract without a redirect guard",
    async (source) => {
      const assertCurrent = vi.fn(() => {
        throw new Error("not a redirect launch");
      });
      registerRuntimeConnection(connection, {
        initialUrl: "https://firewall.example.test/",
        redirectHops: 1,
        assertCurrent,
      });
      const openConnection = vi.fn().mockResolvedValue("existing-session");
      renderHook(() => useRuntimeConnectionLaunch(openConnection));

      act(() => announce(connection, source));

      await waitFor(() =>
        expect(openConnection).toHaveBeenCalledWith(connection),
      );
      expect(assertCurrent).not.toHaveBeenCalled();
      expect(resolveRuntimeConnection([], connection.id)).toBe(connection);
    },
  );
});
