import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionActivityLog,
  getSessionActivityLog,
} from "../../src/utils/monitoring/sessionActivityLog";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";
import type { GlobalSettings } from "../../src/types/settings/settings";
import * as compiler from "../../src/utils/recording/websiteScriptCompiler";
import type {
  DatabaseAutomationApi,
  DatabaseAutomationLibrary,
} from "../../src/types/recording/automationLibrary";
import type {
  BrowserScript,
  WebInteractionMacro,
} from "../../src/types/recording/webAutomation";
const h = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  request: vi.fn(),
  update: vi.fn(),
  lease: 1,
  accessible: true,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: () => () => {},
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "db-a" }),
      captureCurrentDatabaseDataTarget: () => {
        const lease = h.lease;
        return {
          databaseId: "db-a",
          assertAccessible: () => {
            if (!h.accessible || lease !== h.lease)
              throw new Error("Owner access changed");
          },
        };
      },
    }),
  },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
vi.mock("../../src/utils/recording/webAutomationBridge", () => ({
  WebAutomationBridge: class {
    request = h.request;
    cancel = vi.fn();
    handleMessage = vi.fn();
  },
}));
vi.mock("../../src/utils/recording/webAutomationLibrary", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/recording/webAutomationLibrary")
  >()),
  webAutomationStore: { load: h.load },
  saveWebAutomationItem: h.save,
  deleteWebAutomationItem: h.remove,
}));
import {
  useWebAutomation,
  type ScopedWebAutomationItem,
} from "../../src/hooks/protocol/useWebAutomation";
const script: BrowserScript = {
  kind: "script",
  id: "shared-id",
  name: "Fixture",
  description: "",
  code: "document.title",
  createdAt: "2026-09-10T00:00:00Z",
  updatedAt: "2026-09-10T00:00:00Z",
};
const macro: WebInteractionMacro = {
  kind: "macro",
  id: "macro",
  name: "Two steps",
  description: "",
  steps: [
    { kind: "click", selector: "html > body > button:nth-of-type(1)" },
    { kind: "click", selector: "html > body > button:nth-of-type(2)" },
  ],
  createdAt: script.createdAt,
  updatedAt: script.updatedAt,
};
const scope = { kind: "database" as const, databaseId: "db-a" };
const scoped = (
  item: typeof script | typeof macro,
): ScopedWebAutomationItem => ({ ...item, scope });
const empty = (): DatabaseAutomationLibrary => ({
  version: 1,
  revision: 0,
  terminalScripts: {
    customScripts: [],
    modifiedDefaults: [],
    deletedDefaultIds: [],
  },
  terminalMacros: [],
  website: {
    version: 1,
    scripts: [{ ...script, code: "document.URL" }],
    macros: [macro],
  },
  provenance: {
    "website-script:shared-id": { publisher: "Fixture publisher" },
  },
});
beforeEach(() => {
  clearSessionActivityLog();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  h.lease = 1;
  h.accessible = true;
  h.load.mockReset().mockResolvedValue({
    value: { version: 1, scripts: [script], macros: [] },
  });
  h.request.mockReset().mockResolvedValue({});
  h.update.mockResolvedValue(undefined);
});
function mount() {
  let data = empty(),
    revision = 0;
  const read = vi.fn(async () => structuredClone(data));
  const compareAndSwap = vi.fn(
    async (
      _scope: unknown,
      expected: DatabaseAutomationLibrary,
      replacement: DatabaseAutomationLibrary,
    ) => {
      if (JSON.stringify(data) !== JSON.stringify(expected))
        throw new Error("conflict");
      data = structuredClone(replacement);
    },
  );
  const database: DatabaseAutomationApi = {
    scope: { databaseId: "db-a", generation: 1 },
    read,
    compareAndSwap,
  };
  const connection: Connection = {
    id: "connection",
    isGroup: false,
    name: "Fixture",
    protocol: "https",
    hostname: "fixture.example",
    port: 443,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
    httpAutomation: {
      version: 1,
      interactionMacrosEnabled: true,
      scriptInjectionEnabled: true,
      forceDark: false,
      items: [
        { kind: "script", id: script.id },
        { kind: "script", id: script.id, scope },
        {
          kind: "script",
          id: script.id,
          scope: { kind: "database", databaseId: "foreign" },
        },
      ],
    },
  };
  const settings = {
    sessionQuickActions: {
      sshEnabled: true,
      httpEnabled: true,
      allowWebMacros: true,
      allowWebScriptInjection: true,
      allowWebForceDark: true,
      confirmBeforeScriptRun: true,
    },
    macros: { confirmBeforeReplay: true },
  } as GlobalSettings;
  const doc = {
    generation: 1,
    sessionId: "session",
    token: "a".repeat(32),
    sequence: 1,
    navigationToken: null,
    url: "http://127.0.0.1:45000/page",
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConnectionContext.Provider
      value={
        {
          automationLibrary: { ...database, changeRevision: revision },
        } as ConnectionContextType
      }
    >
      {children}
    </ConnectionContext.Provider>
  );
  const view = renderHook(
    () =>
      useWebAutomation({
        activityContext: {
          sessionId: "tab-a",
          connectionId: "connection-a",
          databaseId: "db-a",
        },
        connection,
        ownerDatabaseId: "db-a",
        settings,
        settingsReady: true,
        scopeKey: "db-a:1",
        blocked: false,
        navigationKey: "ready",
        iframe: { current: null },
        getDocument: () => doc,
        updateConnection: h.update,
      }),
    { wrapper },
  );
  return {
    ...view,
    read,
    compareAndSwap,
    database,
    connection,
    doc,
    getData: () => data,
    replace(next: DatabaseAutomationLibrary, notify = false) {
      data = next;
      if (notify) {
        revision++;
        view.rerender();
      }
    },
  };
}
describe("scope-qualified website automation runtime", () => {
  it("keeps the verified database library ready when the separate app-wide store fails", async () => {
    h.load.mockRejectedValue("app macros encryption key unavailable");
    const view = mount();
    await waitFor(() =>
      expect(view.result.current.availableDatabaseScope).toEqual(scope),
    );
    await waitFor(() =>
      expect(view.result.current.error).toMatch(
        /app-wide library's encryption/,
      ),
    );
    expect(view.result.current.libraryReady).toBe(true);
    expect(view.result.current.recordingUnavailableReason).toBeNull();
    expect(
      h.request.mock.calls.filter(([kind]) =>
        ["script", "step", "record-start"].includes(kind),
      ),
    ).toHaveLength(0);
  });
  it("compiles persisted TypeScript locally and sends only emitted JavaScript after confirmation", async () => {
    const view = mount();
    const typed: BrowserScript = {
      ...script,
      language: "typescript",
      code: "const title: string = 'Typed'; document.title = title;",
    };
    view.replace(
      {
        ...view.getData(),
        website: { ...view.getData().website, scripts: [typed] },
      },
      true,
    );
    await waitFor(() =>
      expect(view.result.current.availableDatabaseScope).toEqual(scope),
    );
    await act(async () => view.result.current.requestRun(scoped(typed)));
    expect(
      h.request.mock.calls.filter(([action]) => action === "script"),
    ).toHaveLength(0);
    await act(async () => view.result.current.execute(scoped(typed)));
    const calls = h.request.mock.calls.filter(
      ([action]) => action === "script",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][1].code).toContain("document.title = title");
    expect(calls[0][1].code).not.toContain(": string");
    expect(getSessionActivityLog().map((entry) => entry.code)).toEqual([
      "completed",
      "started",
    ]);
    expect(getSessionActivityLog()[0]).toMatchObject({
      source: "website_script",
      sessionId: "tab-a",
      databaseId: "db-a",
    });
    expect(JSON.stringify(getSessionActivityLog())).not.toContain(
      "document.title",
    );
  });
  it.each(["owner", "source", "page"] as const)(
    "refuses a %s change while lazy TypeScript compilation is pending",
    async (change) => {
      let complete!: (code: string) => void;
      const compile = vi
        .spyOn(compiler, "prepareWebsiteScript")
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              complete = resolve;
            }),
        );
      const view = mount();
      const typed: BrowserScript = {
        ...script,
        language: "typescript",
        code: "const x: number = 1;",
      };
      view.replace(
        {
          ...view.getData(),
          website: { ...view.getData().website, scripts: [typed] },
        },
        true,
      );
      await waitFor(() =>
        expect(view.result.current.availableDatabaseScope).toEqual(scope),
      );
      let running!: Promise<void>;
      act(() => {
        running = view.result.current.execute(scoped(typed));
      });
      await waitFor(() => expect(compile).toHaveBeenCalled());
      if (change === "owner") h.lease++;
      if (change === "page") view.doc.generation++;
      if (change === "source")
        view.replace({
          ...view.getData(),
          website: {
            ...view.getData().website,
            scripts: [{ ...typed, code: "const x: number = 2;" }],
          },
        });
      await act(async () => {
        complete("const x = 1;");
        await running;
      });
      expect(
        h.request.mock.calls.filter(([action]) => action === "script"),
      ).toHaveLength(0);
      expect(view.result.current.error).toBeTruthy();
      expect(getSessionActivityLog().map((entry) => entry.code)).toEqual([
        "failed",
        "started",
      ]);
      expect(
        getSessionActivityLog().every((entry) => entry.databaseId === "db-a"),
      ).toBe(true);
    },
  );
  it("refuses invalid TypeScript without sending it to the page", async () => {
    const view = mount();
    const typed: BrowserScript = {
      ...script,
      language: "typescript",
      code: "const x: = ;",
    };
    view.replace(
      {
        ...view.getData(),
        website: { ...view.getData().website, scripts: [typed] },
      },
      true,
    );
    await waitFor(() =>
      expect(view.result.current.availableDatabaseScope).toEqual(scope),
    );
    await act(async () => view.result.current.execute(scoped(typed)));
    expect(
      h.request.mock.calls.filter(([action]) => action === "script"),
    ).toHaveLength(0);
    expect(view.result.current.error).toMatch(/TypeScript syntax/);
  });
  it("rechecks source after a manual fill-value prompt without sending or storing the supplied value when changed", async () => {
    const view = mount();
    const fill: WebInteractionMacro = {
      ...macro,
      steps: [{ kind: "fill", selector: "html > body > input:nth-of-type(1)" }],
    };
    view.replace(
      {
        ...view.getData(),
        website: { ...view.getData().website, macros: [fill] },
      },
      true,
    );
    await waitFor(() =>
      expect(view.result.current.availableDatabaseScope).toEqual(scope),
    );
    let running!: Promise<void>;
    act(() => {
      running = view.result.current.execute(scoped(fill));
    });
    await waitFor(() => expect(view.result.current.valuePrompt).not.toBeNull());
    view.replace({
      ...view.getData(),
      website: { ...view.getData().website, macros: [] },
    });
    await act(async () => {
      view.result.current.answerValue("ephemeral-user-value");
      await running;
    });
    expect(
      h.request.mock.calls.filter(([action]) => action === "step"),
    ).toHaveLength(0);
    expect(JSON.stringify(view.getData())).not.toContain(
      "ephemeral-user-value",
    );
  });
  it("rechecks app-wide source after confirmation too", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.libraryReady).toBe(true));
    await act(async () => view.result.current.requestRun(script));
    h.load.mockResolvedValueOnce({
      value: {
        version: 1,
        scripts: [{ ...script, code: "document.URL" }],
        macros: [],
      },
    });
    await act(async () => view.result.current.execute(script));
    expect(
      h.request.mock.calls.filter(([action]) => action === "script"),
    ).toHaveLength(0);
    expect(view.result.current.error).toMatch(/changed/);
  });
  it("keeps same-ID app and database favorites distinct and never substitutes a foreign reference", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.allItems).toHaveLength(3));
    expect(view.result.current.favorites).toHaveLength(2);
    expect(
      view.result.current.favorites.map(
        (item) => item.kind === "script" && item.code,
      ),
    ).toEqual(["document.title", "document.URL"]);
    await act(async () =>
      view.result.current.favorite(scoped({ ...script, code: "document.URL" })),
    );
    expect(h.update.mock.calls[0][0].httpAutomation.items).toEqual([
      view.connection.httpAutomation!.items[0],
      view.connection.httpAutomation!.items[2],
    ]);
  });
  it("re-resolves database source after confirmation and blocks changed/deleted items", async () => {
    const view = mount();
    await waitFor(() =>
      expect(view.result.current.availableDatabaseScope).toEqual(scope),
    );
    const item = scoped({ ...script, code: "document.URL" });
    await act(async () => view.result.current.requestRun(item));
    expect(view.result.current.pendingRun).toEqual(item);
    view.replace({
      ...view.getData(),
      website: { version: 1, scripts: [], macros: [macro] },
    });
    await act(async () => view.result.current.execute(item));
    expect(
      h.request.mock.calls.filter(([action]) => action === "script"),
    ).toHaveLength(0);
    expect(view.result.current.error).toMatch(/changed|deleted/);
    expect(getSessionActivityLog()).toHaveLength(0);
  });
  it("runs exact persisted database script without passing wrapper scope to payload validation or the page", async () => {
    const view = mount();
    await waitFor(() =>
      expect(view.result.current.availableDatabaseScope).toEqual(scope),
    );
    await act(async () =>
      view.result.current.execute(scoped({ ...script, code: "document.URL" })),
    );
    expect(h.request).toHaveBeenCalledWith("script", { code: "document.URL" });
    expect(view.result.current.error).toBeNull();
  });
  it("rechecks the persisted macro before every step and stops when it changes", async () => {
    const view = mount();
    await waitFor(() =>
      expect(view.result.current.availableDatabaseScope).toEqual(scope),
    );
    h.request.mockImplementation(async (action) => {
      if (action === "step")
        view.replace({
          ...view.getData(),
          website: { ...view.getData().website, macros: [] },
        });
      return {};
    });
    await act(async () => view.result.current.execute(scoped(macro)));
    expect(
      h.request.mock.calls.filter(([action]) => action === "step"),
    ).toHaveLength(1);
    expect(view.result.current.error).toMatch(/changed|deleted/);
  });
  it("scope/lease revocation clears confirmation and prevents replay even after the same database reopens", async () => {
    const view = mount();
    await waitFor(() =>
      expect(view.result.current.availableDatabaseScope).toEqual(scope),
    );
    await act(async () => view.result.current.requestRun(scoped(macro)));
    h.lease++;
    view.database.scope = { databaseId: "db-a", generation: 2 };
    view.rerender();
    expect(view.result.current.pendingRun).toBeNull();
    expect(
      h.request.mock.calls.filter(([action]) => action === "step"),
    ).toHaveLength(0);
  });
  it("saves/deletes through database CAS, preserves macros/provenance and never writes the app store", async () => {
    const view = mount();
    await waitFor(() =>
      expect(view.result.current.availableDatabaseScope).toEqual(scope),
    );
    const original = { ...script, code: "document.URL" };
    await act(async () =>
      expect(
        await view.result.current.save(
          scoped({ ...original, name: "Edited" }),
          scoped(original),
        ),
      ).toBe(true),
    );
    expect(view.getData().website.scripts[0].name).toBe("Edited");
    expect(view.getData().website.macros).toEqual([macro]);
    expect(view.getData().provenance["website-script:shared-id"]).toBeTruthy();
    expect(view.getData().website.scripts[0]).not.toHaveProperty("scope");
    await act(async () =>
      expect(
        await view.result.current.remove(
          scoped({ ...original, name: "Edited" }),
        ),
      ).toBe(true),
    );
    expect(view.getData().website.scripts).toEqual([]);
    expect(view.getData().website.macros).toEqual([macro]);
    expect(view.getData().provenance).toEqual({});
    expect(h.save).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
  it("refreshes database rows on revision changes without turning missing DB references into app items", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.favorites).toHaveLength(2));
    view.replace(
      { ...view.getData(), website: { version: 1, scripts: [], macros: [] } },
      true,
    );
    await waitFor(() => expect(view.result.current.favorites).toHaveLength(1));
    expect(view.result.current.favorites[0]).toEqual(script);
    await act(async () =>
      view.result.current.requestRun({
        ...script,
        scope: { kind: "database", databaseId: "foreign" },
      }),
    );
    expect(view.result.current.pendingRun).toBeNull();
    expect(view.result.current.error).toMatch(/exact owning database/);
  });
});
