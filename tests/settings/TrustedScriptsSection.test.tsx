import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrustedScriptsSection } from "../../src/components/SettingsDialog/sections/macros/TrustedScriptsSection";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import { bulkScriptsStore } from "../../src/hooks/ssh/bulkScriptLibrary";
import type { Connection } from "../../src/types/connection/connection";
import type { AutomationScope } from "../../src/types/recording/automationLibrary";
import {
  bulkScriptRunContent,
  digestRunContent,
  sshMacroRunContent,
  sshScriptCommand,
  sshScriptRunContent,
  type ScriptTrustEntry,
} from "../../src/utils/recording/scriptRunTrust";
import { resolveSavedConnectionTrustBinding } from "../../src/utils/recording/scriptRunTrustBinding";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../src/utils/storage/appDataJsonStore";
import {
  SENTINELS,
  TRUST_TEST_TIME,
  createScriptTrustTestBackend,
  fakeDigest,
  scriptTrustTauriEvents as bus,
  type ScriptTrustTestBackend,
} from "../recording/scriptTrustTestBackend";

vi.mock("@tauri-apps/api/event", async () =>
  (
    await import("../recording/scriptTrustTestBackend")
  ).scriptTrustTauriEvents.module(),
);

type Payload = Record<string, unknown> & { id: string };
const library = vi.hoisted(() => ({
  ready: true,
  databaseId: null as string | null,
  entries: new Map<string, Payload[]>(),
  reads: [] as string[],
  api: null as unknown,
}));
vi.mock("../../src/hooks/recording/useAutomationLibraryApi", () => ({
  useAutomationLibraryApi: () => ({
    api: library.api,
    databaseScope: library.databaseId
      ? { databaseId: library.databaseId, generation: 1 }
      : null,
    ready: library.ready,
    diagnostic: null,
    retry: () => {},
    settingsReady: true,
    accessEpoch: 1,
    databaseRevision: 0,
  }),
}));
// One object for every render, as the real hook's memoised adapter is.
library.api = {
  read: async (scope: AutomationScope, family: string) => {
    const key = `${scope.kind === "app" ? "app" : scope.databaseId}:${family}`;
    library.reads.push(key);
    return {
      scope,
      family,
      receipt: "r",
      entries: (library.entries.get(key) ?? []).map((payload) => ({
        family,
        payload,
      })),
    };
  },
};

const script = (overrides: Partial<Payload> = {}): Payload => ({
  id: "script-1",
  name: "Disk report",
  description: "",
  script: `#!/bin/bash\n${SENTINELS.script}`,
  language: "bash",
  category: "Custom",
  osTags: [],
  createdAt: TRUST_TEST_TIME,
  updatedAt: TRUST_TEST_TIME,
  ...overrides,
});
const macro = (overrides: Partial<Payload> = {}): Payload => ({
  id: "macro-1",
  name: "Restart service",
  steps: [{ command: SENTINELS.step, delayMs: 100, sendNewline: true }],
  createdAt: TRUST_TEST_TIME,
  updatedAt: TRUST_TEST_TIME,
  ...overrides,
});

const scriptDigest = (payload: Payload) =>
  digestRunContent(
    "ssh-script",
    sshScriptRunContent(
      payload.language as string,
      sshScriptCommand(payload.script as string),
    ),
  );
const macroDigest = (payload: Payload) =>
  digestRunContent(
    "ssh-macro",
    sshMacroRunContent(
      payload.steps as {
        command: string;
        delayMs: number;
        sendNewline: boolean;
      }[],
    ),
  );

const row = (overrides: Partial<Connection> = {}): Connection =>
  ({
    id: "conn-1",
    name: "Production box",
    protocol: "ssh",
    hostname: SENTINELS.host,
    port: 22,
    username: SENTINELS.user,
    isGroup: false,
    createdAt: TRUST_TEST_TIME,
    updatedAt: TRUST_TEST_TIME,
    ...overrides,
  }) as Connection;

const contextOf = (
  connections: Connection[],
  databaseId = "db-1",
): ConnectionContextType =>
  ({
    state: { connections },
    databaseAvailability: { status: "ready", databaseId, generation: 3 },
  }) as unknown as ConnectionContextType;

