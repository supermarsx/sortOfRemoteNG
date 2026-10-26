import { webcrypto } from "node:crypto";
import { trustedClick } from "../helpers/trustedClick";
import { revokeAllScriptTrust } from "../../src/utils/recording/scriptRunTrustStore";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebTerminal } from "../../src/components/ssh/WebTerminal";
import { PromptHost } from "../../src/components/ui/dialogs/PromptHost";
import {
  getPromptSnapshot,
  resetPromptQueueForTests,
} from "../../src/utils/prompts/promptQueue";
import {
  sshMacroReplayPrompt,
  sshScriptRunPrompt,
  terminalPastePrompt,
} from "../../src/utils/prompts/runPromptRequests";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { resolveScriptTrustBinding } from "../../src/utils/recording/scriptRunTrustBinding";
import type { ManagedScript } from "../../src/components/recording/scriptManager/shared";
import type { TerminalMacro } from "../../src/types/recording/macroTypes";

// The SSH terminal's three confirmations (run a script, replay a macro, paste
// risky text) through the real prompt queue, host and dialog. Nothing here
// touches the OS clipboard: pasted text arrives in a synthetic paste event or
// from the fake `navigator.clipboard` installed below.

const h = vi.hoisted(() => {
  const disposable = () => ({ dispose: vi.fn() });
  const terminal = {
    loadAddon: vi.fn(),
    open: vi.fn(),
    focus: vi.fn(),
    write: vi.fn((_data: string, done?: () => void) => done?.()),
    writeln: vi.fn(),
    onData: vi.fn(disposable),
    onBell: vi.fn(disposable),
    onRender: vi.fn(disposable),
    onWriteParsed: vi.fn(disposable),
    scrollToBottom: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
    getSelection: vi.fn(() => ""),
    options: {} as Record<string, unknown>,
    buffer: { active: { length: 0, getLine: () => undefined } },
    cols: 80,
    rows: 24,
    element: { isConnected: true },
    _core: {
      renderService: {
        dimensions: { css: { cell: { width: 9, height: 17 } } },
      },
    },
  };
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    update: vi.fn(),
    remove: vi.fn(),
  });
  return {
    contextRevision: 0,
    contexts: [] as unknown[],
    terminal,
    toast,
    invoke: vi.fn(),
    dispatch: vi.fn(),
    listeners: new Map<string, (event: { payload: unknown }) => void>(),
    settings: null as Record<string, unknown> | null,
    vaultUsername: "vault-account",
    library: {
      scripts: [] as unknown[],
      macros: [] as unknown[],
    },
    clipboard: {
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async (_text: string) => undefined),
    },
    connection: {
      id: "flow-connection",
      name: "web-01",
      protocol: "ssh",
      hostname: "192.0.2.10",
      port: 22,
      username: "deploy",
      password: "fixture-password",
      authType: "password",
      isGroup: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as Connection,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => h.invoke(...args),
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    event: string,
    callback: (event: { payload: unknown }) => void,
  ) => {
    h.listeners.set(event, callback);
    return () => {
      if (h.listeners.get(event) === callback) h.listeners.delete(event);
    };
  },
  emit: vi.fn(async () => undefined),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function () {
    return h.terminal;
  }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function () {
    return { fit: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn(function () {
    return {};
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: h.toast }),
}));
vi.mock("../../src/contexts/useConnections", () => {
  let key = "";
  let context: unknown;
  return {
    useConnections: () => {
      const nextKey = JSON.stringify([h.connection, h.contextRevision]);
      if (!h.contexts.length || key !== nextKey) {
        key = nextKey;
        // Match the real provider's memoized value and immutable saved-row
        // publication. Endpoint edits in the tests still publish a new row.
        context = {
          state: { connections: [{ ...h.connection }], sessions: [] },
          databaseAvailability: {
            status: "ready",
            databaseId: "flow-database",
            generation: 1 + h.contextRevision,
          },
          dispatch: h.dispatch,
        };
      }
      h.contexts.push(context);
      return context;
    },
  };
});
vi.mock("../../src/contexts/SettingsContext", async (original) => {
  const actual =
    await original<typeof import("../../src/contexts/SettingsContext")>();
  return {
    ...actual,
    useSettings: () => ({
      settings: h.settings ?? actual.defaultSettings,
      settingsReady: true,
      updateSettings: vi.fn(),
      reloadSettings: vi.fn(),
    }),
  };
});
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => h.invoke,
}));
vi.mock("../../src/hooks/security/useRuntimeCredentialVault", () => ({
  useRuntimeCredentialVault: () => async () =>
    h.connection.credentialSource?.kind === "vault"
      ? {
          facets: { username: h.vaultUsername, password: "fixture-password" },
          assertCurrent: () => {},
        }
      : null,
}));
vi.mock("../../src/utils/session/runtimeConnectionRegistry", () => ({
  resolveRuntimeConnection: () => h.connection,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "flow-database" }),
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: "flow-database",
        assertAccessible: () => undefined,
      }),
      onCurrentDatabaseChange: () => () => {},
      onDatabaseAccessChange: () => () => {},
    }),
  },
}));
vi.mock("../../src/utils/auth/trustStore", () => ({
  formatFingerprint: (fingerprint: string) => fingerprint,
  getStoredIdentity: () => undefined,
  isCertificateTrustRecordType: () => false,
  resolveEffectiveTrustPolicy: () => "always-trust",
  trustIdentity: vi.fn(),
  verifyIdentity: vi.fn(),
}));
// The app library has its own adapter tests. Here it is the list the picker
// shows, with the same "is it still what was reviewed" check as the real one.
vi.mock("../../src/hooks/recording/useTerminalAppLibrary", () => {
  const review = (list: () => unknown[]) => (item: unknown) => {
    const reviewed = JSON.stringify(item);
    return async () => {
      if (!list().some((entry) => JSON.stringify(entry) === reviewed))
        throw new Error("The saved entry changed.");
    };
  };
  return {
    useTerminalAppLibrary: () => ({
      available: true,
      error: null,
      scripts: h.library.scripts,
      macros: h.library.macros,
      refresh: async () => undefined,
      captureMacroSave: () => async () => undefined,
      reviewScript: review(() => h.library.scripts),
      reviewMacro: review(() => h.library.macros),
    }),
  };
});

