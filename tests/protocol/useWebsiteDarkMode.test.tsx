import React, { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type { WebAutomationBridge } from "../../src/utils/recording/webAutomationBridge";
import type { WebAutomationDocument } from "../../src/types/recording/webAutomation";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import { normalizeHttpAutomation } from "../../src/utils/connection/sessionQuickActions";
import {
  normalizeWebsiteDarkModeConfig,
  normalizeWebsiteDarkModeSettings,
} from "../../src/utils/connection/websiteDarkMode";
import { DEFAULT_SESSION_QUICK_ACTIONS } from "../../src/types/connection/sessionQuickActions";
import { useWebsiteDarkMode } from "../../src/hooks/protocol/useWebsiteDarkMode";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import {
  registerRuntimeConnection,
  releaseRuntimeConnection,
  clearRuntimeConnectionsForTests,
} from "../../src/utils/session/runtimeConnectionRegistry";
import { httpRedirectTrustIdentity } from "../../src/utils/protocol/httpRedirectTrustIdentity";

const db = vi.hoisted(() => ({
  id: "a",
  generation: 1,
  locked: false,
  rows: [] as Connection[],
  read: vi.fn(),
  listeners: new Set<(event: { status: string }) => void>(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (listener: (event: { status: string }) => void) => {
    db.listeners.add(listener);
    return () => db.listeners.delete(listener);
  },
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: db.id }),
      captureCurrentDatabaseDataTarget: () => {
        const id = db.id,
          generation = db.generation;
        return {
          databaseId: id,
          readCurrent: db.read,
          assertAccessible: () => {
            if (db.locked || db.id !== id || db.generation !== generation)
              throw new Error("Owner revoked");
          },
        };
      },
    }),
  },
}));

const fixture = (): Connection => ({
  id: "same",
  name: "Website",
  protocol: "https",
  hostname: "site.example.test",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-11",
  updatedAt: "2026-09-11",
  httpAutomation: normalizeHttpAutomation(undefined),
});
const document = {
  sessionId: "proxy",
  token: "token",
  sequence: 1,
  generation: 1,
  navigationToken: "navigation",
  url: "http://nonce.localhost:5000/",
} as WebAutomationDocument;
const request = vi.fn(),
  cancel = vi.fn();
const bridge = { request, cancel } as unknown as WebAutomationBridge;
let connection: Connection;
let update: ReturnType<typeof vi.fn<(connection: Connection) => Promise<void>>>;
let currentRows: Connection[];
let settings: GlobalSettings;

function context(): ConnectionContextType {
  const value: Partial<ConnectionContextType> = {
    state: { connections: currentRows } as ConnectionContextType["state"],
    databaseAvailability: {
      status: db.locked ? "suspended" : "ready",
      databaseId: db.id,
      generation: db.generation,
    },
    getCurrentConnections: ({ databaseId, generation }) => {
      if (db.locked || databaseId !== db.id || generation !== db.generation)
        throw new Error("Owner revoked");
      return currentRows;
    },
  };
  return value as ConnectionContextType;
}
function mount(
  initial: Partial<Parameters<typeof useWebsiteDarkMode>[0]> = {},
) {
  let props = {
    connection,
    ownerDatabaseId: "a",
    settings,
    settingsReady: true,
    scopeKey: "a:1",
    blocked: false,
    navigationKey: "page-1",
    getDocument: () => document,
    updateConnection: update,
    bridge,
    resetKey: "reset",
    ...initial,
  };
  const hook = renderHook((value) => useWebsiteDarkMode(value), {
    initialProps: props,
    wrapper: ({ children }) => (
      <StrictMode>
        <ConnectionContext.Provider value={context()}>
          {children}
        </ConnectionContext.Provider>
      </StrictMode>
    ),
  });
  return {
    ...hook,
    change: (patch: Partial<typeof props>) => {
      props = { ...props, ...patch };
      hook.rerender(props);
    },
  };
}
beforeEach(() => {
  clearRuntimeConnectionsForTests();
  db.id = "a";
  db.generation = 1;
  db.locked = false;
  db.listeners.clear();
  connection = fixture();
  db.rows = [structuredClone(connection)];
  currentRows = [connection];
  settings = {
    sessionQuickActions: { ...DEFAULT_SESSION_QUICK_ACTIONS },
    websiteDarkMode: normalizeWebsiteDarkModeSettings(undefined),
  } as GlobalSettings;
  db.read.mockReset().mockImplementation(async () => ({
    connections: structuredClone(db.rows),
  }));
  request.mockReset().mockResolvedValue(undefined);
  cancel.mockReset();
  update = vi.fn(async (next: Connection) => {
    currentRows = [next];
    db.rows = [structuredClone(next)];
  });
});
afterEach(cleanup);