const bindingOf = async (connection: Connection, databaseId = "db-1") => {
  const binding = await resolveSavedConnectionTrustBinding(
    contextOf([connection], databaseId),
    { databaseId, connectionId: connection.id },
  );
  if (!binding) throw new Error("test binding");
  return binding;
};

const entry = (overrides: Partial<ScriptTrustEntry>): ScriptTrustEntry => ({
  kind: "ssh-script",
  library: { kind: "app" },
  subjectId: "script-1",
  contentDigest: fakeDigest("x"),
  scope: "everywhere",
  risk: "standard",
  grantedAt: TRUST_TEST_TIME,
  ...overrides,
});

let backend: ScriptTrustTestBackend;
const seed = (...entries: ScriptTrustEntry[]) =>
  backend.seed({ version: 1, entries });

const mount = (context?: ConnectionContextType) =>
  render(
    <ConnectionContext.Provider value={context}>
      <TrustedScriptsSection />
    </ConnectionContext.Provider>,
  );

const rows = () => screen.queryAllByTestId("trusted-scripts-row");
const rowNamed = (name: string) => {
  const found = rows().find(
    (item) =>
      within(item).getByTestId("trusted-scripts-name").textContent === name,
  );
  if (!found) throw new Error(`no row ${name}`);
  return found;
};
const stateOf = (item: HTMLElement) =>
  within(item).getByTestId("trusted-scripts-state").getAttribute("data-state");

beforeEach(() => {
  backend = createScriptTrustTestBackend();
  backend.install();
  bus.reset();
  library.ready = true;
  library.databaseId = null;
  library.entries = new Map();
  library.reads = [];
  vi.spyOn(bulkScriptsStore, "load").mockResolvedValue({
    value: null,
    sanitized: false,
  });
});
afterEach(() => {
  backend.uninstall();
  vi.restoreAllMocks();
});

