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
      expect(hook.result.current.error).toMatch(/owning database/),
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
