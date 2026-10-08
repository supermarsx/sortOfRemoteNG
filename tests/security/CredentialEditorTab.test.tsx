import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";
import type { CredentialEditorRequest } from "../../src/types/security/credentialEditor";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../src/types/security/databaseCredentialVault";
import CredentialEditorTab from "../../src/components/security/databaseCredentialVault/CredentialEditorTab";
import DatabaseCredentialVault from "../../src/components/security/DatabaseCredentialVault";
import { databaseCredentialMetadata } from "../../src/utils/security/databaseCredentialVault";
import { getCredentialVaultDraft } from "../../src/utils/security/credentialVaultDrafts";
import { credentialVaultUsage } from "../../src/utils/security/credentialVaultUsage";

vi.mock("../../src/components/ui/dialogs/ConfirmDialog", () => ({
  ConfirmDialog: ({
    isOpen,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div role="dialog">
        <button onClick={onConfirm}>Discard changes</button>
        <button onClick={onCancel}>Keep editing</button>
      </div>
    ) : null,
}));
afterEach(cleanup);
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const connection = (
  key: string,
  extra: Partial<Connection> = {},
): Connection => ({
  id: key,
  name: `Server ${key}`,
  protocol: "ssh",
  hostname: "PRIVATE_HOST",
  port: 22,
  isGroup: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  username: "PRIVATE_ACCOUNT",
  password: "PRIVATE_PASSWORD",
  ...extra,
});
function fixture(mode: CredentialEditorRequest["mode"] = "edit") {
  let entries: DatabaseCredentialEntry[] =
    mode === "edit"
      ? [
          {
            id,
            name: "Login",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            facets: {
              username: "PRIVATE_ACCOUNT",
              password: "PRIVATE_PASSWORD",
            },
          },
        ]
      : [];
  let revision = 0;
  let connections = [connection("source")];
  const scope = { databaseId: "db-a", generation: 1 };
  const snapshot = (): DatabaseCredentialSnapshot => ({
    scope: { ...scope },
    receipt: `review-${revision}`,
    revision,
    entries: entries.map(databaseCredentialMetadata),
  });
  const api: DatabaseCredentialVaultApi = {
    scope,
    changeRevision: 0,
    list: vi.fn(async () => snapshot()),
    resolve: vi.fn<DatabaseCredentialVaultApi["resolve"]>(
      async (_review, key, facets) =>
        Object.fromEntries(
          facets.map((facet) => [
            facet,
            entries.find((entry) => entry.id === key)!.facets[facet],
          ]),
        ),
    ),
    compareAndSwap: vi.fn(async (_review, changes) => {
      for (const change of changes)
        if (change.operation === "put")
          entries = [
            ...entries.filter((entry) => entry.id !== change.entry.id),
            structuredClone(change.entry),
          ];
      revision++;
    }),
  };
  let context = {
    credentialVault: api,
    databaseAvailability: {
      status: "ready",
      databaseId: scope.databaseId,
      generation: 7,
    },
    getCurrentConnections: vi.fn(() => connections),
    dispatchAndFlush: vi.fn(async (action) => {
      if (action.type === "UPDATE_CONNECTION") connections = [action.payload];
    }),
  } as unknown as ConnectionContextType;
  const request: CredentialEditorRequest =
    mode === "edit"
      ? { mode, scope: { ...scope }, credentialId: id }
      : mode === "migrate"
        ? { mode, scope: { ...scope }, connectionId: "source" }
        : { mode, scope: { ...scope } };
  const close = vi.fn(() => {
    expect(getCredentialVaultDraft("editor")?.busy).toBe(false);
    expect(getCredentialVaultDraft("editor")?.dirty).toBe(false);
  });
  const view = () => (
    <ConnectionContext.Provider value={context}>
      <CredentialEditorTab
        request={request}
        sessionId="editor"
        onClose={close}
      />
    </ConnectionContext.Provider>
  );
  return {
    api,
    request,
    view,
    close,
    snapshot,
    getContext: () => context,
    getConnections: () => connections,
    setConnections: (next: Connection[]) => {
      connections = next;
    },
    setContext: (next: ConnectionContextType) => {
      context = next;
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("separate private credential editor tab", () => {
  it("synchronously clears close metadata after verified save, before onClose", async () => {
    const f = fixture();
    render(f.view());
    fireEvent.change(await screen.findByLabelText("Credential name"), {
      target: { value: "Renamed" },
    });
    const reveal = screen.getByRole("button", { name: "Reveal password" });
    expect(reveal).toHaveClass("absolute", "right-1");
    expect(reveal.closest("label")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Login details" }),
    ).toBeInTheDocument();
    expect(getCredentialVaultDraft("editor")?.dirty).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save credential" }));
    await waitFor(() => expect(f.close).toHaveBeenCalledOnce());
    expect(f.api.compareAndSwap).toHaveBeenCalledOnce();
  });
  it("explicit discard clears close metadata without saving, and Keep editing retains the draft", async () => {
    const f = fixture();
    render(f.view());
    fireEvent.change(await screen.findByLabelText("Credential name"), {
      target: { value: "Private draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(getCredentialVaultDraft("editor")?.dirty).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.api.compareAndSwap).not.toHaveBeenCalled();
  });
  it.each(["lock", "owner", "generation", "availability"])(
    "drops private drafts and never rebinds after %s",
    async (change) => {
      const f = fixture();
      const mounted = render(f.view());
      await screen.findByLabelText("Credential name");
      const original = f.getContext();
      if (change === "lock")
        f.setContext({
          ...original,
          credentialVault: { ...f.api, scope: null },
        });
      else if (change === "availability")
        f.setContext({
          ...original,
          databaseAvailability: {
            ...original.databaseAvailability!,
            generation: 8,
          },
        });
      else
        f.setContext({
          ...original,
          credentialVault: {
            ...f.api,
            scope: {
              databaseId: change === "owner" ? "db-b" : "db-a",
              generation: change === "generation" ? 2 : 1,
            },
          },
        });
      mounted.rerender(f.view());
      expect(
        screen.queryByLabelText("Credential name"),
      ).not.toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain("PRIVATE_PASSWORD");
      expect(getCredentialVaultDraft("editor")).toBeUndefined();
      f.setContext(original);
      mounted.rerender(f.view());
      expect(screen.getByRole("status")).toHaveTextContent("expired");
      expect(
        screen.queryByLabelText("Credential name"),
      ).not.toBeInTheDocument();
    },
  );
  it("drops a late secret resolution after lock", async () => {
    const f = fixture();
    const gate = deferred<DatabaseCredentialEntry["facets"]>();
    vi.mocked(f.api.resolve).mockReturnValueOnce(gate.promise);
    const mounted = render(f.view());
    await waitFor(() => expect(f.api.resolve).toHaveBeenCalled());
    f.setContext({
      ...f.getContext(),
      credentialVault: { ...f.api, scope: null },
    });
    mounted.rerender(f.view());
    await act(async () => gate.resolve({ password: "LATE_PRIVATE_PASSWORD" }));
    expect(document.body.innerHTML).not.toContain("LATE_PRIVATE_PASSWORD");
    expect(f.api.compareAndSwap).not.toHaveBeenCalled();
  });
  it("cancels migration without a vault write or connection save and previews no values", async () => {
    const f = fixture("migrate");
    render(f.view());
    await screen.findByLabelText("Credential name");
    expect(document.body.innerHTML).not.toMatch(
      /PRIVATE_ACCOUNT|PRIVATE_PASSWORD|PRIVATE_HOST/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.api.compareAndSwap).not.toHaveBeenCalled();
    expect(f.getContext().dispatchAndFlush).not.toHaveBeenCalled();
  });
  it("keeps local values and reuses its entry ID after uncertain vault write", async () => {
    const f = fixture("migrate");
    const realWrite = vi.mocked(f.api.compareAndSwap).getMockImplementation()!;
    vi.mocked(f.api.compareAndSwap).mockImplementationOnce(async (...args) => {
      await realWrite(...args);
      throw new Error("PRIVATE_FAILURE");
    });
    render(f.view());
    await screen.findByLabelText("Credential name");
    fireEvent.click(
      screen.getByRole("button", { name: "Save to vault and link connection" }),
    );
    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      "PRIVATE_FAILURE",
    );
    expect(f.getConnections()[0].password).toBe("PRIVATE_PASSWORD");
    expect(f.getContext().dispatchAndFlush).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save to vault and link connection" }),
    );
    await waitFor(() => expect(f.close).toHaveBeenCalledOnce());
    expect(f.api.compareAndSwap).toHaveBeenCalledOnce();
    expect(f.snapshot().entries).toHaveLength(1);
    expect(f.getConnections()[0]).toMatchObject({
      password: "",
      credentialSource: {
        kind: "vault",
        credentialId: f.snapshot().entries[0].id,
      },
    });
  });
});

describe("vault list scrolling, scoped usage and tab navigation", () => {
  it("counts distinct saved references, not matching values, facets or unrelated IDs", () => {
    const rows = [
      connection("a", {
        credentialSource: { kind: "vault", credentialId: id, totpId: "totp" },
      }),
      connection("a", {
        credentialSource: { kind: "vault", credentialId: id },
      }),
      connection("b", {
        credentialSource: { kind: "vault", credentialId: id },
      }),
      connection("local"),
      connection("other", {
        credentialSource: { kind: "vault", credentialId: "other" },
      }),
    ];
    expect(credentialVaultUsage(rows).get(id)).toBe(2);
    expect(credentialVaultUsage(rows).get("other")).toBe(1);
  });
  it("renders bounded keyboard-accessible themed scrolling and usage unaffected by search", async () => {
    const f = fixture();
    f.setConnections([
      connection("source"),
      connection("ref", {
        credentialSource: { kind: "vault", credentialId: id },
      }),
    ]);
    const open = vi.fn();
    render(
      <ConnectionContext.Provider value={f.getContext()}>
        <DatabaseCredentialVault onOpenEditor={open} />
      </ConnectionContext.Provider>,
    );
    await screen.findByRole("button", { name: "Edit Login" });
    const region = screen.getByRole("region", { name: "Credential inventory" });
    expect(region).toHaveClass("min-h-0", "overflow-y-auto");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.parentElement).toHaveClass("h-full");
    expect(
      screen.getByLabelText("1 saved connection references"),
    ).toHaveTextContent("1");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move credentials from Server source to vault",
      }),
    );
    expect(open).toHaveBeenLastCalledWith({
      mode: "migrate",
      scope: f.request.scope,
      connectionId: "source",
    });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Login" },
    });
    expect(
      screen.getByLabelText("1 saved connection references"),
    ).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Edit Login" }));
    expect(open).toHaveBeenLastCalledWith({
      mode: "edit",
      scope: f.request.scope,
      credentialId: id,
    });
    expect(f.api.resolve).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Credential name")).not.toBeInTheDocument();
    expect(JSON.stringify(open.mock.calls)).not.toContain("PRIVATE_");
  });
  it("does not claim zero usages when the connection scope is unavailable", async () => {
    const f = fixture();
    render(
      <ConnectionContext.Provider
        value={{
          ...f.getContext(),
          databaseAvailability: {
            status: "ready",
            databaseId: "other",
            generation: 7,
          },
        }}
      >
        <DatabaseCredentialVault />
      </ConnectionContext.Provider>,
    );
    await screen.findByRole("button", { name: "Edit Login" });
    expect(screen.getByLabelText("Usage unavailable")).toHaveTextContent("—");
    expect(f.getContext().getCurrentConnections).not.toHaveBeenCalled();
  });
});