describe("TrustedScriptsSection", () => {
  it("lists each entry with its name, kind, scope, state, date and danger mark", async () => {
    const connection = row();
    const appScript = script();
    const dbMacro = macro();
    library.databaseId = "db-1";
    library.entries.set("app:terminal-script", [appScript]);
    library.entries.set("db-1:terminal-macro", [dbMacro]);
    seed(
      entry({ contentDigest: await scriptDigest(appScript) }),
      entry({
        kind: "ssh-macro",
        library: { kind: "database", databaseId: "db-1" },
        subjectId: "macro-1",
        contentDigest: await macroDigest(dbMacro),
        scope: "connection",
        connection: await bindingOf(connection),
        risk: "destructive",
      }),
    );
    mount(contextOf([connection]));
    await waitFor(() => expect(rows()).toHaveLength(2));
    await waitFor(() =>
      expect(stateOf(rowNamed("Restart service"))).toBe("trusted"),
    );

    const first = rowNamed("Disk report");
    expect(first.textContent).toContain("SSH script");
    expect(first.textContent).toContain("Everywhere");
    expect(first.textContent).toContain("Runs without asking");
    expect(stateOf(first)).toBe("trusted");
    expect(first.querySelector("time")?.getAttribute("dateTime")).toBe(
      TRUST_TEST_TIME,
    );
    expect(
      within(first).queryByTestId("trusted-scripts-destructive"),
    ).toBeNull();

    const second = rowNamed("Restart service");
    expect(second.textContent).toContain("Terminal macro");
    expect(second.textContent).toContain("On Production box");
    expect(
      within(second).getByTestId("trusted-scripts-destructive").textContent,
    ).toContain("Destructive");
  });

  it("names a bulk script from the saved library and the bundled ones", async () => {
    vi.mocked(bulkScriptsStore.load).mockResolvedValue({
      value: {
        version: 2,
        active: [
          {
            id: "bulk-7",
            name: "Uptime everywhere",
            description: "",
            script: "uptime",
            category: "Custom",
            type: "custom",
            risk: "standard",
          },
        ],
        trash: [],
        config: {
          runConfirmation: "always",
          deleteConfirmation: "permanent-only",
        },
      } as never,
      sanitized: false,
    });
    seed(
      entry({
        kind: "bulk-script",
        subjectId: "bulk-7",
        contentDigest: await digestRunContent(
          "bulk-script",
          bulkScriptRunContent("uptime"),
        ),
      }),
      entry({
        kind: "bulk-script",
        subjectId: "default-1",
        contentDigest: fakeDigest("old"),
      }),
    );
    mount();
    await waitFor(() => expect(rows()).toHaveLength(2));
    await waitFor(() =>
      expect(stateOf(rowNamed("Uptime everywhere"))).toBe("trusted"),
    );
    expect(rowNamed("Uptime everywhere").textContent).toContain("Bulk script");
    expect(stateOf(rowNamed("System Info"))).toBe("changed");
  });

  it("shows an entry whose script is gone as not in the library", async () => {
    library.entries.set("app:terminal-script", []);
    seed(entry({ subjectId: "gone-1" }));
    mount();
    await waitFor(() =>
      expect(stateOf(rowNamed("Not in the library"))).toBe("missing"),
    );
    expect(
      within(rowNamed("Not in the library"))
        .getByTestId("trusted-scripts-revoke")
        .getAttribute("aria-label"),
    ).toBe("Revoke trust for Not in the library");
  });

  it("says a script changed since it was trusted, and that it runs again once it is back", async () => {
    const original = script();
    seed(entry({ contentDigest: await scriptDigest(original) }));
    library.entries.set("app:terminal-script", [
      script({ script: `${original.script as string}!` }),
    ]);
    mount();
    await waitFor(() =>
      expect(stateOf(rowNamed("Disk report"))).toBe("changed"),
    );
    expect(rowNamed("Disk report").textContent).toContain(
      "Changed since it was trusted: asks again",
    );
    library.entries.set("app:terminal-script", [original]);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: "recording.managed-scripts" },
        }),
      );
    });
    await waitFor(() =>
      expect(stateOf(rowNamed("Disk report"))).toBe("trusted"),
    );
  });

  it("says a connection grant asks again when the connection's address changed", async () => {
    const appScript = script();
    library.entries.set("app:terminal-script", [appScript]);
    seed(
      entry({
        contentDigest: await scriptDigest(appScript),
        scope: "connection",
        connection: await bindingOf(row()),
      }),
    );
    mount(contextOf([row({ port: 2222 })]));
    await waitFor(() =>
      expect(stateOf(rowNamed("Disk report"))).toBe("changed"),
    );
  });

  it("names a connection of another database without looking it up", async () => {
    const appScript = script();
    library.entries.set("app:terminal-script", [appScript]);
    seed(
      entry({
        contentDigest: await scriptDigest(appScript),
        scope: "connection",
        connection: await bindingOf(row(), "db-9"),
      }),
    );
    mount(contextOf([row()]));
    await waitFor(() =>
      expect(stateOf(rowNamed("Disk report"))).toBe("unknown"),
    );
    expect(rowNamed("Disk report").textContent).toContain(
      "A connection in another database",
    );
  });

  it("never shows script text, a step, a host, a user or a domain (S8)", async () => {
    const connection = row({ domain: SENTINELS.domain });
    const appScript = script();
    const appMacro = macro();
    library.entries.set("app:terminal-script", [appScript]);
    library.entries.set("app:terminal-macro", [appMacro]);
    seed(
      entry({
        contentDigest: await scriptDigest(appScript),
        scope: "connection",
        connection: await bindingOf(connection),
      }),
      entry({
        kind: "ssh-macro",
        subjectId: "macro-1",
        contentDigest: await macroDigest(appMacro),
      }),
    );
    const view = mount(contextOf([connection]));
    await waitFor(() =>
      expect(stateOf(rowNamed("Disk report"))).toBe("trusted"),
    );
    fireEvent.click(screen.getByTestId("trusted-scripts-revoke-all"));
    const html = document.body.innerHTML;
    for (const text of [
      SENTINELS.script,
      SENTINELS.step,
      SENTINELS.host,
      SENTINELS.user,
      SENTINELS.domain,
    ])
      expect(html).not.toContain(text);
    expect(html).not.toContain("sha256:");
    view.unmount();
  });

  it("revokes one entry from its row, and the row goes", async () => {
    const appScript = script();
    library.entries.set("app:terminal-script", [
      appScript,
      script({ id: "script-2", name: "Load average" }),
    ]);
    seed(
      entry({ contentDigest: await scriptDigest(appScript) }),
      entry({ subjectId: "script-2" }),
    );
    mount();
    await waitFor(() => expect(rows()).toHaveLength(2));
    await waitFor(() => rowNamed("Load average"));
    const button = within(rowNamed("Disk report")).getByTestId(
      "trusted-scripts-revoke",
    );
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe(
      "Revoke trust for Disk report",
    );
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(backend.stored().entries.map((item) => item.subjectId)).toEqual([
      "script-2",
    ]);
    expect(rows()[0].textContent).toContain("Load average");
  });

  it("asks before revoking everything; Cancel keeps every entry", async () => {
    seed(entry({}), entry({ subjectId: "script-2" }));
    library.entries.set("app:terminal-script", [
      script(),
      script({ id: "script-2", name: "Load average" }),
    ]);
    mount();
    await waitFor(() => expect(rows()).toHaveLength(2));
    const before = backend.raw();
    const all = screen.getByTestId("trusted-scripts-revoke-all");
    expect(all.tagName).toBe("BUTTON");
    expect(all.textContent).toBe("Revoke all");
    fireEvent.click(all);
    expect(screen.getByTestId("confirm-dialog")).toBeTruthy();
    expect(backend.writes()).toBe(0);
    fireEvent.click(screen.getByTestId("confirm-no"));
    await waitFor(() =>
      expect(screen.queryByTestId("confirm-dialog")).toBeNull(),
    );
    expect(backend.raw()).toBe(before);
    expect(rows()).toHaveLength(2);

    fireEvent.click(screen.getByTestId("trusted-scripts-revoke-all"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-yes"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("trusted-scripts-empty")).toBeTruthy(),
    );
    expect(backend.stored()).toStrictEqual({ version: 1, entries: [] });
  });

  it("says when the record cannot be read, and Reset repairs it", async () => {
    backend.setRaw("{not json");
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The list of trusted scripts could not be read. Nothing is trusted.",
    );
    expect(screen.queryByTestId("trusted-scripts-list")).toBeNull();
    expect(backend.raw()).toBe("{not json");
    await act(async () => {
      fireEvent.click(screen.getByTestId("trusted-scripts-reset"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("trusted-scripts-empty")).toBeTruthy(),
    );
    expect(backend.stored()).toStrictEqual({ version: 1, entries: [] });
  });

  it("offers no Reset when the record is merely unreachable", async () => {
    backend.uninstall();
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByTestId("trusted-scripts-reset")).toBeNull();
    expect(screen.getByTestId("trusted-scripts-retry").tagName).toBe("BUTTON");
  });

  it("reports a failed revoke and keeps the row", async () => {
    seed(entry({}));
    library.entries.set("app:terminal-script", [script()]);
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    backend.reject("write", 5);
    await act(async () => {
      fireEvent.click(screen.getByTestId("trusted-scripts-revoke"));
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "could not be revoked",
      ),
    );
    expect(backend.stored().entries).toHaveLength(1);
  });

  it("shows an empty list in words", async () => {
    mount();
    expect(
      (await screen.findByTestId("trusted-scripts-empty")).textContent,
    ).toContain("No script is trusted");
    expect(screen.queryByTestId("trusted-scripts-revoke-all")).toBeNull();
  });

  it("uses theme tokens only, never a literal colour", () => {
    const source = readFileSync(
      "src/components/SettingsDialog/sections/macros/TrustedScriptsSection.tsx",
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(source).not.toMatch(
      /\b(text|bg|border)-(red|green|blue|yellow|amber|orange|gray|slate|zinc|white|black)\b/,
    );
  });
});
