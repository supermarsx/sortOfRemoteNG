import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";
import { normalizeHttpAutomation } from "../../src/utils/connection/sessionQuickActions";
import { DEFAULT_SESSION_QUICK_ACTIONS } from "../../src/types/connection/sessionQuickActions";

const h = vi.hoisted(() => ({
  owner: "db-a",
  lease: 1,
  locked: false,
  rows: [] as Connection[],
  read: vi.fn(),
  load: vi.fn(),
  listeners: new Set<(event: { status: string }) => void>(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (listener: (event: { status: string }) => void) => {
    h.listeners.add(listener);
    return () => h.listeners.delete(listener);
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
            if (h.locked || owner !== h.owner || lease !== h.lease)
              throw new Error("Owner changed");
          },
          readCurrent: h.read,
        };
      },
    }),
  },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
vi.mock("../../src/utils/recording/webAutomationLibrary", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/recording/webAutomationLibrary")
  >()),
  webAutomationStore: { load: h.load },
}));
import { useWebAutomation } from "../../src/hooks/protocol/useWebAutomation";

let frame: HTMLIFrameElement;
beforeEach(() => {
  h.owner = "db-a";
  h.lease = 1;
  h.locked = false;
  h.listeners.clear();
  h.load
    .mockReset()
    .mockRejectedValue(
      new Error("Storage error: invalid macro library envelope"),
    );
  h.read
    .mockReset()
    .mockImplementation(async () => ({ connections: structuredClone(h.rows) }));
  frame = document.createElement("iframe");
  document.body.appendChild(frame);
});
afterEach(() => {
  cleanup();
  frame.remove();
});

it("rearms only verified appearance after owner unlock even when macro storage keeps failing", async () => {
  const connection = {
    id: "saved",
    name: "Fixture",
    hostname: "fixture.example",
    port: 443,
    protocol: "https",
    isGroup: false,
    createdAt: "2026-09-13",
    updatedAt: "2026-09-13",
    httpAutomation: { ...normalizeHttpAutomation(undefined), forceDark: true },
  } as Connection;
  h.rows = [connection];
  const documentInfo = {
    sessionId: "proxy",
    token: "a".repeat(32),
    sequence: 1,
    generation: 1,
    navigationToken: null,
    url: "http://proxy.localhost:45000/",
  };
  const sent: Record<string, unknown>[] = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(
    (message: unknown) => {
      const data = message as Record<string, unknown>;
      sent.push(data);
      if (data.action === "dark")
        queueMicrotask(() =>
          window.dispatchEvent(
            new MessageEvent("message", {
              source: frame.contentWindow,
              origin: "http://proxy.localhost:45000",
              data: { ...data, type: "proxy_web_automation", status: "ok" },
            }),
          ),
        );
    },
  );
  const options = {
    connection,
    ownerDatabaseId: "db-a",
    settingsReady: true,
    settings: {
      sessionQuickActions: {
        ...DEFAULT_SESSION_QUICK_ACTIONS,
        allowWebForceDark: true,
      },
    } as GlobalSettings,
    scopeKey: "db-a:1",
    appearanceScopeKey: "db-a:1",
    blocked: false,
    navigationKey: "one",
    iframe: { current: frame },
    getDocument: () => documentInfo,
    updateConnection: vi.fn(),
  };
  const hook = renderHook(useWebAutomation, {
    initialProps: options,
    reactStrictMode: true,
  });
  await waitFor(() => expect(hook.result.current.darkMode.enabled).toBe(true));
  const enabledSent = () =>
    sent.filter(
      (entry) =>
        entry.action === "dark" &&
        (entry.payload as { enabled?: boolean })?.enabled === true,
    ).length;
  await waitFor(() => expect(enabledSent()).toBeGreaterThan(0));
  expect(hook.result.current.error).toMatch(/could not be validated/);
  act(() => {
    h.locked = true;
    h.lease++;
    for (const listener of h.listeners) listener({ status: "suspended" });
  });
  await waitFor(() => expect(hook.result.current.darkMode.enabled).toBe(false));
  const lockedCount = enabledSent();
  await act(async () => {
    await Promise.resolve();
  });
  expect(enabledSent()).toBe(lockedCount);
  act(() => {
    h.locked = false;
    h.lease++;
    for (const listener of h.listeners) listener({ status: "ready" });
  });
  hook.rerender({
    ...options,
    scopeKey: "db-a:3",
    appearanceScopeKey: "db-a:3",
  });
  await waitFor(() => expect(hook.result.current.darkMode.enabled).toBe(true));
  await waitFor(() => expect(enabledSent()).toBeGreaterThan(lockedCount));
  expect(hook.result.current.libraryReady).toBe(false);
  expect(
    sent.every((entry) => entry.action === "dark" || entry.action === "cancel"),
  ).toBe(true);
  const beforeForeign = enabledSent();
  h.owner = "foreign";
  h.lease++;
  hook.rerender({
    ...options,
    scopeKey: "foreign:4",
    appearanceScopeKey: "foreign:4",
  });
  await waitFor(() => expect(hook.result.current.darkMode.enabled).toBe(false));
  expect(enabledSent()).toBe(beforeForeign);
  expect(options.updateConnection).not.toHaveBeenCalled();
});