describe("durable website appearance lifecycle", () => {
  it("keeps malformed runtime appearance unavailable without throwing during render", () => {
    const invalid = {
      ...connection,
      httpAutomation: {
        ...connection.httpAutomation!,
        darkMode: { version: 99 },
      },
    } as unknown as Connection;
    const hook = mount({ connection: invalid });
    expect(hook.result.current.available).toBe(false);
    expect(hook.result.current.enabled).toBe(false);
    expect(db.read).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("does not carry an old saved-source error into a different unsaved page", async () => {
    db.read.mockRejectedValueOnce(
      new Error("Former source could not be verified"),
    );
    const hook = mount();
    await waitFor(() =>
      expect(hook.result.current.error).toBe(
        "Former source could not be verified",
      ),
    );
    hook.change({ connection: { ...connection, id: "unsaved-next" } });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.unavailableReason).toMatch(
      /Save the original website/,
    );
    expect(hook.result.current.available).toBe(false);
  });

  it("ignores only visual appearance in redirect source proof, retaining security and other automation fields", () => {
    const original = httpRedirectTrustIdentity(connection);
    expect(
      httpRedirectTrustIdentity({
        ...connection,
        httpAutomation: {
          ...connection.httpAutomation!,
          forceDark: true,
          darkMode: normalizeWebsiteDarkModeConfig(undefined),
        },
      }),
    ).toBe(original);
    for (const patch of [
      { hostname: "other.example.test" },
      { port: 8443 },
      { protocol: "http" as const },
      { password: "different-fixture" },
      { username: "different-user" },
      { httpHeaders: { Authorization: "different-fixture" } },
      { httpsTrustPolicy: "strict" as const },
      {
        httpAutomation: {
          ...connection.httpAutomation!,
          scriptInjectionEnabled:
            !connection.httpAutomation!.scriptInjectionEnabled,
        },
      },
      {
        httpAutomation: {
          ...connection.httpAutomation!,
          interactionMacrosEnabled:
            !connection.httpAutomation!.interactionMacrosEnabled,
        },
      },
      {
        synologySettings: {
          version: 1 as const,
          useHttps: true,
          useDefaultRedirectDestinations: false,
        },
      },
    ])
      expect(httpRedirectTrustIdentity({ ...connection, ...patch })).not.toBe(
        original,
      );
  });
  it("saves redirected-page appearance only to the original saved connection, without enabling macros or scripts", async () => {
    const identity = httpRedirectTrustIdentity(connection);
    const runtime = {
      ...connection,
      id: "ephemeral",
      hostname: "destination.example.test",
    };
    registerRuntimeConnection(runtime, {
      initialUrl: "https://destination.example.test/",
      redirectHops: 1,
      assertCurrent: () => undefined,
      trustedRedirectSource: {
        databaseId: "a",
        savedConnectionId: connection.id,
        originalOrigin: "https://site.example.test",
        assertOwner: () => {
          if (db.id !== "a" || db.locked) throw new Error("Owner changed");
        },
        assertIdentity: (value) => {
          if (httpRedirectTrustIdentity(value) !== identity)
            throw new Error("Source changed");
        },
      },
    });
    const before = structuredClone(connection.httpAutomation);
    const hook = mount({ connection: runtime });
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    await act(async () => {
      expect(await hook.result.current.setEnabled(true)).toBe(true);
    });
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0].id).toBe("same");
    expect(update.mock.calls[0][0].hostname).toBe("site.example.test");
    expect(db.rows[0].httpAutomation).toMatchObject({
      ...before,
      forceDark: true,
    });
    // Model the Provider publishing the saved original row, not a new runtime ID.
    hook.change({ connection: runtime });
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(request).toHaveBeenLastCalledWith(
      "dark",
      expect.objectContaining({ enabled: true }),
    );
    releaseRuntimeConnection("ephemeral");
    await act(async () => {
      expect(await hook.result.current.setEnabled(false)).toBe(false);
    });
    expect(update).toHaveBeenCalledOnce();
  });

  it("does not invent a saved appearance source for an unsaved redirect", async () => {
    const runtime = { ...connection, id: "ephemeral" };
    registerRuntimeConnection(runtime, {
      initialUrl: "https://site.example.test/",
      redirectHops: 1,
      assertCurrent: () => undefined,
    });
    const hook = mount({ connection: runtime });
    expect(hook.result.current.available).toBe(false);
    expect(hook.result.current.unavailableReason).toMatch(
      /Save the original website/,
    );
    expect(db.read).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("recognizes the same saved profile after Provider supplies optional protocol defaults", async () => {
    connection.httpApplication = {
      version: 1,
      id: "synology-dsm",
    } as Connection["httpApplication"];
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    connection = normalizeAdvancedProtocolConnection(connection);
    currentRows = [connection];
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(hook.result.current.available).toBe(true);
    expect(hook.result.current.error).toBeNull();
    expect(request).toHaveBeenLastCalledWith(
      "dark",
      expect.objectContaining({ enabled: true }),
    );
    expect(update).not.toHaveBeenCalled();
  });
  it("loads under StrictMode without a script library and never enables from global defaults", async () => {
    const hook = mount();
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    expect(hook.result.current.enabled).toBe(false);
    expect(
      request.mock.calls.every(([, payload]) => payload.enabled === false),
    ).toBe(true);
    expect(update).not.toHaveBeenCalled();
    hook.unmount();
    expect(db.listeners.size).toBe(0);
  });
  it("waits for readiness and reapplies changed global defaults to a durably enabled connection", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    const hook = mount({ blocked: true });
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(request).not.toHaveBeenCalled();
    hook.change({ blocked: false });
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(
        "dark",
        expect.objectContaining({
          enabled: true,
          theme: expect.objectContaining({ brightness: 100 }),
        }),
      ),
    );
    hook.change({
      settings: {
        ...settings,
        websiteDarkMode: {
          ...settings.websiteDarkMode!,
          defaults: { ...settings.websiteDarkMode!.defaults, brightness: 80 },
        },
      },
    });
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(
        "dark",
        expect.objectContaining({
          enabled: true,
          theme: expect.objectContaining({ brightness: 80 }),
        }),
      ),
    );
    expect(update).not.toHaveBeenCalled();
  });
  it("verifies saved consent before applying; a failed optimistic save stays disabled through rerenders", async () => {
    const hook = mount();
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    update.mockImplementation(async (next: Connection) => {
      currentRows = [next];
      hook.change({ connection: next });
      throw new Error("disk unavailable");
    });
    await act(async () => {
      expect(await hook.result.current.setEnabled(true)).toBe(false);
    });
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.error).toMatch(/confirmed saved/);
    expect(request.mock.calls.some(([, payload]) => payload.enabled)).toBe(
      false,
    );
    update.mockImplementation(async (next: Connection) => {
      currentRows = [next];
      db.rows = [structuredClone(next)];
      hook.change({ connection: next });
    });
    await act(async () => {
      expect(await hook.result.current.setEnabled(true)).toBe(true);
    });
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
  });
  it("preserves unrelated automation and credentials while saving an appearance preset", async () => {
    connection.password = "private-fixture";
    connection.httpAutomation!.items = [{ kind: "script", id: "keep" }];
    db.rows = [structuredClone(connection)];
    const hook = mount();
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    const configuration = {
      ...normalizeWebsiteDarkModeConfig(undefined),
      useGlobalDefaults: false,
      theme: {
        ...normalizeWebsiteDarkModeConfig(undefined).theme,
        brightness: 75,
      },
    };
    await act(async () => {
      expect(await hook.result.current.updateConfiguration(configuration)).toBe(
        true,
      );
    });
    expect(db.rows[0]).toMatchObject({
      password: "private-fixture",
      httpAutomation: {
        forceDark: false,
        items: [{ kind: "script", id: "keep" }],
        darkMode: configuration,
      },
    });
  });
  it("rejects retained callbacks across owner ABA even with a colliding connection ID", async () => {
    const hook = mount();
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    const stale = hook.result.current.setEnabled;
    db.id = "b";
    db.generation = 2;
    hook.change({ ownerDatabaseId: "b", scopeKey: "b:2" });
    db.id = "a";
    db.generation = 3;
    hook.change({ ownerDatabaseId: "a", scopeKey: "a:3" });
    await act(async () => {
      expect(await stale(true)).toBe(false);
    });
    expect(update).not.toHaveBeenCalled();
  });
  it("does not write after owner revocation during a pending durable read", async () => {
    const hook = mount();
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    let finish!: (value: { connections: Connection[] }) => void;
    db.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<boolean>;
    act(() => {
      pending = hook.result.current.setEnabled(true);
    });
    act(() => {
      db.locked = true;
      for (const listener of db.listeners) listener({ status: "suspended" });
    });
    await act(async () => {
      finish({ connections: db.rows });
      expect(await pending).toBe(false);
    });
    expect(update).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(true);
    expect(hook.result.current.enabled).toBe(false);
  });
  it("rejects an auth target change during a pending save and ignores late completion after unmount", async () => {
    const hook = mount();
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    let finish!: () => void;
    update.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<boolean>;
    act(() => {
      pending = hook.result.current.setEnabled(true);
    });
    await waitFor(() => expect(update).toHaveBeenCalled());
    hook.change({
      connection: { ...connection, httpHeaders: { Authorization: "changed" } },
    });
    hook.unmount();
    await act(async () => {
      finish();
      expect(await pending).toBe(false);
    });
    expect(request.mock.calls.some(([, payload]) => payload.enabled)).toBe(
      false,
    );
  });
  it("refuses unsaved or malformed settings and turns off when global availability is revoked", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    hook.change({
      settings: {
        ...settings,
        sessionQuickActions: {
          ...settings.sessionQuickActions,
          allowWebForceDark: false,
        },
      },
    });
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(
        "dark",
        expect.objectContaining({ enabled: false }),
      ),
    );
    expect(hook.result.current.available).toBe(false);
    hook.change({ settings, connection: { ...connection, id: "unsaved" } });
    await waitFor(() =>
      expect(hook.result.current.unavailableReason).toMatch(
        /Save the original website/,
      ),
    );
    expect(hook.result.current.available).toBe(false);
    hook.change({
      connection,
      settings: {
        ...settings,
        websiteDarkMode: {
          ...settings.websiteDarkMode!,
          defaults: {
            ...settings.websiteDarkMode!.defaults,
            customCss: "@import 'https://x';",
          },
        },
      },
    });
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.unavailableReason).toMatch(/local CSS/);
  });
});
