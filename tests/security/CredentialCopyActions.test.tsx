import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CredentialCopyActions, {
  SessionCredentialCopyActions,
} from "../../src/components/security/CredentialCopyActions";
import RuntimeVaultTotpPanel from "../../src/components/security/RuntimeVaultTotpPanel";
import WebTotpPanel from "../../src/components/protocol/webBrowser/WebTotpPanel";
import TotpPopover from "../../src/components/ssh/webTerminal/TotpPopover";
import TotpButton from "../../src/components/rdp/rdpClientHeader/TotpButton";
import { useCredentialCopy } from "../../src/hooks/security/useCredentialCopy";
import { useRuntimeVaultTotp } from "../../src/hooks/security/useRuntimeVaultTotp";
import { CredentialFailure } from "../../src/utils/security/credentialFailure";
import { totpApi } from "../../src/hooks/totp/useTOTP";
import type { CredentialTypingTarget } from "../../src/utils/security/credentialTyping";
import { resolveRuntimeVaultCredential } from "../../src/utils/security/runtimeCredentialVault";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type {
  DatabaseCredentialVaultApi,
  DatabaseCredentialFacet,
} from "../../src/types/security/databaseCredentialVault";
import type { DatabaseDataTarget } from "../../src/utils/connection/databaseManager";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";