const session: ConnectionSession = {
  ownerDatabaseId: "flow-database",
  id: "flow-session",
  connectionId: h.connection.id,
  name: "web-01",
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ssh",
  hostname: h.connection.hostname,
};

const diskUsage: ManagedScript = {
  id: "script-disk",
  name: "Disk usage",
  description: "Free space per file system",
  script: "#!/bin/bash\ndf -h\ndu -sh /var/log",
  language: "bash",
  category: "System",
  osTags: ["linux"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const uptime: ManagedScript = {
  ...diskUsage,
  id: "script-uptime",
  name: "Uptime",
  description: "How long the host has been up",
  script: "uptime",
};
const restartWeb: TerminalMacro = {
  id: "macro-restart",
  name: "Restart web",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  steps: [
    { command: "sudo systemctl restart nginx", delayMs: 0, sendNewline: true },
    { command: "systemctl is-active nginx", delayMs: 0, sendNewline: false },
  ],
};

/** The session as the terminal names it to the prompt builders. */
const where = { name: session.name, hostname: session.hostname };

/** Everything that reached the remote shell. */
const sent = () =>
  h.invoke.mock.calls.filter(
    ([command]) => command === "send_ssh_input" || command === "execute_script",
  );

const Tree = ({
  terminal = true,
  host = true,
  activeSession = session,
}: {
  terminal?: boolean;
  host?: boolean;
  activeSession?: ConnectionSession;
}) => (
  <>
    {host && <PromptHost />}
    {terminal && <WebTerminal session={activeSession} />}
  </>
);

const mount = async (
  props: { host?: boolean; activeSession?: ConnectionSession } = {},
) => {
  const view = render(<Tree {...props} />);
  await waitFor(() =>
    expect(screen.getByText("Connected")).toBeInTheDocument(),
  );
  // The terminal focuses itself once when it opens; count only what follows.
  await waitFor(() => expect(h.terminal.open).toHaveBeenCalled());
  // xterm keeps its own input inside the terminal surface and focus() lands
  // there. The mock gets the same, so the tests can see who holds the keyboard.
  const input = document.createElement("textarea");
  input.setAttribute("data-testid", "terminal-input");
  screen.getByTestId("terminal-canvas").appendChild(input);
  h.terminal.focus.mockImplementation(() => input.focus());
  h.terminal.focus.mockClear();
  return view;
};
const terminalInput = () => screen.getByTestId("terminal-input");

const prompt = () => screen.queryByTestId("app-prompt");
const picker = () => screen.queryByTestId("web-terminal-script-selector-modal");
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

const openPicker = async () => {
  // A click puts the keyboard on the toolbar button, as in the app.
  const opener = screen.getByRole("button", { name: "Run Script" });
  opener.focus();
  fireEvent.click(opener);
  await waitFor(() => expect(picker()).toBeInTheDocument());
  // The picker takes the keyboard one frame after it opens. A user picks a
  // row long after that; a test must wait for it, or that frame lands between
  // the pick and the prompt and the picker's focus looks like the opener's.
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
};
/** Picks a script the way a user does: the row has the keyboard when it is clicked. */
const pickScript = async (name: string) => {
  if (!picker()) await openPicker();
  const row = screen.getByText(name).closest("button")!;
  row.focus();
  fireEvent.click(row);
  return row;
};
const pickMacro = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Replay Macro" }));
  const popover = await screen.findByTestId("web-terminal-macro-popover");
  const item = Array.from(popover.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(name),
  )!;
  item.focus();
  fireEvent.click(item);
};
/** A paste the terminal receives with its own text: no clipboard is read. */
const pasteText = async (text: string) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  await act(async () => {
    screen.getByTestId("terminal-canvas").dispatchEvent(event);
    await Promise.resolve();
  });
};
/** A real mouse click (`detail` 1), not one a key press synthesises. */
const mouseClick = (element: Element) =>
  fireEvent.click(element, { detail: 1 });
