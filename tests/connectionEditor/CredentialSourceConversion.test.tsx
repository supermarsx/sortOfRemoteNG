import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CredentialSourceSection from "../../src/components/connectionEditor/CredentialSourceSection";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../src/types/security/databaseCredentialVault";
import { databaseCredentialMetadata } from "../../src/utils/security/databaseCredentialVault";

vi.mock("../../src/components/ui/forms", () => ({
  Select: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string; disabled?: boolean }[];
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const entry = (): DatabaseCredentialEntry => ({
  id,
  name: "Shared login",
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
  facets: {
    username: "vault-user",
    password: "vault-password",
    privateKey: "unneeded-key",
    social: [
      {
        id,
        provider: "Example",
        origin: "https://example.com",
        portable: false,
      },
    ],
  },
});
function facade(initial: DatabaseCredentialEntry[] = []) {
  let entries = structuredClone(initial),
    revision = 0,
    receiptId = 0;
  const receipts = new Map<string, number>();
  const assertScope = (scope: DatabaseCredentialSnapshot["scope"]) => {
    if (
      !api.scope ||
      scope.databaseId !== api.scope.databaseId ||
      scope.generation !== api.scope.generation
    )
      throw new Error("owner changed");
  };
  const assertReviewed = (review: DatabaseCredentialSnapshot) => {
    assertScope(review.scope);
    if (
      receipts.get(review.receipt) !== revision ||
      review.revision !== revision
    )
      throw new Error("review expired");
  };
  const api: DatabaseCredentialVaultApi = {
    scope: { databaseId: "owning-db", generation: 1 },
    changeRevision: 0,
    list: vi.fn<DatabaseCredentialVaultApi["list"]>(async (scope) => {
      assertScope(scope);
      const receipt = `receipt-${++receiptId}`;
      receipts.set(receipt, revision);
      return {
        scope: { ...scope },
        revision,
        receipt,
        entries: entries.map(databaseCredentialMetadata),
      };
    }),
    resolve: vi.fn<DatabaseCredentialVaultApi["resolve"]>(
      async (review, id, facets) => {
        assertReviewed(review);
        const saved = entries.find((entry) => entry.id === id)!;
        return structuredClone(
          Object.fromEntries(
            facets
              .filter((facet) => saved.facets[facet] !== undefined)
              .map((facet) => [facet, saved.facets[facet]]),
          ),
        );
      },
    ),
    compareAndSwap: vi.fn<DatabaseCredentialVaultApi["compareAndSwap"]>(
      async (review, changes) => {
        assertReviewed(review);
        for (const change of changes) {
          if (change.operation !== "put") throw new Error();
          entries = [
            ...entries.filter((entry) => entry.id !== change.entry.id),
            structuredClone(change.entry),
          ];
        }
        revision++;
        receipts.clear();
        api.changeRevision++;
      },
    ),
  };
  return api;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const local: Partial<Connection> = {
  id: "connection",
  name: "My login",
  protocol: "https",
  username: "local-user",
  password: "local-password",
};
function mount(
  api: DatabaseCredentialVaultApi,
  initial = local,
  conversion?: {
    read: (draft: Partial<Connection>) => Partial<Connection>;
    apply: (patch: Partial<Connection>) => void;
  },
) {
  let draft = initial;
  function Editor() {
    const [form, setForm] = useState(initial);
    draft = form;
    return (
      <>
        <CredentialSourceSection
          formData={form}
          setFormData={setForm}
          credentialConversion={
            conversion
              ? {
                  read: () => conversion.read(form),
                  apply: (patch) => {
                    conversion.apply(patch);
                    setForm((previous) => ({ ...previous, ...patch }));
                  },
                }
              : undefined
          }
        />
        <button
          onClick={() =>
            setForm((previous) => ({ ...previous, username: "edited" }))
          }
        >
          Edit username
        </button>
      </>
    );
  }
  const contents = (current: DatabaseCredentialVaultApi) => (
    <ConnectionContext.Provider
      value={{ credentialVault: current } as ConnectionContextType}
    >
      <Editor />
    </ConnectionContext.Provider>
  );
  const view = render(contents(api));
  return {
    draft: () => draft,
    changeOwner: (next: DatabaseCredentialVaultApi) =>
      view.rerender(contents(next)),
    unmount: view.unmount,
  };
}
async function startMove(target = "") {
  fireEvent.click(
    screen.getByRole("button", { name: "Move local credentials to vault" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Conversion destination")).toBeEnabled(),
  );
  if (target)
    fireEvent.change(screen.getByLabelText("Conversion destination"), {
      target: { value: target },
    });
  fireEvent.click(
    screen.getByRole("button", { name: "Save to vault and switch source" }),
  );
}
afterEach(cleanup);

describe("explicit credential conversion", () => {
  it("does not create a duplicate when retrying a committed but unverified new credential", async () => {
    const api = facade();
    vi.mocked(api.resolve).mockRejectedValueOnce(
      new Error("PRIVATE_VERIFY_FAILURE"),
    );
    const view = mount(api);
    await startMove();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /write finished.*could not be verified/i,
    );
    expect(view.draft()).toEqual(local);
    const first = await api.list(api.scope!);
    expect(first.entries).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Save to vault and switch source" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Conversion destination")).toHaveValue(
        first.entries[0].id,
      ),
    );
    expect(api.compareAndSwap).toHaveBeenCalledOnce();
    expect(view.draft()).toEqual(local);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /previous attempt.*review/i,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save to vault and switch source" }),
    );
    await screen.findByText(/Vault write verified/);
    expect((await api.list(api.scope!)).entries).toHaveLength(1);
    expect(view.draft().credentialSource).toEqual({
      kind: "vault",
      credentialId: first.entries[0].id,
    });
  });

  it("keeps the draft and releases busy after a managed draft read throws, permitting explicit retry", async () => {
    const api = facade();
    const conversion = {
      read: vi.fn((draft: Partial<Connection>) => draft),
      apply: vi.fn(),
    };
    conversion.read.mockImplementationOnce(() => {
      throw new Error("PRIVATE_DRAFT_READ");
    });
    const view = mount(api, local, conversion);
    await startMove();
    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      "PRIVATE_DRAFT_READ",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /draft could not be read.*No vault write was attempted/i,
    );
    expect(view.draft()).toEqual(local);
    expect(api.compareAndSwap).not.toHaveBeenCalled();
    const save = screen.getByRole("button", {
      name: "Save to vault and switch source",
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await screen.findByText(/Vault write verified/);
    expect(conversion.apply).toHaveBeenCalledOnce();
  });

  it("does not attempt conversion while metadata failed and permits retry after reloading", async () => {
    const api = facade();
    vi.mocked(api.list).mockRejectedValueOnce(
      new Error("PRIVATE_METADATA_FAILURE"),
    );
    const view = mount(api);
    fireEvent.click(
      screen.getByRole("button", { name: "Move local credentials to vault" }),
    );
    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      "PRIVATE_METADATA_FAILURE",
    );
    const save = screen.getByRole("button", {
      name: "Save to vault and switch source",
    });
    expect(save).toBeDisabled();
    expect(api.compareAndSwap).not.toHaveBeenCalled();
    expect(view.draft()).toEqual(local);
    fireEvent.click(screen.getByRole("button", { name: "Reload credentials" }));
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await screen.findByText(/Vault write verified/);
  });

  it("reuses the attempted ID after a pre-commit write failure rather than allocating another destination", async () => {
    const api = facade();
    vi.mocked(api.compareAndSwap).mockRejectedValueOnce(
      new Error("PRIVATE_WRITE_FAILURE"),
    );
    mount(api);
    await startMove();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /write could not be confirmed.*may already have been saved/i,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save to vault and switch source" }),
    );
    await screen.findByText(/Vault write verified/);
    const calls = vi.mocked(api.compareAndSwap).mock.calls;
    const ids = calls.map(([, changes]) =>
      changes[0].operation === "put" ? changes[0].entry.id : "",
    );
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect((await api.list(api.scope!)).entries).toHaveLength(1);
  });

  it("retains the attempted ID when CAS commits then rejects, even if the next review read fails", async () => {
    const api = facade();
    const write = vi.mocked(api.compareAndSwap).getMockImplementation()!;
    vi.mocked(api.compareAndSwap).mockImplementationOnce(async (...args) => {
      await write(...args);
      throw new Error("PRIVATE_AFTER_COMMIT_FAILURE");
    });
    const view = mount(api);
    await startMove();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /write could not be confirmed/i,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "PRIVATE_AFTER_COMMIT_FAILURE",
    );
    expect(view.draft()).toEqual(local);
    const committed = await api.list(api.scope!);
    expect(committed.entries).toHaveLength(1);
    const save = screen.getByRole("button", {
      name: "Save to vault and switch source",
    });
    await waitFor(() => expect(save).toBeEnabled());
    vi.mocked(api.list).mockRejectedValueOnce(
      new Error("PRIVATE_REVIEW_FAILURE"),
    );
    fireEvent.click(save);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /metadata could not be loaded/i,
      ),
    );
    expect(view.draft()).toEqual(local);
    expect(api.compareAndSwap).toHaveBeenCalledOnce();
    expect(api.resolve).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(screen.getByLabelText("Conversion destination")).toHaveValue(
        committed.entries[0].id,
      ),
    );
    expect(api.compareAndSwap).toHaveBeenCalledOnce();
    expect(view.draft()).toEqual(local);
    fireEvent.click(save);
    await screen.findByText(/Vault write verified/);
    const final = await api.list(api.scope!);
    expect(final.entries.map((row) => row.id)).toEqual([
      committed.entries[0].id,
    ]);
    expect(view.draft().credentialSource).toEqual({
      kind: "vault",
      credentialId: committed.entries[0].id,
    });
  });

  it("uses the refreshed same-owner facade for post-write verification without dropping the review checks", async () => {
    const api = facade();
    const list = vi.mocked(api.list).getMockImplementation()!;
    const resolve = vi.mocked(api.resolve).getMockImplementation()!;
    const write = api.compareAndSwap;
    const view = mount(api);
    let next!: DatabaseCredentialVaultApi;
    api.compareAndSwap = vi.fn<DatabaseCredentialVaultApi["compareAndSwap"]>(
      async (...args) => {
        await write(...args);
        next = {
          ...api,
          scope: { ...api.scope! },
          list: vi.fn(list),
          resolve: vi.fn(resolve),
        };
        view.changeOwner(next);
      },
    );
    await startMove();
    await screen.findByText(/Vault write verified/);
    expect(next.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 1 }),
      expect.any(String),
      ["username", "password"],
    );
    expect(api.resolve).not.toHaveBeenCalled();
    expect(view.draft()).toMatchObject({
      credentialSource: { kind: "vault" },
      password: "",
    });
  });

  it("discards late metadata from a replaced facade and never selects its old rows", async () => {
    const old = facade([entry()]);
    const oldSnapshot = await old.list(old.scope!);
    const gate = deferred<DatabaseCredentialSnapshot>();
    vi.mocked(old.list).mockReturnValueOnce(gate.promise);
    const view = mount(old);
    fireEvent.click(
      screen.getByRole("button", { name: "Move local credentials to vault" }),
    );
    const next = facade([{ ...entry(), name: "Current metadata" }]);
    view.changeOwner(next);
    await waitFor(() =>
      expect(screen.getByLabelText("Conversion destination")).toBeEnabled(),
    );
    await act(async () => gate.resolve(oldSnapshot));
    expect(
      screen.queryByRole("option", { name: "Shared login" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Current metadata" }),
    ).toBeInTheDocument();
    expect(old.compareAndSwap).not.toHaveBeenCalled();
    expect(view.draft()).toEqual(local);
  });

  it("rejects metadata returned for a different owner and prevents writes", async () => {
    const api = facade();
    const bad = {
      ...(await api.list(api.scope!)),
      scope: { databaseId: "other", generation: 2 },
    };
    vi.mocked(api.list).mockResolvedValueOnce(bad);
    const view = mount(api);
    fireEvent.click(
      screen.getByRole("button", { name: "Move local credentials to vault" }),
    );
    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", { name: "Save to vault and switch source" }),
    ).toBeDisabled();
    expect(api.compareAndSwap).not.toHaveBeenCalled();
    expect(view.draft()).toEqual(local);
  });

  it("keeps newly edited managed SSH secrets when an earlier vault write completes", async () => {
    const api = facade();
    const gate = deferred<void>();
    const write = api.compareAndSwap;
    api.compareAndSwap = vi.fn<DatabaseCredentialVaultApi["compareAndSwap"]>(
      async (...args) => {
        await gate.promise;
        await write(...args);
      },
    );
    let secret = "SYNTHETIC_SSH_ORIGINAL";
    const initial = { ...local, protocol: "ssh" as const, password: "" };
    const conversion = {
      read: (form: Partial<Connection>) => ({ ...form, password: secret }),
      apply: vi.fn(),
    };
    const view = mount(api, initial, conversion);
    await startMove();
    await waitFor(() => expect(api.compareAndSwap).toHaveBeenCalledOnce());
    secret = "SYNTHETIC_SSH_EDITED";
    await act(async () => gate.resolve());
    await screen.findByRole("alert");
    expect(conversion.apply).not.toHaveBeenCalled();
    expect(secret).toBe("SYNTHETIC_SSH_EDITED");
    expect(view.draft()).toEqual(initial);
  });

  it("rejects an expired receipt during disclosure and does not clear local fields", async () => {
    const api = facade([entry()]);
    const gate = deferred<void>();
    const resolve = api.resolve;
    api.resolve = vi.fn<DatabaseCredentialVaultApi["resolve"]>(
      async (...args) => {
        await gate.promise;
        return resolve(...args);
      },
    );
    const initial = {
      ...local,
      credentialSource: { kind: "vault" as const, credentialId: id },
    };
    const view = mount(api, initial);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy vault credentials to connection-local",
      }),
    );
    await waitFor(() => expect(api.resolve).toHaveBeenCalledOnce());
    const anotherReview = await api.list(api.scope!);
    await api.compareAndSwap(anotherReview, [
      { operation: "put", entry: { ...entry(), name: "Concurrent edit" } },
    ]);
    await act(async () => gate.resolve());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /vault credentials could not be read/i,
    );
    expect(view.draft()).toEqual(initial);
  });

  it("creates, verifies and only then switches and clears the local fields", async () => {
    const api = facade(),
      gate = deferred<void>();
    const write = api.compareAndSwap;
    api.compareAndSwap = vi.fn<DatabaseCredentialVaultApi["compareAndSwap"]>(
      async (...args) => {
        await gate.promise;
        await write(...args);
      },
    );
    const view = mount(api);
    await startMove();
    await waitFor(() => expect(api.compareAndSwap).toHaveBeenCalledOnce());
    expect(view.draft()).toEqual(local);
    await act(async () => gate.resolve());
    await screen.findByText(/Vault write verified/);
    expect(view.draft()).toMatchObject({
      username: "",
      password: "",
      credentialSource: { kind: "vault" },
    });
    expect(api.resolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      ["username", "password"],
    );
  });
  it("replaces a selected credential's portable fields, retaining its provider binding", async () => {
    const api = facade([entry()]);
    const view = mount(api);
    await startMove(id);
    await screen.findByText(/Vault write verified/);
    expect(api.compareAndSwap).toHaveBeenCalledWith(expect.anything(), [
      {
        operation: "put",
        entry: expect.objectContaining({
          id,
          facets: {
            username: "local-user",
            password: "local-password",
            social: entry().facets.social,
          },
        }),
      },
    ]);
    expect(view.draft().credentialSource).toEqual({
      kind: "vault",
      credentialId: id,
    });
  });
  it.each(["write", "verify"])(
    "keeps the source intact after a %s failure without exposing errors",
    async (failure) => {
      const api = facade();
      if (failure === "write")
        vi.mocked(api.compareAndSwap).mockRejectedValueOnce(
          new Error("PRIVATE_BACKEND_SECRET"),
        );
      else
        vi.mocked(api.resolve).mockResolvedValueOnce({
          username: "different",
          password: "wrong",
        });
      const view = mount(api);
      await startMove();
      expect(await screen.findByRole("alert")).not.toHaveTextContent(
        "PRIVATE_BACKEND_SECRET",
      );
      expect(view.draft()).toEqual(local);
    },
  );
  it("copies only website login facets, clears stale local fields and keeps the shared entry", async () => {
    const api = facade([entry()]);
    const view = mount(api, {
      ...local,
      privateKey: "stale",
      basicAuthPassword: "stale-basic",
      httpAutoMfa: { version: 1, enabled: true },
      credentialSource: { kind: "vault", credentialId: id },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy vault credentials to connection-local",
      }),
    );
    await screen.findByText(/Vault credentials copied/);
    expect(api.resolve).toHaveBeenCalledExactlyOnceWith(expect.anything(), id, [
      "username",
      "password",
    ]);
    expect(api.compareAndSwap).not.toHaveBeenCalled();
    expect(view.draft()).toMatchObject({
      username: "vault-user",
      password: "vault-password",
      privateKey: "",
      basicAuthPassword: "",
      credentialSource: { kind: "local" },
      httpAutoMfa: { version: 1, enabled: false },
    });
  });
  it("keeps the vault source and draft on a failed disclosure", async () => {
    const api = facade([entry()]);
    vi.mocked(api.resolve).mockRejectedValueOnce(new Error("PRIVATE"));
    const initial = {
      ...local,
      credentialSource: { kind: "vault" as const, credentialId: id },
    };
    const view = mount(api, initial);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy vault credentials to connection-local",
      }),
    );
    await screen.findByRole("alert");
    expect(view.draft()).toEqual(initial);
  });
  it.each(["owner", "edit", "unmount"])(
    "rejects completion after %s changes during disclosure",
    async (change) => {
      const api = facade([entry()]),
        gate = deferred<DatabaseCredentialEntry["facets"]>();
      vi.mocked(api.resolve).mockReturnValueOnce(gate.promise);
      const initial = {
        ...local,
        credentialSource: { kind: "vault" as const, credentialId: id },
      };
      const view = mount(api, initial);
      fireEvent.click(
        screen.getByRole("button", {
          name: "Copy vault credentials to connection-local",
        }),
      );
      await waitFor(() => expect(api.resolve).toHaveBeenCalledOnce());
      if (change === "owner") {
        const next = facade();
        next.scope = { databaseId: "different", generation: 2 };
        view.changeOwner(next);
      } else if (change === "edit")
        fireEvent.click(screen.getByRole("button", { name: "Edit username" }));
      else view.unmount();
      await act(async () =>
        gate.resolve({ username: "vault-user", password: "vault-password" }),
      );
      expect(view.draft().credentialSource).toEqual(initial.credentialSource);
      expect(view.draft().password).toBe("local-password");
    },
  );
  it("rejects source switching after ownership changes during the vault write", async () => {
    const api = facade(),
      gate = deferred<void>();
    vi.mocked(api.compareAndSwap).mockReturnValueOnce(gate.promise);
    const view = mount(api);
    await startMove();
    await waitFor(() => expect(api.compareAndSwap).toHaveBeenCalledOnce());
    const other = facade();
    other.scope = { databaseId: "other", generation: 2 };
    view.changeOwner(other);
    await act(async () => gate.resolve());
    expect(view.draft()).toEqual(local);
    expect(other.resolve).not.toHaveBeenCalled();
  });
  it("does not offer conversion for a locked database", () => {
    const api = facade();
    api.scope = null;
    mount(api);
    expect(
      screen.getByRole("button", { name: "Move local credentials to vault" }),
    ).toBeDisabled();
    expect(api.list).not.toHaveBeenCalled();
  });
});
