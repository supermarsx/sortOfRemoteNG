import { act, cleanup, renderHook } from "@testing-library/react";
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  request: vi.fn(),
  update: vi.fn(),
  owner: "db-a",
  lease: 1,
  unlocked: true,
  nativeLocks: new Set<() => void>(),
  databaseLocks: new Set<(event: { status: string }) => void>(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => h.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, callback: () => void) => {
    h.nativeLocks.add(callback);
    return () => h.nativeLocks.delete(callback);
  },
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (callback: (event: { status: string }) => void) => {
    h.databaseLocks.add(callback);
    return () => h.databaseLocks.delete(callback);
  },
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: h.owner }),
      captureCurrentDatabaseDataTarget: () => {
        const owner = h.owner,
          lease = h.lease;
        return {
          databaseId: owner,
          assertAccessible: () => {
            if (!h.unlocked || owner !== h.owner || lease !== h.lease)
              throw new Error("Owner access changed");
          },
        };
      },
    }),
  },
}));
vi.mock("../../src/utils/recording/webAutomationBridge", () => ({
  WebAutomationBridge: class {
    request = h.request;
    cancel = vi.fn();
    handleMessage = vi.fn();
  },
}));
// The appearance lane is independent of storage initialization.
vi.mock("../../src/hooks/protocol/useWebsiteDarkMode", () => ({
  useWebsiteDarkMode: () => null,
}));

import { useWebAutomation } from "../../src/hooks/protocol/useWebAutomation";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
import {
  normalizeWebAutomationLibrary,
  WEB_AUTOMATION_STORE_KEY,
} from "../../src/utils/recording/webAutomationLibrary";

const busy =
  "Storage error: encryption storage transition in progress; retry after it completes";
const library = normalizeWebAutomationLibrary({
  version: 1,
  macros: [],
  scripts: [
    {
      kind: "script",
      id: "saved-script",
      name: "Existing website script",
      description: "",
      code: "document.title",
      createdAt: "2026-09-13T00:00:00Z",
      updatedAt: "2026-09-13T00:00:00Z",
    },
  ],
});
const raw = JSON.stringify(library);
const options = () => ({
  connection: {
    id: "connection",
    name: "Fixture",
    hostname: "fixture.example",
    port: 443,
    protocol: "https",
    isGroup: false,
    createdAt: "2026-09-13T00:00:00Z",
    updatedAt: "2026-09-13T00:00:00Z",
    httpAutomation: {
      version: 1,
      scriptInjectionEnabled: true,
      interactionMacrosEnabled: true,
      forceDark: false,
      items: [],
    },
  } as Connection,
  ownerDatabaseId: "db-a",
  scopeKey: "db-a:1",
  settingsReady: true,
  settings: {
    sessionQuickActions: {
      httpEnabled: true,
      allowWebMacros: true,
      allowWebScriptInjection: true,
      allowWebForceDark: false,
      confirmBeforeScriptRun: true,
    },
  } as GlobalSettings,
  blocked: true,
  navigationKey: "page-loading",
  iframe: { current: null },
  getDocument: () => null,
  updateConnection: h.update,
});
const tick = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.owner = "db-a";
  h.lease = 1;
  h.unlocked = true;
  h.nativeLocks.clear();
  h.databaseLocks.clear();
  h.request.mockReset();
  h.update.mockReset();
  h.invoke.mockReset().mockImplementation(async (command, args) => {
    if (
      command !== "read_macro_library" ||
      args.key !== WEB_AUTOMATION_STORE_KEY
    )
      throw new Error("Unexpected mutation or backend");
    return raw;
  });
});
afterEach(async () => {
  cleanup();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
});

