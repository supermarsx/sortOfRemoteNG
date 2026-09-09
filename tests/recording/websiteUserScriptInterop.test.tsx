import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";
const native = vi.hoisted(() => ({
  raw: null as string | null,
  invoke: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settingsReady: true }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "fixture-db" }),
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: "fixture-db",
        assertAccessible: () => {},
      }),
      onCurrentDatabaseChange: () => () => {},
    }),
  },
  onDatabaseAccessChange: () => () => {},
}));
import { useWebsiteUserScripts } from "../../src/hooks/recording/useWebsiteUserScripts";
import { useWebAutomation } from "../../src/hooks/protocol/useWebAutomation";
import {
  normalizeWebAutomationItem,
  webAutomationStore,
  WEB_AUTOMATION_STORE_KEY,
} from "../../src/utils/recording/webAutomationLibrary";
import { normalizeHttpAutomation } from "../../src/utils/connection/sessionQuickActions";
import type { BrowserScript } from "../../src/types/recording/webAutomation";
const script: BrowserScript = {
  kind: "script",
  id: "fixture-shared-script",
  name: "Shared website script",
  description: "Fixture only",
  code: "document.body.dataset.fixture = 'yes';",
  createdAt: "2026-09-09T12:00:00Z",
  updatedAt: "2026-09-09T12:00:00Z",
};
const macro = {
  kind: "macro",
  id: "fixture-preserved-macro",
  name: "Existing macro",
  description: "",
  steps: [{ kind: "click", selector: "html > body > button:nth-of-type(1)" }],
  createdAt: script.createdAt,
  updatedAt: script.updatedAt,
};
beforeEach(() => {
  native.raw = JSON.stringify({ version: 1, scripts: [], macros: [macro] });
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command, args) => {
    expect(args.key).toBe(WEB_AUTOMATION_STORE_KEY);
    if (command === "read_macro_library") return native.raw;
    if (command === "compare_and_swap_macro_library") {
      if (native.raw !== args.expected) return false;
      native.raw = args.replacement;
      return true;
    }
    throw new Error("Unexpected non-library command");
  });
});
describe("website userscript manager and HTTP favorites interoperability", () => {
  it.each(["http", "https"] as const)(
    "shares exact saved ID/source with %s favorites while execution permissions remain off",
    async (protocol) => {
      const manager = renderHook(() => useWebsiteUserScripts());
      await waitFor(() => expect(manager.result.current.ready).toBe(true));
      await act(async () => {
        expect(await manager.result.current.save(script)).toBe(true);
      });
      const loaded = await webAutomationStore.load();
      expect(loaded.value?.scripts).toEqual([
        normalizeWebAutomationItem(script),
      ]);
      expect(loaded.value?.macros).toEqual([macro]);
      let connection: Connection = {
        id: "fixture-connection",
        name: "Fixture",
        protocol,
        hostname: "fixture.invalid",
        port: protocol === "https" ? 443 : 80,
        isGroup: false,
        createdAt: "2026-09-09T12:00:00Z",
        updatedAt: "2026-09-09T12:00:00Z",
        httpAutomation: normalizeHttpAutomation(undefined),
      } satisfies Connection;
      const settings = {
        sessionQuickActions: {
          sshEnabled: true,
          httpEnabled: true,
          allowWebMacros: false,
          allowWebScriptInjection: false,
          allowWebForceDark: false,
          confirmBeforeScriptRun: true,
        },
      } as GlobalSettings;
      const update = vi.fn(async (next: Connection) => {
        connection = next;
      });
      const browser = renderHook(() =>
        useWebAutomation({
          connection,
          ownerDatabaseId: "fixture-db",
          settings,
          settingsReady: true,
          scopeKey: "fixture-document",
          blocked: false,
          navigationKey: "fixture-navigation",
          iframe: React.createRef<HTMLIFrameElement>(),
          getDocument: () => null,
          updateConnection: update,
        }),
      );
      await waitFor(() =>
        expect(browser.result.current.libraryReady).toBe(true),
      );
      expect(
        browser.result.current.allItems.find((item) => item.id === script.id),
      ).toEqual(script);
      await act(async () => {
        await browser.result.current.favorite(script);
      });
      expect(update).toHaveBeenCalledOnce();
      expect(connection.httpAutomation).toEqual({
        ...normalizeHttpAutomation(undefined),
        items: [{ kind: "script", id: script.id }],
      });
      browser.rerender();
      expect(browser.result.current.favorites).toEqual([script]);
      expect(
        native.invoke.mock.calls.every(([command]) =>
          ["read_macro_library", "compare_and_swap_macro_library"].includes(
            command,
          ),
        ),
      ).toBe(true);
    },
  );
});