const confirmPrompt = () =>
  act(async () => {
    mouseClick(screen.getByTestId("app-prompt-confirm"));
  });
const cancelPrompt = () =>
  act(async () => {
    mouseClick(screen.getByTestId("app-prompt-cancel"));
  });
/**
 * The text the terminal handed to the queue for review, exactly as passed in.
 * How the dialog draws it (hidden characters, a trailing line feed) is the
 * dialog's business and has its own tests.
 */

const waitForPickerToClose = () =>
  waitFor(() => expect(picker()).not.toBeInTheDocument());

beforeEach(() => {
  resetPromptQueueForTests();
  h.contextRevision = 0;
  h.contexts = [];
  h.connection.port = 22;
  h.connection.username = "deploy";
  h.vaultUsername = "vault-account";
  delete (h.connection as Connection).credentialSource;
  vi.clearAllMocks();
  localStorage.clear();
  h.listeners.clear();
  h.settings = null;
  h.library.scripts = [diskUsage, uptime];
  h.library.macros = [restartWeb];
  h.invoke.mockImplementation(async (command: string) => {
    if (command === "read_app_data")
      throw new Error("No native trust store in this legacy fixture");
    if (command === "connect_ssh") return "backend-flow-1";
    if (command === "start_shell") return "shell-flow-1";
    if (command === "execute_script")
      return { stdout: "", stderr: "", exitCode: 0 };
    return undefined;
  });
  h.clipboard.readText.mockResolvedValue("");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: h.clipboard,
  });
  // The webview's own box: every test below ends by proving it stayed shut.
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: vi.fn(() => true),
  });
});

afterEach(() => {
  // Unmount first: a failed check here must not leave this test's terminal
  // in the document for the next one.
  cleanup();
  expect(vi.mocked(window.confirm)).not.toHaveBeenCalled();
});