describe("website library startup with the real durable store", () => {
  it("initializes the exact database library under StrictMode without a false pending-save error", async () => {
    const read = vi.fn(async () => emptyDatabaseAutomationLibrary());
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StrictMode>
        <ConnectionContext.Provider
          value={
            {
              automationLibrary: {
                scope: { databaseId: "db-a", generation: 1 },
                changeRevision: 0,
                read,
                compareAndSwap: vi.fn(),
              },
            } as unknown as ConnectionContextType
          }
        >
          {children}
        </ConnectionContext.Provider>
      </StrictMode>
    );
    const view = renderHook(useWebAutomation, {
      initialProps: options(),
      wrapper,
      reactStrictMode: true,
    });
    await tick();
    expect(read).toHaveBeenCalled();
    expect(view.result.current.availableDatabaseScope).toEqual({
      kind: "database",
      databaseId: "db-a",
    });
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.libraryReady).toBe(true);
    expect(
      h.invoke.mock.calls.every(
        ([command]) => command === "read_macro_library",
      ),
    ).toBe(true);
  });
  it.each([2, 4])(
    "recovers on read %i while the page is still loading, without an error or action replay",
    async (attempts) => {
      for (let attempt = 1; attempt < attempts; attempt++)
        h.invoke.mockRejectedValueOnce(busy);
      const props = options();
      const view = renderHook(useWebAutomation, {
        initialProps: { ...props, settingsReady: false },
      });
      await tick();
      expect(h.invoke).not.toHaveBeenCalled();
      view.rerender(props);
      await tick();
      expect(view.result.current.error).toBeNull();
      expect(view.result.current.libraryReady).toBe(false);
      expect(view.result.current.recordingUnavailableReason).toMatch(
        /Loading website macro library/,
      );
      await tick(850);
      expect(view.result.current.error).toBeNull();
      expect(view.result.current.libraryReady).toBe(true);
      expect(view.result.current.library.scripts).toEqual(library.scripts);
      expect(view.result.current.pageReady).toBe(false);
      expect(h.invoke).toHaveBeenCalledTimes(attempts);
      expect(h.request).not.toHaveBeenCalled();
      expect(h.update).not.toHaveBeenCalled();
    },
  );

  it("keeps persistent busy actionable after exactly four reads; a later explicit reload can recover", async () => {
    h.invoke.mockRejectedValue(busy);
    const view = renderHook(useWebAutomation, { initialProps: options() });
    await tick(850);
    expect(view.result.current.error).toMatch(
      /encryption storage transition.*Reload/,
    );
    expect(view.result.current.libraryReady).toBe(false);
    expect(h.invoke).toHaveBeenCalledTimes(4);
    await tick(10000);
    expect(h.invoke).toHaveBeenCalledTimes(4);
    h.invoke.mockResolvedValue(raw);
    await act(async () => {
      await view.result.current.reload();
    });
    expect(view.result.current.library.scripts).toEqual(library.scripts);
    expect(view.result.current.libraryReady).toBe(true);
    expect(view.result.current.error).toBeNull();
    expect(h.invoke).toHaveBeenCalledTimes(5);
    expect(h.request).not.toHaveBeenCalled();
  });

  it.each([
    ["Encryption required: key unavailable", /encryption.*locked/],
    ["Stored data is corrupt", /could not be validated/],
    ["I/O error: unreadable PRIVATE_PATH", /storage availability/],
    ["Unknown command read_macro_library", /desktop library backend/],
  ] as const)(
    "keeps permanent refusal %s immediate and sanitized",
    async (error, expected) => {
      h.invoke.mockRejectedValue(error);
      const view = renderHook(useWebAutomation, { initialProps: options() });
      await tick();
      expect(view.result.current.error).toMatch(expected);
      expect(view.result.current.error).not.toContain("PRIVATE_PATH");
      expect(view.result.current.libraryReady).toBe(false);
      await tick(1000);
      expect(h.invoke).toHaveBeenCalledTimes(1);
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it("aborts the pending retry and listeners on unmount", async () => {
    h.invoke.mockRejectedValue(busy);
    const view = renderHook(useWebAutomation, { initialProps: options() });
    await tick();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    view.unmount();
    await tick(1000);
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.nativeLocks.size).toBe(0);
    expect(h.databaseLocks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["database", "encryption"])(
    "requires explicit fresh reload after %s revocation, even if unlocked again",
    async (kind) => {
      h.invoke.mockRejectedValueOnce(busy);
      const view = renderHook(useWebAutomation, { initialProps: options() });
      await tick();
      act(() => {
        h.unlocked = false;
        h.lease++;
        if (kind === "database")
          h.databaseLocks.forEach((callback) =>
            callback({ status: "suspended" }),
          );
        else h.nativeLocks.forEach((callback) => callback());
        h.unlocked = true;
      });
      await tick(1000);
      expect(h.invoke).toHaveBeenCalledTimes(1);
      expect(view.result.current.error).toMatch(/access was revoked/);
      expect(view.result.current.libraryReady).toBe(false);
      await act(async () => {
        await view.result.current.reload();
      });
      expect(h.invoke).toHaveBeenCalledTimes(2);
      expect(view.result.current.libraryReady).toBe(true);
      expect(view.result.current.library.scripts).toEqual(library.scripts);
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it("refuses the old captured owner lease after a same-ID close/reopen even without a delivered event", async () => {
    h.invoke.mockRejectedValueOnce(busy);
    const view = renderHook(useWebAutomation, { initialProps: options() });
    await tick();
    h.lease++;
    await tick(1000);
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(view.result.current.libraryReady).toBe(false);
    expect(view.result.current.error).toMatch(/access changed/);
    expect(h.request).not.toHaveBeenCalled();
  });

  it("replaces a pending read on a new access scope without publishing its stale result", async () => {
    h.invoke.mockRejectedValueOnce(busy);
    const props = options();
    const view = renderHook(useWebAutomation, { initialProps: props });
    await tick();
    h.lease++;
    view.rerender({ ...props, scopeKey: "db-a:2" });
    await tick();
    expect(view.result.current.libraryReady).toBe(true);
    expect(view.result.current.error).toBeNull();
    await tick(1000);
    expect(h.invoke).toHaveBeenCalledTimes(2);
    expect(h.request).not.toHaveBeenCalled();
  });

  it("cancels a replaced Reload's backoff instead of letting both retry", async () => {
    h.invoke.mockRejectedValueOnce(busy);
    const view = renderHook(useWebAutomation, { initialProps: options() });
    await tick();
    await act(async () => {
      await view.result.current.reload();
    });
    expect(view.result.current.libraryReady).toBe(true);
    expect(view.result.current.error).toBeNull();
    await tick(1000);
    expect(h.invoke).toHaveBeenCalledTimes(2);
    expect(h.request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
