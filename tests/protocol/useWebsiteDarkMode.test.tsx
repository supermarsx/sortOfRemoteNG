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
  DEFAULT_HTTP_PROXY_POLICY,
  type HttpProxyPolicy,
} from "../../src/types/connection/httpProxyPolicy";
import { DEFAULT_WEBSITE_DARK_THEME } from "../../src/utils/connection/websiteDarkMode";
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
    expect(hook.result.current.unavailableReason).toMatch(/temporary session/);
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
    expect(hook.result.current.unavailableReason).toMatch(/temporary session/);
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
  it("does not disable a restored dark page while its saved appearance read is pending across navigation", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    let finish!: (value: { connections: Connection[] }) => void;
    const pending = new Promise<{ connections: Connection[] }>((resolve) => {
      finish = resolve;
    });
    db.read.mockReturnValue(pending);
    const hook = mount();
    expect(db.read).toHaveBeenCalled();
    expect(hook.result.current.enabled).toBe(false);
    expect(request).not.toHaveBeenCalled();
    hook.change({ navigationKey: "page-2", resetKey: "page-2:loading" });
    expect(request).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalledWith(true);
    await act(async () => finish({ connections: db.rows }));
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(request.mock.calls.every(([, payload]) => payload.enabled)).toBe(
      true,
    );
  });

  it("retains verified appearance but grants no execution or save during a settings reload", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    request.mockClear();
    cancel.mockClear();
    hook.change({ settingsReady: false });
    expect(cancel).not.toHaveBeenCalledWith(true);
    expect(cancel).toHaveBeenCalledWith(false);
    expect(request).not.toHaveBeenCalled();
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.available).toBe(false);
    hook.change({ settingsReady: true });
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(request.mock.calls.every(([, payload]) => payload.enabled)).toBe(
      true,
    );
    expect(cancel).not.toHaveBeenCalledWith(true);
  });

  it.each(["off", "owner", "access", "scripts", "suspended"])(
    "does not retain appearance for %s during a settings reload",
    async (change) => {
      connection.httpAutomation!.forceDark = true;
      db.rows = [structuredClone(connection)];
      const hook = mount();
      await waitFor(() => expect(hook.result.current.enabled).toBe(true));
      hook.change({ settingsReady: false });
      cancel.mockClear();
      request.mockClear();
      if (change === "off")
        hook.change({
          connection: {
            ...connection,
            httpAutomation: { ...connection.httpAutomation!, forceDark: false },
          },
        });
      if (change === "owner")
        hook.change({ ownerDatabaseId: "other", scopeKey: "other:1" });
      if (change === "access") hook.change({ accessRevision: 1 });
      if (change === "scripts")
        hook.change({
          connection: {
            ...connection,
            httpProxyPolicy: {
              ...DEFAULT_HTTP_PROXY_POLICY,
              pageScripts: "block",
            },
          },
        });
      if (change === "suspended") {
        db.locked = true;
        hook.change({});
      }
      expect(cancel).toHaveBeenCalledWith(true);
      expect(hook.result.current.enabled).toBe(false);
      expect(request).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("does not retain an unverified appearance during a settings reload", () => {
    connection.httpAutomation!.forceDark = true;
    db.read.mockImplementation(() => new Promise(() => {}));
    const hook = mount();
    hook.change({ settingsReady: false });
    expect(cancel).toHaveBeenCalledWith(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("reapplies verified appearance on document resets without a new database read or disable", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    db.read.mockClear().mockImplementation(() => new Promise(() => {}));
    request.mockClear();
    cancel.mockClear();
    hook.change({ navigationKey: "page-2", resetKey: "page-2:loading" });
    expect(hook.result.current.enabled).toBe(true);
    expect(db.read).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      "dark",
      expect.objectContaining({ enabled: true }),
    );
    expect(request.mock.calls.every(([, payload]) => payload.enabled)).toBe(
      true,
    );
    expect(cancel).not.toHaveBeenCalledWith(true);
  });

  it.each([
    ["connection rename", { name: "Renamed website" }],
    [
      "bookmark addition",
      { httpBookmarks: [{ name: "Status", path: "/status" }] },
    ],
    ["bookmark rename", { httpBookmarks: [{ name: "Renamed", path: "/" }] }],
    ["description edit", { description: "Updated description" }],
    ["tag edit", { tags: ["production"] }],
    ["order edit", { order: 2 }],
    ["color edit", { color: "blue" }],
    ["icon edit", { icon: "globe" }],
    ["expanded edit", { expanded: true }],
    ["last-accessed update", { lastAccessed: "2026-09-26T12:00:00Z" }],
    ["last-used update", { lastUsed: "2026-09-26T12:00:00Z" }],
  ] satisfies [string, Partial<Connection> & Record<string, unknown>][])(
    "keeps verified appearance during an optimistic %s and its durable save",
    async (_label, patch) => {
      connection.httpAutomation!.forceDark = true;
      connection.httpBookmarks = [{ name: "Home", path: "/" }];
      db.rows = [structuredClone(connection)];
      const hook = mount();
      await waitFor(() => expect(hook.result.current.enabled).toBe(true));
      const initialScope = hook.result.current.scopeKey;
      db.read.mockClear();
      request.mockClear();
      cancel.mockClear();
      const updated = { ...connection, ...patch };
      currentRows = [updated];
      hook.change({ connection: updated });
      expect(cancel).not.toHaveBeenCalledWith(true);
      expect(hook.result.current.enabled).toBe(true);
      expect(hook.result.current.available).toBe(true);
      expect(hook.result.current.scopeKey).toBe(initialScope);
      expect(hook.result.current.savedConnectionName).toBe(updated.name);
      expect(db.read).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      db.rows = [structuredClone(updated)];
      hook.change({ connection: structuredClone(updated) });
      expect(hook.result.current.enabled).toBe(true);
      expect(db.read).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(["pin", "remove", "reorder"] as const)(
    "preserves appearance and failed-save fences when favorite refs %s",
    async (operation) => {
      const original = [
        { kind: "script" as const, id: "first" },
        { kind: "macro" as const, id: "second" },
      ];
      connection.httpAutomation = {
        ...connection.httpAutomation!,
        forceDark: true,
        items: original,
      };
      db.rows = [structuredClone(connection)];
      const hook = mount();
      await waitFor(() => expect(hook.result.current.enabled).toBe(true));
      const initialScope = hook.result.current.scopeKey;
      db.read.mockClear();
      request.mockClear();
      cancel.mockClear();
      const items =
        operation === "pin"
          ? [
              ...original,
              {
                kind: "script" as const,
                id: "third",
                scope: { kind: "database" as const, databaseId: "a" },
              },
            ]
          : operation === "remove"
            ? original.slice(1)
            : [...original].reverse();
      const updated = {
        ...connection,
        httpAutomation: { ...connection.httpAutomation!, items },
      };
      currentRows = [updated];
      await act(async () => {
        hook.change({ connection: updated });
      });
      expect(cancel).not.toHaveBeenCalledWith(true);
      expect(hook.result.current.enabled).toBe(true);
      expect(hook.result.current.scopeKey).toBe(initialScope);
      expect(db.read).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      db.rows = [structuredClone(updated)];
      update.mockRejectedValueOnce(new Error("disk unavailable"));
      await act(async () => {
        expect(await hook.result.current.setEnabled(false)).toBe(false);
      });
      const failure = hook.result.current.error;
      expect(failure).toMatch(/confirmed saved/);
      expect(hook.result.current.enabled).toBe(false);
      db.read.mockClear();
      request.mockClear();
      currentRows = [connection];
      db.rows = [structuredClone(connection)];
      await act(async () => {
        hook.change({ connection });
      });
      expect(hook.result.current.enabled).toBe(false);
      expect(hook.result.current.error).toBe(failure);
      expect(hook.result.current.scopeKey).toBe(initialScope);
      expect(db.read).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalledWith(true);
    },
  );

  it("finishes a pending appearance restore across optimistic bookmark and name edits", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    let finish!: (value: { connections: Connection[] }) => void;
    db.read.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const hook = mount();
    db.read.mockClear();
    const updated = {
      ...connection,
      name: "Renamed website",
      httpBookmarks: [{ name: "Status", path: "/status" }],
    };
    currentRows = [updated];
    hook.change({ connection: updated });
    expect(cancel).not.toHaveBeenCalledWith(true);
    expect(db.read).not.toHaveBeenCalled();
    await act(async () => finish({ connections: db.rows }));
    expect(hook.result.current.enabled).toBe(true);
    expect(request).toHaveBeenLastCalledWith(
      "dark",
      expect.objectContaining({ enabled: true }),
    );
  });

  it("preserves live bookmark and name edits when an appearance save was already reading", async () => {
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
    const updated = {
      ...connection,
      name: "Renamed website",
      httpBookmarks: [{ name: "Status", path: "/status" }],
    };
    currentRows = [updated];
    hook.change({ connection: updated });
    await act(async () => {
      finish({ connections: db.rows });
      expect(await pending).toBe(true);
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: updated.name,
        httpBookmarks: updated.httpBookmarks,
        httpAutomation: expect.objectContaining({ forceDark: true }),
      }),
    );
  });

  it("keeps failed appearance saves fenced after a bookmark rename", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    update.mockRejectedValueOnce(new Error("disk unavailable"));
    await act(async () => {
      expect(await hook.result.current.setEnabled(false)).toBe(false);
    });
    const failure = hook.result.current.error;
    const updated = {
      ...connection,
      httpBookmarks: [{ name: "Renamed", path: "/" }],
    };
    currentRows = [updated];
    db.rows = [structuredClone(updated)];
    hook.change({ connection: updated });
    await act(async () => {});
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.error).toBe(failure);
  });

  it.each([
    { hostname: "different.example.test" },
    { password: "different-fixture" },
    {
      httpProxyPolicy: {
        ...DEFAULT_HTTP_PROXY_POLICY,
        pageScripts: "block" as const,
      },
    },
    {
      httpAutomation: {
        ...normalizeHttpAutomation(undefined),
        forceDark: true,
        scriptInjectionEnabled: true,
      },
    },
    {
      httpAutomation: {
        ...normalizeHttpAutomation(undefined),
        forceDark: true,
        interactionMacrosEnabled: true,
      },
    },
  ] satisfies Partial<Connection>[])(
    "revokes appearance for security edits: %j",
    async (patch) => {
      connection.httpAutomation!.forceDark = true;
      db.rows = [structuredClone(connection)];
      const hook = mount();
      await waitFor(() => expect(hook.result.current.enabled).toBe(true));
      cancel.mockClear();
      request.mockClear();
      db.read.mockImplementation(() => new Promise(() => {}));
      hook.change({ connection: { ...connection, ...patch } });
      expect(cancel).toHaveBeenCalledWith(true);
      expect(hook.result.current.enabled).toBe(false);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("revokes appearance when the same database publishes a new availability generation", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    cancel.mockClear();
    request.mockClear();
    db.read.mockClear().mockImplementation(() => new Promise(() => {}));
    db.generation++;
    hook.change({ scopeKey: `a:${db.generation}` });
    expect(cancel).toHaveBeenCalledWith(true);
    expect(db.read).toHaveBeenCalled();
    expect(hook.result.current.enabled).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("disables after a restored appearance read fails, including after a document reset", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    let reject!: (reason: Error) => void;
    db.read.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const hook = mount();
    expect(request).not.toHaveBeenCalled();
    await act(async () => reject(new Error("Database unavailable")));
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.error).toContain("Database unavailable");
    expect(request).toHaveBeenLastCalledWith(
      "dark",
      expect.objectContaining({ enabled: false }),
    );
    request.mockClear();
    hook.change({ navigationKey: "page-2", resetKey: "page-2" });
    expect(request).toHaveBeenLastCalledWith(
      "dark",
      expect.objectContaining({ enabled: false }),
    );
  });

  it("invalidates cached consent on a native access revision even before the database scope rerenders", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    const hook = mount({ accessRevision: 0 });
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    request.mockClear();
    cancel.mockClear();
    db.read.mockClear().mockImplementation(() => new Promise(() => {}));
    hook.change({ accessRevision: 1, resetKey: "native-lock" });
    expect(cancel).toHaveBeenCalledWith(true);
    expect(db.read).toHaveBeenCalled();
    expect(hook.result.current.enabled).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("honors global off during pending restore and ignores the late read", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    let finish!: (value: { connections: Connection[] }) => void;
    db.read.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const hook = mount();
    expect(request).not.toHaveBeenCalled();
    db.read.mockClear();
    hook.change({
      settings: {
        ...settings,
        sessionQuickActions: {
          ...settings.sessionQuickActions,
          allowWebForceDark: false,
        },
      },
    });
    expect(db.read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(true);
    expect(request).toHaveBeenLastCalledWith(
      "dark",
      expect.objectContaining({ enabled: false }),
    );
    await act(async () => finish({ connections: db.rows }));
    expect(hook.result.current.enabled).toBe(false);
    expect(request.mock.calls.every(([, payload]) => !payload.enabled)).toBe(
      true,
    );
  });

  it("revokes pending restore on database suspension without another read or late enable", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    let finish!: (value: { connections: Connection[] }) => void;
    db.read.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const hook = mount();
    expect(request).not.toHaveBeenCalled();
    db.read.mockClear();
    act(() => {
      db.locked = true;
      for (const listener of db.listeners) listener({ status: "suspended" });
    });
    hook.change({ scopeKey: "", resetKey: "revoked" });
    expect(cancel).toHaveBeenCalledWith(true);
    expect(db.read).not.toHaveBeenCalled();
    await act(async () => finish({ connections: db.rows }));
    expect(hook.result.current.enabled).toBe(false);
    expect(request.mock.calls.some(([, payload]) => payload.enabled)).toBe(
      false,
    );
  });

  it("cancels old appearance across an owner change while the new owner read is pending", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    cancel.mockClear();
    request.mockClear();
    db.id = "b";
    db.generation++;
    db.read.mockImplementation(() => new Promise(() => {}));
    hook.change({ ownerDatabaseId: "b", scopeKey: "b:2" });
    expect(cancel).toHaveBeenCalledWith(true);
    expect(hook.result.current.enabled).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("confirms a durable toggle despite its optimistic render changing the document reset key", async () => {
    const hook = mount();
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    let finish!: () => void;
    update.mockImplementationOnce(async (next: Connection) => {
      currentRows = [next];
      hook.change({ connection: next, resetKey: "permissions:forceDark:true" });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      db.rows = [structuredClone(next)];
    });
    let pending!: Promise<boolean>;
    act(() => {
      pending = hook.result.current.setEnabled(true);
    });
    await waitFor(() => expect(update).toHaveBeenCalled());
    await act(async () => {
      finish();
      expect(await pending).toBe(true);
    });
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(hook.result.current.error).toBeNull();
    hook.unmount();
    connection = structuredClone(db.rows[0]);
    currentRows = [connection];
    const reopened = mount();
    await waitFor(() => expect(reopened.result.current.enabled).toBe(true));
  });

  it("keeps a failed save disabled across document reset despite the persisted enabled value", async () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    update.mockRejectedValueOnce(new Error("disk unavailable"));
    await act(async () => {
      expect(await hook.result.current.setEnabled(false)).toBe(false);
    });
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.error).toMatch(/confirmed saved/);
    request.mockClear();
    hook.change({ navigationKey: "page-2", resetKey: "page-2" });
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.error).toMatch(/confirmed saved/);
    expect(request).toHaveBeenLastCalledWith(
      "dark",
      expect.objectContaining({ enabled: false }),
    );
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
        /temporary session/,
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

/**
 * A page that looks plain, or unchanged, must say which of the four things
 * happened to it rather than leaving the user to guess at the toggle.
 */
describe("what the open page actually got", () => {
  const policy = (
    pageScripts: HttpProxyPolicy["pageScripts"],
  ): HttpProxyPolicy => ({
    ...DEFAULT_HTTP_PROXY_POLICY,
    queryParameters: [],
    pageScripts,
  });
  const consent = () => {
    connection.httpAutomation!.forceDark = true;
    db.rows = [structuredClone(connection)];
    currentRows = [connection];
  };

  it("says the extension is off without inventing a reason", async () => {
    const hook = mount();
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    expect(hook.result.current.status).toEqual({
      kind: "off",
      message: "The dark-mode extension is off for this page.",
    });
  });

  it("reports the engine, and asks for no fallback, when scripts are allowed", async () => {
    consent();
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(hook.result.current.status.kind).toBe("engine");
    expect(request).toHaveBeenLastCalledWith(
      "dark",
      expect.objectContaining({ enabled: true }),
    );
    expect(
      request.mock.calls[request.mock.calls.length - 1][1],
    ).not.toHaveProperty("cssOnly");
  });

  it("falls back to CSS and names the setting when external script files are blocked", async () => {
    connection.httpProxyPolicy = policy("inline-only");
    consent();
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(
        "dark",
        expect.objectContaining({ enabled: true, cssOnly: true }),
      ),
    );
    const status = hook.result.current.status;
    expect(status.kind).toBe("cssOnly");
    expect(status.message).toContain("Website scripts");
    expect(status.message).toContain("“Block external script files”");
    expect(status.message).toContain("“Allow website scripts”");
    expect(hook.result.current.error).toBeNull();
    // Explaining the policy must never be a way of relaxing it.
    expect(update).not.toHaveBeenCalled();
    expect(db.rows[0].httpProxyPolicy).toEqual(policy("inline-only"));
  });

  it("uses the tab's effective default script policy without writing it into the saved connection", async () => {
    consent();
    const hook = mount({ effectivePolicy: policy("inline-only") });
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(
        "dark",
        expect.objectContaining({ enabled: true, cssOnly: true }),
      ),
    );
    expect(hook.result.current.status.kind).toBe("cssOnly");
    expect(connection.httpProxyPolicy).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("explains a scripts-blocked connection instead of leaving the toggle silent", async () => {
    connection.httpProxyPolicy = policy("block");
    consent();
    const hook = mount({ blocked: true });
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(request).not.toHaveBeenCalled();
    expect(hook.result.current.status.kind).toBe("failed");
    expect(hook.result.current.status.message).toContain(
      "“Block website scripts and automation”",
    );
  });

  it("keeps the chosen conversion mode as the reason a page looks plain", async () => {
    connection.httpAutomation!.darkMode = {
      version: 1,
      useGlobalDefaults: false,
      theme: { ...DEFAULT_WEBSITE_DARK_THEME, mode: "filter" },
    };
    consent();
    const hook = mount();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(hook.result.current.status.kind).toBe("cssOnly");
    expect(hook.result.current.status.message).toContain("“Filter”");
  });

  it("reports CSS recovery without assuming a policy refusal or blaming a setting", async () => {
    consent();
    request.mockResolvedValue("cssOnly");
    const hook = mount();
    await waitFor(() =>
      expect(hook.result.current.status.kind).toBe("cssOnly"),
    );
    const message = hook.result.current.status.message;
    expect(message).toContain("simplified dark styles");
    expect(message).toContain("engine could not finish");
    // There is nothing for the user to change here, so name no setting.
    expect(message).not.toContain("Website scripts");
    expect(hook.result.current.error).toBeNull();
    expect(
      request.mock.calls[request.mock.calls.length - 1][1],
    ).not.toHaveProperty("cssOnly");
    // The engine reaching a later page must not leave the old reason behind.
    request.mockResolvedValue("engine");
    hook.change({ navigationKey: "page-2" });
    await waitFor(() => expect(hook.result.current.status.kind).toBe("engine"));
  });

  it("prefers the setting the user can change over the page's own refusal", async () => {
    connection.httpProxyPolicy = policy("inline-only");
    consent();
    request.mockResolvedValue("cssOnly");
    const hook = mount();
    await waitFor(() =>
      expect(hook.result.current.status.kind).toBe("cssOnly"),
    );
    expect(hook.result.current.status.message).toContain(
      "“Block external script files”",
    );
  });

  it("carries a page-side failure and its reason, then retires it once themed", async () => {
    consent();
    // The bridge's own wording for a page that refused the command: the page's
    // internal reason never crosses the value-free acknowledgement channel.
    request.mockRejectedValue(
      new Error(
        "The page refused or could not complete this action. Check the current target and script.",
      ),
    );
    const hook = mount();
    await waitFor(() => expect(hook.result.current.status.kind).toBe("failed"));
    const framed =
      "The extension could not theme this page: The page refused or could not complete this action. Check the current target and script.";
    expect(hook.result.current.status.message).toBe(framed);
    expect(hook.result.current.error).toBe(framed);
    request.mockResolvedValue(undefined);
    hook.change({ navigationKey: "page-2" });
    await waitFor(() => expect(hook.result.current.error).toBeNull());
    expect(hook.result.current.status.kind).toBe("engine");
  });

  it("retires only the failure the page itself reported, never a failed save", async () => {
    consent();
    request.mockRejectedValue(
      new Error("Website action cancelled because its page or access changed."),
    );
    const hook = mount();
    await waitFor(() => expect(hook.result.current.status.kind).toBe("failed"));
    update.mockImplementationOnce(async () => {
      throw new Error("disk unavailable");
    });
    await act(async () => {
      expect(await hook.result.current.setEnabled(false)).toBe(false);
    });
    expect(hook.result.current.error).toMatch(/confirmed saved/);
    // The page now themes successfully, which must retire the page's own
    // failure and leave the unrelated save failure on screen.
    const before = request.mock.calls.length;
    request.mockResolvedValue(undefined);
    hook.change({ navigationKey: "page-2" });
    await waitFor(() =>
      expect(request.mock.calls.length).toBeGreaterThan(before),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.error).toMatch(/confirmed saved/);
  });
});