let record: string | null = null;
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  record = null;
  const original = h.invoke.getMockImplementation()!;
  h.invoke.mockImplementation(
    async (
      command: string,
      args: { expected?: string | null; replacement?: string },
    ) => {
      if (command === "read_app_data") return record;
      if (command === "compare_and_swap_app_data") {
        if (record !== args.expected) return false;
        record = args.replacement!;
        return true;
      }
      return original(command, args);
    },
  );
});
const selectTrust = async (choice: string) => {
  await screen.findByTestId("app-prompt");
  await act(async () => {
    trustedClick(
      screen
        .getAllByTestId("app-prompt-choice")
        .find((radio) => radio.getAttribute("value") === choice)!,
    );
  });
};
const grant = async (choice: string) => {
  await selectTrust(choice);
  await new Promise((resolve) => setTimeout(resolve, 320));
  await act(async () => {
    trustedClick(screen.getByTestId("app-prompt-confirm"));
  });
  await waitForPickerToClose();
};
describe("lasting SSH script trust through the real dialog and store", () => {
  it("keeps provider identity during local renders while endpoint hashing is pending", async () => {
    const view = await mount();
    await pickScript("Uptime");
    await grant("connection");
    const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
    const pending: (() => void)[] = [];
    const spy = vi
      .spyOn(webcrypto.subtle, "digest")
      .mockImplementation(async (algorithm, data) => {
        const bytes = new Uint8Array(data as ArrayBuffer);
        if (
          new TextDecoder()
            .decode(bytes)
            .includes("sorng.run-trust.endpoint.v1")
        ) {
          await new Promise<void>((resolve) => pending.push(resolve));
        }
        return digest(algorithm, data);
      });
    try {
      // A real availability publication restarts binding; terminal-local renders
      // must not manufacture additional provider publications while it is pending.
      h.contextRevision += 1;
      view.rerender(<Tree />);
      await waitFor(() => expect(pending).toHaveLength(1));
      const publishedContext = h.contexts.at(-1);
      view.rerender(<Tree />);
      view.rerender(<Tree />);
      expect(h.contexts.at(-1)).toBe(publishedContext);
      expect(pending).toHaveLength(1);
      await act(async () => {
        pending.splice(0).forEach((resolve) => resolve());
        await Promise.resolve();
      });
      spy.mockRestore();
      await openPicker();
      expect(
        await screen.findByTestId("trusted-script-mark"),
      ).toHaveAccessibleName(/this connection/);
      expect(sent()).toHaveLength(1);
    } finally {
      spy.mockRestore();
      await act(async () => pending.splice(0).forEach((resolve) => resolve()));
    }
  });
  it("asks again without connection trust when the same vault reference has an unverifiable account", async () => {
    h.connection.credentialSource = {
      kind: "vault",
      credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    await mount();
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    expect(
      screen
        .getAllByTestId("app-prompt-choice")
        .map((radio) => radio.getAttribute("value")),
    ).toEqual(["ask", "session", "everywhere"]);
    await confirmPrompt();
    await waitForPickerToClose();
    h.vaultUsername = "changed-vault-account";
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    expect(
      screen
        .getAllByTestId("app-prompt-choice")
        .some((radio) => radio.getAttribute("value") === "connection"),
    ).toBe(false);
    expect(sent()).toHaveLength(1);
  });
  it("offers session/everywhere but no connection grant for a reattached actor with no verified original endpoint", async () => {
    const original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command, args) =>
      command === "is_session_alive"
        ? true
        : command === "get_shell_info"
          ? "existing-shell"
          : original(command, args),
    );
    await mount({
      activeSession: {
        ...session,
        backendSessionId: "existing-backend",
        shellId: "existing-shell",
      },
    });
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    const values = screen
      .getAllByTestId("app-prompt-choice")
      .map((radio) => radio.getAttribute("value"));
    expect(values).toContain("everywhere");
    expect(values).toContain("session");
    expect(values).not.toContain("connection");
    expect(
      h.invoke.mock.calls.some(([command]) => command === "connect_ssh"),
    ).toBe(false);
  });
  it.each(["port", "username", "credential-reference"])(
    "does not apply newer same-host %s trust to an actor opened from the old saved endpoint",
    async (change) => {
      await mount();
      await pickScript("Uptime");
      await grant("connection");
      if (change === "port") h.connection.port = 2222;
      else if (change === "username") h.connection.username = "other-user";
      else
        Object.assign(h.connection, {
          credentialSource: {
            kind: "vault",
            credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        });
      const newer = await resolveScriptTrustBinding(
        {
          state: { connections: [h.connection] },
          databaseAvailability: {
            status: "ready",
            databaseId: "flow-database",
            generation: 1,
          },
        },
        session,
      );
      const stored = JSON.parse(record!);
      stored.entries[0].connection = newer;
      record = JSON.stringify(stored);
      await pickScript("Uptime");
      await screen.findByTestId("app-prompt");
      expect(sent()).toHaveLength(1);
      expect(
        screen
          .getAllByTestId("app-prompt-choice")
          .some((radio) => radio.getAttribute("value") === "connection"),
      ).toBe(false);
    },
  );
  it("offers four answers; a default confirm asks again and stores nothing", async () => {
    await mount();
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    expect(screen.getAllByTestId("app-prompt-choice")).toHaveLength(4);
    expect(screen.getAllByTestId("app-prompt-choice")[0]).toBeChecked();
    await confirmPrompt();
    await waitForPickerToClose();
    expect(record).toBeNull();
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    expect(prompt()).toBeInTheDocument();
  });
  it.each(["connection", "everywhere"])(
    "grants %s, runs once, marks the row, and revoke asks again",
    async (choice) => {
      await mount();
      await pickScript("Uptime");
      await grant(choice);
      expect(sent()).toHaveLength(1);
      expect(record).not.toBeNull();
      expect(JSON.parse(record!).entries).toHaveLength(1);
      expect(JSON.parse(record!).entries[0]).not.toHaveProperty("script");
      expect(record).not.toContain(h.connection.hostname);
      await openPicker();
      expect(picker()!.querySelector("button button")).toBeNull();
      const mark = await screen.findByTestId("trusted-script-mark");
      expect(mark).toHaveAccessibleName(
        new RegExp(choice === "connection" ? "this connection" : "everywhere"),
      );
      // The binding/library refresh may recompute the hint after it appears.
      // Wait for the actionable control before exercising durable revocation.
      fireEvent.click(
        await screen.findByRole("button", { name: "Revoke trust for Uptime" }),
      );
      await waitFor(() =>
        expect(
          screen.queryByTestId("trusted-script-mark"),
        ).not.toBeInTheDocument(),
      );
      expect(sent()).toHaveLength(1);
      fireEvent.click(
        within(picker()!).getByRole("button", { name: /Uptime/ }),
      );
      await screen.findByTestId("app-prompt");
    },
  );
  it("consults the durable value again without remounting", async () => {
    await mount();
    await pickScript("Uptime");
    await grant("everywhere");
    await pickScript("Uptime");
    await waitForPickerToClose();
    expect(sent()).toHaveLength(2);
    expect(prompt()).not.toBeInTheDocument();
    vi.stubGlobal("crypto", webcrypto);
    record = null;
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    expect(prompt()).toBeInTheDocument();
  });
  it("cancel with a lasting answer grants nothing", async () => {
    await mount();
    await pickScript("Uptime");
    await selectTrust("connection");
    await cancelPrompt();
    expect(record).toBeNull();
    expect(sent()).toHaveLength(0);
  });
  it("an unreadable record preserves bytes and offers only session memory", async () => {
    await mount();
    record = "broken-private-record";
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    expect(screen.queryByTestId("app-prompt-choices")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-prompt-remember")).toBeInTheDocument();
    await confirmPrompt();
    await waitForPickerToClose();
    expect(record).toBe("broken-private-record");
  });
  it("a saved macro grant skips the next review and runs its exact steps", async () => {
    await mount();
    await pickMacro("Restart web");
    await selectTrust("everywhere");
    await new Promise((resolve) => setTimeout(resolve, 320));
    await act(async () => {
      trustedClick(screen.getByTestId("app-prompt-confirm"));
    });
    await waitFor(() => expect(sent()).toHaveLength(2));
    await pickMacro("Restart web");
    await waitFor(() => expect(sent()).toHaveLength(4));
    expect(prompt()).not.toBeInTheDocument();
    expect(record).not.toContain("systemctl");
    await revokeAllScriptTrust();
  });
  it("editing exact script content asks again; restoring it resumes trust", async () => {
    const view = await mount();
    await pickScript("Uptime");
    await grant("everywhere");
    h.library.scripts = [diskUsage, { ...uptime, script: "uptime # changed" }];
    view.rerender(<Tree />);
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    await cancelPrompt();
    h.library.scripts = [diskUsage, uptime];
    view.rerender(<Tree />);
    await pickScript("Uptime");
    await waitForPickerToClose();
    expect(sent()).toHaveLength(2);
  });
  it("a rejected grant warns but the confirmed run proceeds once", async () => {
    await mount();
    const original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command, args) =>
      command === "compare_and_swap_app_data" ? false : original(command, args),
    );
    await pickScript("Uptime");
    await grant("everywhere");
    expect(sent()).toHaveLength(1);
    expect(record).toBeNull();
    expect(h.toast.warning).toHaveBeenCalled();
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
  });
  it("trust does not bypass the reviewed library check", async () => {
    await mount();
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    h.library.scripts = [diskUsage];
    await selectTrust("everywhere");
    await new Promise((resolve) => setTimeout(resolve, 320));
    await act(async () => {
      trustedClick(screen.getByTestId("app-prompt-confirm"));
    });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(sent()).toHaveLength(0);
    expect(h.toast.error).toHaveBeenCalled();
  });
});