const mock = vi.hoisted(() => ({
  connections: [] as Connection[],
  currentConnections: [] as Connection[],
  sessions: [] as ConnectionSession[],
  availability: {
    status: "ready",
    databaseId: "owner",
    generation: 1,
  } as DatabaseAvailability,
  api: undefined as DatabaseCredentialVaultApi | undefined,
  target: undefined as DatabaseDataTarget | undefined,
  currentDatabaseId: "owner",
  active: true,
  getCurrentConnections: vi.fn(),
  capture: vi.fn(),
  nativeClipboard: false,
  nativeInvoke: vi.fn(),
  getInvoke: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: mock.connections, sessions: mock.sessions },
    databaseAvailability: mock.availability,
    credentialVault: mock.api,
    getCurrentConnections: mock.getCurrentConnections,
  }),
}));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: mock.active }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => {
  // One instance, as in the app: the code panel memoizes on its identity.
  const manager = {
    captureCurrentDatabaseDataTarget: mock.capture,
    getCurrentDatabase: () => ({ id: mock.currentDatabaseId }),
    onCurrentDatabaseChange: () => () => {},
  };
  return {
    DatabaseManager: { getInstance: () => manager },
    onDatabaseAccessChange: () => () => {},
  };
});
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: mock.getInvoke,
}));
vi.mock("../../src/components/ui/overlays/PopoverSurface", () => ({
  PopoverSurface: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const credentialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clipboard = vi.fn();
const flush = async () => {
  await act(async () => {});
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(vault = true, overrides: Partial<Connection> = {}) {
  const connection: Connection = {
    id: "saved",
    name: "Host",
    hostname: "example.test",
    protocol: "https",
    port: 443,
    isGroup: false,
    createdAt: "2026-09-28T00:00:00Z",
    updatedAt: "2026-09-28T00:00:00Z",
    credentialSource: vault
      ? { kind: "vault", credentialId }
      : { kind: "local" },
    username: "STALE_LOCAL_USER",
    password: "STALE_LOCAL_PASSWORD",
    ...overrides,
  };
  const session: ConnectionSession = {
    id: "session",
    connectionId: connection.id,
    ownerDatabaseId: "owner",
    name: "Host",
    hostname: connection.hostname,
    protocol: connection.protocol,
    status: "connected",
    startTime: new Date(),
  };
  const persisted = {
    ...connection,
    username: "CURRENT_LOCAL_USER",
    password: "CURRENT_LOCAL_PASSWORD",
  };
  const target = {
    databaseId: "owner",
    assertAccessible: vi.fn(),
    verifyCurrent: vi.fn(async () => {}),
    readCurrent: vi.fn(async () => ({ connections: [persisted] })),
  } as unknown as DatabaseDataTarget;
  const api: DatabaseCredentialVaultApi = {
    scope: { databaseId: "owner", generation: 1 },
    changeRevision: 1,
    list: vi.fn(async () => ({
      scope: { databaseId: "owner", generation: 1 },
      revision: 1,
      receipt: "receipt",
      entries: [
        {
          id: credentialId,
          name: "Credential",
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
          availableFacets: [
            "username",
            "password",
          ] as DatabaseCredentialFacet[],
        },
      ],
    })),
    resolve: vi.fn<DatabaseCredentialVaultApi["resolve"]>(
      async (_snapshot, _id, facets) =>
        Object.fromEntries(
          facets.map((field) => [
            field,
            field === "username" ? "VAULT_USER" : "VAULT_PASSWORD",
          ]),
        ),
    ),
    compareAndSwap: vi.fn(),
  };
  mock.api = api;
  mock.target = target;
  mock.connections = [connection];
  mock.currentConnections = [connection];
  mock.sessions = [session];
  return {
    connection,
    session,
    persisted,
    api,
    target,
    assertCurrent: vi.fn(),
  };
}
beforeEach(() => {
  mock.currentDatabaseId = "owner";
  mock.active = true;
  mock.nativeClipboard = false;
  mock.nativeInvoke.mockReset().mockResolvedValue({});
  mock.getInvoke
    .mockReset()
    .mockImplementation(async () =>
      mock.nativeClipboard ? mock.nativeInvoke : null,
    );
  mock.availability = { status: "ready", databaseId: "owner", generation: 1 };
  mock.capture.mockReset().mockImplementation(() => mock.target);
  mock.getCurrentConnections
    .mockReset()
    .mockImplementation(() => mock.currentConnections);
  clipboard.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("explicit credential copies", () => {
  it.each([true, false])(
    "copies on native clipboard without a focused website field or typing controller (vault=%s)",
    async (vault) => {
      const input = fixture(vault);
      mock.nativeClipboard = true;
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      const target: CredentialTypingTarget = {
        sessionId: input.session.id,
        assertCurrent: vi.fn(() => {
          throw new Error("Synthetic empty-field rejection");
        }),
        type: vi.fn(async () => {}),
        dispose: vi.fn(),
      };
      const view = render(
        <CredentialCopyActions {...input} typingTarget={target} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
      await flush();
      expect(screen.getByRole("status")).toHaveTextContent("Password copied.");
      view.rerender(<CredentialCopyActions {...input} typingTarget={null} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy username" }));
      await flush();
      expect(screen.getByRole("status")).toHaveTextContent("Username copied.");
      expect(mock.nativeInvoke).toHaveBeenCalledTimes(2);
      expect(mock.nativeInvoke).toHaveBeenLastCalledWith("secure_clip_copy", {
        request: expect.objectContaining({
          kind: "username",
          value: vault ? "VAULT_USER" : "CURRENT_LOCAL_USER",
        }),
      });
      expect(target.assertCurrent).not.toHaveBeenCalled();
      expect(target.type).not.toHaveBeenCalled();
      expect(clipboard).not.toHaveBeenCalled();
    },
  );

  it.each(["bridge-discovery", "unavailable-web-clipboard"])(
    "reports %s before reading credentials and permits a later retry",
    async (reason) => {
      const input = fixture();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      if (reason === "bridge-discovery")
        mock.getInvoke.mockRejectedValueOnce(
          new Error("SYNTHETIC_BRIDGE_DETAIL"),
        );
      else
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
      render(<CredentialCopyActions {...input} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
      await flush();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Check the secure clipboard settings",
      );
      expect(mock.capture).not.toHaveBeenCalled();
      expect(input.api.resolve).not.toHaveBeenCalled();
      expect(input.target.readCurrent).not.toHaveBeenCalled();
      expect(mock.nativeInvoke).not.toHaveBeenCalled();
      expect(clipboard).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toMatch(
        /SYNTHETIC_BRIDGE_DETAIL|VAULT_PASSWORD/,
      );
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();

      mock.nativeClipboard = true;
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
      await flush();
      expect(screen.getByRole("status")).toHaveTextContent("Password copied.");
      expect(mock.nativeInvoke).toHaveBeenCalledOnce();
    },
  );

  it("rechecks the owner after clipboard preparation and prevents late native disclosure", async () => {
    const input = fixture(false);
    const preparation = deferred<typeof mock.nativeInvoke>();
    mock.getInvoke.mockReturnValueOnce(preparation.promise);
    render(<CredentialCopyActions {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    mock.currentDatabaseId = "other";
    await act(async () => preparation.resolve(mock.nativeInvoke));
    expect(mock.nativeInvoke).not.toHaveBeenCalled();
    expect(input.target.readCurrent).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "The owning database is closed or locked.",
    );
  });

  it.each([true, false])(
    "does no background lookup and reads fresh on every click (vault=%s)",
    async (vault) => {
      const input = fixture(vault);
      const view = render(<CredentialCopyActions {...input} />);
      await flush();
      expect(mock.capture).not.toHaveBeenCalled();
      expect(mock.getCurrentConnections).not.toHaveBeenCalled();
      expect(input.api.list).not.toHaveBeenCalled();
      expect(input.target.readCurrent).not.toHaveBeenCalled();
      expect(clipboard).not.toHaveBeenCalled();
      for (const field of ["username", "password"]) {
        const copy = screen.getByRole("button", { name: `Copy ${field}` });
        const type = screen.getByRole("button", { name: `Type ${field}` });
        expect(copy).toHaveAttribute("title", `Copy ${field}`);
        expect(type).toHaveAttribute("title", `Type ${field}`);
        expect(copy.textContent).toBe("");
        expect(type.textContent).toBe("");
        expect(copy.parentElement).toBe(type.parentElement);
        expect(copy.parentElement?.previousElementSibling).toHaveTextContent(
          `Copy ${field}`,
        );
      }
      fireEvent.click(screen.getByRole("button", { name: "Copy username" }));
      await flush();
      expect(clipboard).toHaveBeenLastCalledWith(
        vault ? "VAULT_USER" : "CURRENT_LOCAL_USER",
      );
      if (vault)
        vi.mocked(input.api.resolve).mockResolvedValueOnce({
          password: "FRESH_PASSWORD",
        });
      else input.persisted.password = "FRESH_PASSWORD";
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
      await flush();
      expect(clipboard).toHaveBeenLastCalledWith("FRESH_PASSWORD");
      expect(clipboard).toHaveBeenCalledTimes(2);
      expect(view.container.innerHTML).not.toMatch(
        /FRESH_PASSWORD|VAULT_USER|CURRENT_LOCAL_USER/,
      );
      expect(screen.getByRole("status")).toHaveTextContent("Password copied.");
      expect(input.api.compareAndSwap).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      httpApplication: { version: 1, id: "generic-form", loginMode: "manual" },
      httpHeaders: { "X-Local": "literal" },
    },
    { protocol: "ssh", port: 22, authType: "key" },
  ] satisfies Partial<Connection>[])(
    "copies only the password independently of login policy: %j",
    async (overrides) => {
      const input = fixture(true, overrides);
      render(<CredentialCopyActions {...input} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
      await flush();
      expect(input.api.resolve).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        credentialId,
        ["password"],
      );
      expect(clipboard).toHaveBeenCalledExactlyOnceWith("VAULT_PASSWORD");
    },
  );

  it.each([false, true])(
    "copies both fields through the native clipboard (vault=%s)",
    async (vault) => {
      const input = fixture(vault);
      mock.nativeClipboard = true;
      clipboard.mockRejectedValue(
        new DOMException("Document not focused", "NotAllowedError"),
      );
      render(<CredentialCopyActions {...input} />);
      for (const field of ["username", "password"] as const) {
        fireEvent.click(screen.getByRole("button", { name: `Copy ${field}` }));
        await flush();
        expect(mock.nativeInvoke).toHaveBeenLastCalledWith("secure_clip_copy", {
          request: expect.objectContaining({
            kind: field,
            connectionId: input.connection.id,
            value: vault
              ? field === "username"
                ? "VAULT_USER"
                : "VAULT_PASSWORD"
              : field === "username"
                ? "CURRENT_LOCAL_USER"
                : "CURRENT_LOCAL_PASSWORD",
          }),
        });
      }
      expect(clipboard).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("Password copied.");
    },
  );

  it("shows clipboard guidance rather than a database error when native writing fails", async () => {
    const input = fixture(false);
    mock.nativeClipboard = true;
    mock.nativeInvoke.mockRejectedValue(new Error("PRIVATE_FAILURE"));
    render(<CredentialCopyActions {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Check the secure clipboard settings",
    );
    expect(document.body.textContent).not.toMatch(
      /PRIVATE_FAILURE|CURRENT_LOCAL_PASSWORD/,
    );
    expect(clipboard).not.toHaveBeenCalled();
  });

  it("copies a dedicated HTTP pair in manual mode without mixing generic fields", async () => {
    const input = fixture(false, {
      basicAuthUsername: "DEDICATED",
      basicAuthPassword: "",
      httpApplication: { version: 1, id: "generic-form", loginMode: "manual" },
    });
    render(<CredentialCopyActions {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy username" }));
    await flush();
    expect(clipboard).toHaveBeenCalledExactlyOnceWith("DEDICATED");
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No password is saved for this credential.",
    );
  });

  it("allows username-only vault entries without resolving a password", async () => {
    const input = fixture();
    const snapshot = await input.api.list(input.api.scope!);
    snapshot.entries[0].availableFacets = ["username"];
    vi.mocked(input.api.list).mockResolvedValue(snapshot);
    render(<CredentialCopyActions {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy username" }));
    await flush();
    expect(input.api.resolve).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      credentialId,
      ["username"],
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    expect(input.api.resolve).toHaveBeenCalledTimes(1);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith("VAULT_USER");
  });

  it.each([
    "missing-entry",
    "missing-facet",
    "invalid-facet",
    "resolver-error",
    "clipboard-error",
  ])("redacts %s and never falls back", async (mode) => {
    const input = fixture();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    if (mode === "missing-entry" || mode === "missing-facet") {
      const snapshot = await input.api.list(input.api.scope!);
      if (mode === "missing-entry") snapshot.entries = [];
      else snapshot.entries[0].availableFacets = ["username"];
      vi.mocked(input.api.list).mockResolvedValue(snapshot);
    } else if (mode === "invalid-facet")
      vi.mocked(input.api.resolve).mockResolvedValue({});
    else if (mode === "resolver-error")
      vi.mocked(input.api.resolve).mockRejectedValue(
        new Error("SECRET_ERROR_PASSWORD"),
      );
    else clipboard.mockRejectedValue(new Error("SECRET_ERROR_PASSWORD"));
    const view = render(<CredentialCopyActions {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(
      mode === "clipboard-error"
        ? "The clipboard could not be updated. Check the secure clipboard settings and try again."
        : "The vault entry could not be read. Unlock the owning database and check that the entry still holds this field.",
    );
    expect(view.container.innerHTML).not.toMatch(
      /SECRET_ERROR|STALE_LOCAL|VAULT_PASSWORD/,
    );
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    if (mode === "clipboard-error")
      expect(clipboard).toHaveBeenCalledExactlyOnceWith("VAULT_PASSWORD");
    else expect(clipboard).not.toHaveBeenCalled();
  });

  it.each([
    "suspended",
    "other-owner",
    "missing-owner",
    "deleted",
    "duplicate",
    "invalid-source",
    "stale-target",
    "missing-access-gate",
    "missing-verify-gate",
    "sync-provider-denial",
  ])("fails closed for %s", async (mode) => {
    const input = fixture(false);
    if (mode === "suspended") mock.availability.status = "suspended";
    if (mode === "other-owner") mock.availability.databaseId = "other";
    if (mode === "missing-owner") input.session.ownerDatabaseId = undefined;
    if (mode === "deleted") mock.connections = [];
    if (mode === "duplicate") mock.connections.push(input.connection);
    if (mode === "invalid-source")
      input.connection.credentialSource = { kind: "unknown" } as never;
    if (mode === "stale-target") input.persisted.hostname = "changed.test";
    if (mode === "missing-access-gate")
      input.target.assertAccessible = undefined;
    if (mode === "missing-verify-gate") input.target.verifyCurrent = undefined;
    if (mode === "sync-provider-denial")
      mock.getCurrentConnections.mockImplementation(() => {
        throw new Error("SECRET");
      });
    render(<CredentialCopyActions {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    expect(clipboard).not.toHaveBeenCalled();
    expect(input.api.resolve).not.toHaveBeenCalled();
  });

  it.each(["read", "initial-verify", "final-verify", "vault-resolve"])(
    "unmount fences a pending %s",
    async (stage) => {
      const input = fixture(stage === "vault-resolve");
      const pending = deferred<any>();
      if (stage === "read")
        vi.mocked(input.target.readCurrent!).mockReturnValueOnce(
          pending.promise,
        );
      if (stage === "initial-verify")
        vi.mocked(input.target.verifyCurrent!).mockReturnValueOnce(
          pending.promise,
        );
      if (stage === "final-verify")
        vi.mocked(input.target.verifyCurrent!)
          .mockResolvedValueOnce(undefined)
          .mockReturnValueOnce(pending.promise);
      if (stage === "vault-resolve")
        vi.mocked(input.api.resolve).mockReturnValueOnce(pending.promise);
      const view = render(<CredentialCopyActions {...input} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
      await flush();
      view.unmount();
      await act(async () =>
        pending.resolve(
          stage === "read"
            ? { connections: [input.persisted] }
            : stage === "vault-resolve"
              ? { password: "LATE_SECRET" }
              : undefined,
        ),
      );
      expect(clipboard).not.toHaveBeenCalled();
    },
  );

  it.each([
    "owner",
    "source",
    "revision",
    "scope",
    "session",
    "connection",
    "suspend",
    "inactive",
    "provider-before-render",
    "database-before-render",
    "lease-before-render",
    "saved-revision",
  ])("cancels a pending vault copy when %s changes", async (change) => {
    const input = fixture();
    const pending = deferred<{ password: string }>();
    vi.mocked(input.api.resolve).mockReturnValueOnce(pending.promise);
    const view = render(<CredentialCopyActions {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    expect(input.api.resolve).toHaveBeenCalledOnce();
    let connection = input.connection,
      session = input.session;
    if (change === "owner") session = { ...session, ownerDatabaseId: "other" };
    if (change === "source")
      connection = { ...connection, credentialSource: { kind: "local" } };
    if (change === "revision") mock.api = { ...input.api, changeRevision: 2 };
    if (change === "scope")
      mock.api = {
        ...input.api,
        scope: { databaseId: "owner", generation: 2 },
      };
    if (change === "session") session = { ...session, id: "other" };
    if (change === "connection")
      connection = { ...connection, hostname: "other.test" };
    if (change === "suspend")
      mock.availability = { ...mock.availability, status: "suspended" };
    if (change === "inactive") mock.active = false;
    if (change === "provider-before-render")
      mock.currentConnections = [{ ...input.connection, password: "EDITED" }];
    if (change === "database-before-render") mock.currentDatabaseId = "other";
    if (change === "lease-before-render")
      vi.mocked(input.target.assertAccessible!).mockImplementation(() => {
        throw new Error("locked");
      });
    if (change === "saved-revision")
      vi.mocked(input.target.verifyCurrent!).mockRejectedValue(
        new Error("changed"),
      );
    if (!change.includes("before-render"))
      view.rerender(
        <CredentialCopyActions session={session} connection={connection} />,
      );
    await act(async () => pending.resolve({ password: "LATE_SECRET" }));
    expect(clipboard).not.toHaveBeenCalled();
    expect(view.container.innerHTML).not.toContain("LATE_SECRET");
  });

  it("does not revive an old copy when a source switches away and back", async () => {
    const input = fixture();
    const pending = deferred<{ password: string }>();
    vi.mocked(input.api.resolve).mockReturnValueOnce(pending.promise);
    const view = render(<CredentialCopyActions {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    view.rerender(
      <CredentialCopyActions
        session={input.session}
        connection={{
          ...input.connection,
          credentialSource: { kind: "local" },
        }}
      />,
    );
    view.rerender(<CredentialCopyActions {...input} />);
    await act(async () => pending.resolve({ password: "LATE_SECRET" }));
    expect(clipboard).not.toHaveBeenCalled();
  });

  it("keeps passwords out of hook state and prevents duplicate in-flight copies", async () => {
    const input = fixture();
    const pending = deferred<{ password: string }>();
    vi.mocked(input.api.resolve).mockReturnValueOnce(pending.promise);
    const hook = renderHook(() =>
      useCredentialCopy(input.session, input.connection),
    );
    let first!: ReturnType<typeof hook.result.current.copy>;
    let second!: ReturnType<typeof hook.result.current.copy>;
    act(() => {
      first = hook.result.current.copy("password");
      second = hook.result.current.copy("username");
    });
    await flush();
    expect(input.api.resolve).toHaveBeenCalledOnce();
    expect(JSON.stringify(hook.result.current)).not.toMatch(/PASSWORD|SECRET/);
    await expect(second).resolves.toMatchObject({ ok: false, code: "busy" });
    await act(async () => {
      pending.resolve({ password: "ONLY_CLIPBOARD" });
      await expect(first).resolves.toEqual({ ok: true });
    });
    expect(clipboard).toHaveBeenCalledExactlyOnceWith("ONLY_CLIPBOARD");
    expect(JSON.stringify(hook.result.current)).not.toContain("ONLY_CLIPBOARD");
  });
});

describe("manual runtime intents", () => {
  it("validates the purpose before disclosure", async () => {
    const input = fixture();
    await expect(
      resolveRuntimeVaultCredential({
        ...input,
        intent: "manual-copy-privateKey" as never,
      }),
    ).rejects.toThrow("Unsupported vault disclosure purpose");
    expect(input.api.list).not.toHaveBeenCalled();
    expect(input.api.resolve).not.toHaveBeenCalled();
  });
  it("retains owner validation and rejects a missing requested facet", async () => {
    const input = fixture();
    await expect(
      resolveRuntimeVaultCredential({
        ...input,
        session: { ...input.session, ownerDatabaseId: "other" },
        intent: "manual-copy-password",
      }),
    ).rejects.toThrow();
    expect(input.api.resolve).not.toHaveBeenCalled();
    const snapshot = await input.api.list(input.api.scope!);
    snapshot.entries[0].availableFacets = ["privateKey"];
    vi.mocked(input.api.list).mockResolvedValue(snapshot);
    await expect(
      resolveRuntimeVaultCredential({
        ...input,
        intent: "manual-copy-password",
      }),
    ).rejects.toThrow(/facets required/);
    expect(input.api.resolve).not.toHaveBeenCalled();
  });
});

describe("explicit credential typing", () => {
  const typing = (): CredentialTypingTarget => ({
    sessionId: "session",
    assertCurrent: vi.fn(),
    dispose: vi.fn(),
    type: vi.fn(async (_value, check) => {
      check();
    }),
  });
  it.each([true, false])(
    "types fresh username and password without clipboard or state secrets (vault=%s)",
    async (vault) => {
      const input = fixture(vault);
      const target = typing();
      const view = render(
        <CredentialCopyActions {...input} typingTarget={target} />,
      );
      await flush();
      expect(mock.capture).not.toHaveBeenCalled();
      expect(input.api.resolve).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Type username" }));
      await flush();
      expect(target.type).toHaveBeenLastCalledWith(
        vault ? "VAULT_USER" : "CURRENT_LOCAL_USER",
        expect.any(Function),
        undefined,
      );
      fireEvent.click(screen.getByRole("button", { name: "Type password" }));
      await flush();
      expect(target.type).toHaveBeenLastCalledWith(
        vault ? "VAULT_PASSWORD" : "CURRENT_LOCAL_PASSWORD",
        expect.any(Function),
        undefined,
      );
      expect(clipboard).not.toHaveBeenCalled();
      expect(view.container.innerHTML).not.toMatch(
        /VAULT_PASSWORD|CURRENT_LOCAL_PASSWORD/,
      );
    },
  );
  it("offers disabled Type alternatives without a captured focus target", () => {
    const input = fixture();
    render(<CredentialCopyActions {...input} />);
    expect(
      screen.getByRole("button", { name: "Type username" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Type password" }),
    ).toBeDisabled();
    expect(input.api.resolve).not.toHaveBeenCalled();
  });
  it.each([
    "focus",
    "owner",
    "source",
    "revision",
    "session",
    "unmount",
    "target",
    "provider-before-render",
  ])("rejects pending typing after %s changes", async (change) => {
    const input = fixture();
    const target = typing();
    const pending = deferred<{ password: string }>();
    vi.mocked(input.api.resolve).mockReturnValueOnce(pending.promise);
    const view = render(
      <CredentialCopyActions {...input} typingTarget={target} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Type password" }));
    await flush();
    if (change === "focus")
      vi.mocked(target.assertCurrent).mockImplementation(() => {
        throw new Error("focus changed");
      });
    if (change === "owner") mock.currentDatabaseId = "other";
    if (change === "source")
      view.rerender(
        <CredentialCopyActions
          {...input}
          connection={{
            ...input.connection,
            credentialSource: { kind: "local" },
          }}
          typingTarget={target}
        />,
      );
    if (change === "revision") {
      mock.api = { ...input.api, changeRevision: 2 };
      view.rerender(<CredentialCopyActions {...input} typingTarget={target} />);
    }
    if (change === "session")
      view.rerender(
        <CredentialCopyActions
          {...input}
          session={{ ...input.session, backendSessionId: "replacement" }}
          typingTarget={target}
        />,
      );
    if (change === "target")
      view.rerender(
        <CredentialCopyActions {...input} typingTarget={typing()} />,
      );
    if (change === "unmount") view.unmount();
    if (change === "provider-before-render")
      mock.currentConnections = [{ ...input.connection }];
    await act(async () => pending.resolve({ password: "LATE_SECRET" }));
    expect(target.type).not.toHaveBeenCalled();
    expect(clipboard).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "generates and types a fresh local/vault code only on click (vault=%s)",
    async (vault) => {
      const cfg = {
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "sha1" as const,
        digits: 6,
        period: 30,
        account: "test",
        issuer: "test",
      };
      const input = fixture(vault, { totpConfigs: [cfg] });
      const now = 1_800_000_001_000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const compute = vi
        .spyOn(totpApi, "computeCode")
        .mockResolvedValue("123456");
      const snapshot = await input.api.list(input.api.scope!);
      snapshot.entries[0].availableFacets = ["totp"];
      vi.mocked(input.api.list).mockResolvedValue(snapshot);
      vi.mocked(input.api.resolve).mockResolvedValue({
        totp: [{ ...cfg, digits: 6, id: "otp", label: "test" }],
      });
      const target = typing();
      render(
        <CredentialCopyActions
          {...input}
          typingTarget={target}
          codeSelection={vault ? { vaultId: "otp" } : { localIndex: 0 }}
        />,
      );
      expect(compute).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Type code" }));
      await flush();
      const status = screen.getByRole("status");
      expect(status).not.toHaveClass("absolute");
      expect(status).toHaveClass(
        "max-w-full",
        "whitespace-normal",
        "[overflow-wrap:anywhere]",
      );
      expect(status.parentElement).toHaveClass(
        "flex-col",
        "items-end",
        "max-w-32",
      );
      expect(status.previousElementSibling).toBe(
        screen.getByRole("button", { name: "Type code" }),
      );
      expect(compute).toHaveBeenCalledExactlyOnceWith(
        cfg.secret,
        "SHA1",
        6,
        30,
      );
      expect(target.type).toHaveBeenCalledExactlyOnceWith(
        "123456",
        expect.any(Function),
        { starts: now - 1000, expires: now + 29000 },
      );
      expect(clipboard).not.toHaveBeenCalled();
    },
  );
  it.each(["expired", "rollback", "invalid", "changed-config"])(
    "rejects %s code before typing",
    async (reason) => {
      const cfg = {
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "sha1" as const,
        digits: 6,
        period: 30,
        account: "test",
        issuer: "test",
      };
      const input = fixture(false, { totpConfigs: [cfg] });
      const now = 1_800_000_001_000;
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      vi.spyOn(totpApi, "computeCode").mockImplementation(async () => {
        if (reason === "expired") clock.mockReturnValue(now + 30000);
        if (reason === "rollback") clock.mockReturnValue(now - 30000);
        return reason === "invalid" ? "123\n45" : "123456";
      });
      if (reason === "changed-config")
        input.persisted.totpConfigs = [{ ...cfg, account: "changed" }];
      const target = typing();
      render(
        <CredentialCopyActions
          {...input}
          typingTarget={target}
          codeSelection={{ localIndex: 0 }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Type code" }));
      await flush();
      expect(target.type).not.toHaveBeenCalled();
      expect(clipboard).not.toHaveBeenCalled();
    },
  );
});

describe("shared popover copy actions without TOTP", () => {
  const controller = () => ({
    scopeKey: "scope",
    available: true,
    unavailableReason: "",
    load: vi.fn(async () => []),
    generate: vi.fn(),
  });
  it("works alongside an unavailable vault TOTP facet", async () => {
    const input = fixture();
    const totp = controller();
    totp.load.mockRejectedValue(new Error("No authenticators"));
    render(
      <RuntimeVaultTotpPanel
        controller={totp}
        anchorRef={{ current: null }}
        onClose={vi.fn()}
        credentialActions={<CredentialCopyActions {...input} />}
      />,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    expect(clipboard).toHaveBeenCalledExactlyOnceWith("VAULT_PASSWORD");
    expect(totp.generate).not.toHaveBeenCalled();
  });
  it("works in the web local panel with no authenticator configurations", async () => {
    const input = fixture(false);
    render(
      <WebTotpPanel
        configs={[]}
        ownerDatabaseId="owner"
        connectionId="saved"
        onClose={vi.fn()}
        credentialActions={<CredentialCopyActions {...input} />}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await flush();
    expect(clipboard).toHaveBeenCalledExactlyOnceWith("CURRENT_LOCAL_PASSWORD");
    expect(
      screen.getByText(/No saved authenticator configurations/),
    ).toBeInTheDocument();
  });
  it.each([true, false])("wires SSH popovers for vault=%s", async (vault) => {
    const input = fixture(vault, { protocol: "ssh", port: 22 });
    const mgr = {
      ...input,
      vaultTotp: controller(),
      totpConfigs: [],
      totpBtnRef: { current: null },
      showTotpPanel: true,
      setShowTotpPanel: vi.fn(),
      handleUpdateTotpConfigs: vi.fn(),
      settings: {},
    };
    render(<TotpPopover mgr={mgr as never} />);
    await flush();
    expect(
      screen.getByRole("button", { name: "Credentials & 2FA" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Credentials & 2FA")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy username" }));
    await flush();
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(
      vault ? "VAULT_USER" : "CURRENT_LOCAL_USER",
    );
  });
  it.each([true, false])(
    "wires RDP popovers for vault=%s through the owning session",
    async (vault) => {
      fixture(vault, { protocol: "rdp", port: 3389 });
      const mgr = {
        totpBtnRef: { current: null },
        showTotpPanel: true,
        setShowTotpPanel: vi.fn(),
      };
      const p = {
        sessionId: "session",
        connectionId: "saved",
        vaultTotp: vault ? controller() : undefined,
        totpConfigs: [],
        onUpdateTotpConfigs: vi.fn(),
      };
      render(<TotpButton mgr={mgr as never} p={p as never} />);
      await flush();
      expect(
        screen.getByRole("button", { name: "Credentials & 2FA" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Credentials & 2FA")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
      await flush();
      expect(clipboard).toHaveBeenCalledExactlyOnceWith(
        vault ? "VAULT_PASSWORD" : "CURRENT_LOCAL_PASSWORD",
      );
    },
  );
  it("does not bind RDP copies to a different or missing session", () => {
    fixture();
    render(
      <SessionCredentialCopyActions
        sessionId="different"
        connectionId="saved"
      />,
    );
    expect(screen.queryByRole("button", { name: "Copy password" })).toBeNull();
    expect(mock.capture).not.toHaveBeenCalled();
  });
});

describe("each failure cause shows its own sentence", () => {
  const typingTarget = (
    overrides: Partial<CredentialTypingTarget> = {},
  ): CredentialTypingTarget => ({
    sessionId: "session",
    assertCurrent: vi.fn(),
    dispose: vi.fn(),
    type: vi.fn(async (_value, check) => {
      check();
    }),
    ...overrides,
  });
  const totp = {
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "sha1" as const,
    digits: 6,
    period: 30,
    account: "test",
    issuer: "test",
  };
  /** The start of a 30 second step, in Unix milliseconds. */
  const step = 1_800_000_000_000;

  it.each([
    ["empty-password", "password", "No password is saved for this credential."],
    ["empty-username", "username", "No username is saved for this credential."],
    [
      "saved-row-changed",
      "password",
      "The saved connection changed while its credential was being read.",
    ],
    [
      "persisted-row-changed",
      "password",
      "The saved connection changed while its credential was being read.",
    ],
    ["database-locked", "password", "The owning database is closed or locked."],
    ["read-rejected", "password", "The owning database is closed or locked."],
    ["app-hidden", "password", "The app was hidden before the credential"],
    ["vault-rejected", "password", "The vault entry could not be read."],
    ["clipboard-locked", "password", "Nothing was copied because the app is"],
    ["clipboard-busy", "password", "another program is using the clipboard"],
    ["clipboard-too-large", "password", "too large for the secure clipboard"],
    ["clipboard-unknown", "password", "Check the secure clipboard settings"],
  ] as const)("copy: %s", async (cause, field, sentence) => {
    const input = fixture(cause === "vault-rejected");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    if (cause === "empty-password") input.persisted.password = "";
    if (cause === "empty-username") input.persisted.username = "";
    if (cause === "saved-row-changed")
      mock.currentConnections = [{ ...input.connection }];
    if (cause === "persisted-row-changed")
      input.persisted.hostname = "changed.test";
    if (cause === "database-locked")
      vi.mocked(input.target.assertAccessible!).mockImplementation(() => {
        throw new Error("SYNTHETIC_LOCK_DETAIL");
      });
    if (cause === "read-rejected")
      vi.mocked(input.target.readCurrent!).mockRejectedValue(
        new Error("SYNTHETIC_READ_DETAIL"),
      );
    if (cause === "vault-rejected")
      vi.mocked(input.api.resolve).mockRejectedValue(
        new Error("SYNTHETIC_VAULT_DETAIL"),
      );
    if (cause.startsWith("clipboard-")) {
      mock.nativeClipboard = true;
      mock.nativeInvoke.mockRejectedValue(
        cause === "clipboard-unknown"
          ? new Error("SYNTHETIC_CLIPBOARD_DETAIL")
          : cause.slice("clipboard-".length),
      );
    }
    const view = render(<CredentialCopyActions {...input} />);
    // Hidden between the last render and the click reaching the gates.
    if (cause === "app-hidden")
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
    fireEvent.click(screen.getByRole("button", { name: `Copy ${field}` }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(sentence);
    expect(view.container.innerHTML).not.toMatch(
      /SYNTHETIC|CURRENT_LOCAL_PASSWORD|VAULT_PASSWORD/,
    );
    expect(clipboard).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    // A failure never leaves the controls stuck.
    expect(screen.getByRole("button", { name: "Copy username" })).toBeEnabled();
  });

  it.each([
    ["tab-character", "contains a tab, line break or another control"],
    ["too-long", "longer than 1024 characters"],
    ["target-lost", "The typing target changed or is unavailable."],
    ["session-refused", "The session did not accept the input."],
    ["unconfirmed", "Typing stopped or was not confirmed. Some characters may"],
    ["empty-password", "No password is saved for this credential."],
  ] as const)("type: %s", async (cause, sentence) => {
    const input = fixture(false);
    if (cause === "tab-character") input.persisted.password = "SYN\tTHETIC";
    if (cause === "too-long") input.persisted.password = "S".repeat(1025);
    if (cause === "empty-password") input.persisted.password = "";
    const target = typingTarget(
      cause === "target-lost"
        ? {
            assertCurrent: vi.fn(() => {
              throw new Error("SYNTHETIC_FOCUS_DETAIL");
            }),
          }
        : cause === "session-refused"
          ? {
              type: vi.fn(async () => {
                throw new CredentialFailure("typing-rejected");
              }),
            }
          : cause === "unconfirmed"
            ? {
                type: vi.fn(async () => {
                  throw new Error("SYNTHETIC_NATIVE_DETAIL");
                }),
              }
            : {},
    );
    const view = render(
      <CredentialCopyActions {...input} typingTarget={target} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Type password" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(sentence);
    expect(view.container.innerHTML).not.toMatch(/SYNTHETIC|SSSS/);
    if (cause !== "session-refused" && cause !== "unconfirmed")
      expect(target.type).not.toHaveBeenCalled();
    expect(clipboard).not.toHaveBeenCalled();
  });

  it.each([
    ["closing-window", "The current code is about to expire."],
    ["expired-while-generating", "The code expired before it could be used."],
    ["unsupported-settings", "digits, period or algorithm are not supported"],
    ["generator-failed", "The code could not be generated safely."],
    ["authenticator-changed", "The selected authenticator changed or was"],
  ] as const)("type code: %s", async (cause, sentence) => {
    const cfg =
      cause === "unsupported-settings" ? { ...totp, digits: 5 } : { ...totp };
    const input = fixture(false, { totpConfigs: [cfg] });
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(step + (cause === "closing-window" ? 27_001 : 1000));
    const compute = vi
      .spyOn(totpApi, "computeCode")
      .mockImplementation(async () => {
        if (cause === "expired-while-generating")
          clock.mockReturnValue(step + 30_000);
        if (cause === "generator-failed")
          throw new Error("SYNTHETIC_SEED_DETAIL");
        return "123456";
      });
    if (cause === "authenticator-changed")
      input.persisted.totpConfigs = [{ ...cfg, account: "changed" }];
    const target = typingTarget();
    const view = render(
      <CredentialCopyActions
        {...input}
        typingTarget={target}
        codeSelection={{ localIndex: 0 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Type code" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(sentence);
    expect(view.container.innerHTML).not.toMatch(/SYNTHETIC|123456|JBSWY/);
    expect(target.type).not.toHaveBeenCalled();
    if (cause === "closing-window" || cause === "unsupported-settings")
      expect(compute).not.toHaveBeenCalled();
  });

  it("says sent, not typed, when the target only queues the input", async () => {
    const input = fixture(false);
    const view = render(
      <CredentialCopyActions
        {...input}
        typingTarget={typingTarget({ confirmation: "sent" })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Type password" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Password sent to the session.",
    );
    view.rerender(
      <CredentialCopyActions
        {...input}
        typingTarget={typingTarget({ confirmation: "typed" })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Type username" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Username typed.");
  });

  it.each(["read", "verify", "vault"] as const)(
    "stops a %s that never answers, says so, and lets the next action work",
    async (stage) => {
      vi.useFakeTimers();
      try {
        const input = fixture(stage === "vault");
        const hung = new Promise<never>(() => {});
        if (stage === "read")
          vi.mocked(input.target.readCurrent!).mockReturnValueOnce(hung);
        if (stage === "verify")
          vi.mocked(input.target.verifyCurrent!).mockReturnValueOnce(hung);
        if (stage === "vault")
          vi.mocked(input.api.resolve).mockReturnValueOnce(hung);
        render(<CredentialCopyActions {...input} />);
        const copy = screen.getByRole("button", { name: "Copy password" });
        fireEvent.click(copy);
        await flush();
        expect(copy).toBeDisabled();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(14_999);
        });
        expect(copy).toBeDisabled();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(screen.getByRole("status")).toHaveTextContent(
          "Reading the credential took too long and was stopped.",
        );
        expect(copy).toBeEnabled();
        expect(clipboard).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        fireEvent.click(copy);
        await flush();
        expect(screen.getByRole("status")).toHaveTextContent(
          "Password copied.",
        );
        expect(clipboard).toHaveBeenCalledExactlyOnceWith(
          stage === "vault" ? "VAULT_PASSWORD" : "CURRENT_LOCAL_PASSWORD",
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("never discloses a vault secret that arrives after its attempt timed out", async () => {
    vi.useFakeTimers();
    try {
      const input = fixture();
      const late = deferred<{ password: string }>();
      vi.mocked(input.api.resolve).mockReturnValueOnce(late.promise);
      const view = render(<CredentialCopyActions {...input} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      await act(async () => late.resolve({ password: "LATE_SECRET" }));
      expect(clipboard).not.toHaveBeenCalled();
      expect(view.container.innerHTML).not.toContain("LATE_SECRET");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Reading the credential took too long",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting for a typing target that never answers, revokes it, and lets the next action work", async () => {
    vi.useFakeTimers();
    try {
      const input = fixture(false);
      const disclosed: (() => void)[] = [];
      const hung = typingTarget({
        type: vi.fn((_value, check) => {
          disclosed.push(check);
          return new Promise<void>(() => {});
        }),
      });
      const view = render(
        <CredentialCopyActions {...input} typingTarget={hung} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Type password" }));
      await flush();
      expect(hung.type).toHaveBeenCalledOnce();
      // Above every target's own limit: slow typing is not cut off early.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(44_999);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(hung.dispose).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByRole("status")).toHaveTextContent(
        "Typing stopped or was not confirmed. Some characters may have been entered",
      );
      expect(hung.dispose).toHaveBeenCalledOnce();
      // A late native callback of the abandoned attempt may not disclose.
      expect(disclosed[0]).toThrow();
      expect(vi.getTimerCount()).toBe(0);

      const next = typingTarget();
      view.rerender(<CredentialCopyActions {...input} typingTarget={next} />);
      fireEvent.click(screen.getByRole("button", { name: "Type username" }));
      await flush();
      expect(next.type).toHaveBeenCalledExactlyOnceWith(
        "CURRENT_LOCAL_USER",
        expect.any(Function),
        undefined,
      );
      expect(screen.getByRole("status")).toHaveTextContent("Username typed.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a rejecting form so a caller can report the cause itself", async () => {
    const input = fixture(false);
    input.persisted.password = "";
    const target = typingTarget();
    const hook = renderHook(() =>
      useCredentialCopy(input.session, input.connection, target),
    );
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current
        .typeOrThrow("password")
        .catch((caught: unknown) => caught);
    });
    expect(outcome).toBeInstanceOf(CredentialFailure);
    expect(outcome).toMatchObject({ code: "password-empty" });
    expect(hook.result.current.message).toBe(
      "No password is saved for this credential.",
    );
    await act(async () => {
      outcome = await hook.result.current.type("password");
    });
    expect(outcome).toEqual({
      ok: false,
      code: "password-empty",
      message: "No password is saved for this credential.",
    });
    expect(target.type).not.toHaveBeenCalled();
  });
});

describe("one authenticator rule at every disclosure site", () => {
  const cfg = {
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "sha1" as const,
    digits: 6,
    period: 30,
    account: "test",
    issuer: "test",
  };
  const step = 1_800_000_000_000;
  it.each([
    [2999, false],
    [3000, true],
  ])(
    "with %i ms of the step left, all three former rules agree (allowed=%s)",
    async (remaining, allowed) => {
      vi.spyOn(Date, "now").mockReturnValue(step + 30_000 - remaining);
      const compute = vi
        .spyOn(totpApi, "computeCode")
        .mockResolvedValue("123456");

      // 1. The shared copy/type hook (connection-local authenticator).
      const local = fixture(false, { totpConfigs: [cfg] });
      const target: CredentialTypingTarget = {
        sessionId: "session",
        assertCurrent: vi.fn(),
        dispose: vi.fn(),
        type: vi.fn(async (_value, check) => {
          check();
        }),
      };
      const copyHook = renderHook(() =>
        useCredentialCopy(local.session, local.connection, target),
      );
      let typed!: Awaited<ReturnType<typeof copyHook.result.current.typeCode>>;
      await act(async () => {
        typed = await copyHook.result.current.typeCode({ localIndex: 0 });
      });
      copyHook.unmount();

      // 2. The connection-local code panel's Copy button.
      const panel = render(
        <WebTotpPanel
          configs={[cfg]}
          ownerDatabaseId="owner"
          connectionId="saved"
          onClose={vi.fn()}
        />,
      );
      await screen.findByText("123456");
      fireEvent.click(screen.getByRole("button", { name: "Copy code 1" }));
      await flush();
      const copied = clipboard.mock.calls.length === 1;
      panel.unmount();

      // 3. The vault authenticator controller.
      const vault = fixture(true);
      const snapshot = await vault.api.list(vault.api.scope!);
      snapshot.entries[0].availableFacets = ["totp"];
      vi.mocked(vault.api.list).mockResolvedValue(snapshot);
      vi.mocked(vault.api.resolve).mockResolvedValue({
        totp: [{ ...cfg, digits: 6, id: "otp", label: "test" }],
      });
      const vaultHook = renderHook(() =>
        useRuntimeVaultTotp(vault.session, vault.connection),
      );
      const generated = await vaultHook.result.current.generate("otp").then(
        () => "generated",
        (error: { code?: string }) => error.code,
      );

      expect({
        typed: typed.ok ? "generated" : typed.code,
        copied,
        generated,
      }).toEqual(
        allowed
          ? { typed: "generated", copied: true, generated: "generated" }
          : {
              typed: "code-window-closing",
              copied: false,
              generated: "code-window-closing",
            },
      );
      // The display itself is not a disclosure: the panel showed the code.
      expect(compute).toHaveBeenCalled();
    },
  );
});
