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
    revision = 0;
  const api: DatabaseCredentialVaultApi = {
    scope: { databaseId: "owning-db", generation: 1 },
    changeRevision: 0,
    list: vi.fn(async () => ({
      scope: { ...api.scope! },
      revision,
      receipt: `receipt-${revision}`,
      entries: entries.map(databaseCredentialMetadata),
    })),
    resolve: vi.fn<DatabaseCredentialVaultApi["resolve"]>(
      async (_review, id, facets) => {
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
    compareAndSwap: vi.fn(async (review, changes) => {
      if (review.revision !== revision) throw new Error("conflict");
      for (const change of changes) {
        if (change.operation !== "put") throw new Error();
        entries = [
          ...entries.filter((entry) => entry.id !== change.entry.id),
          structuredClone(change.entry),
        ];
      }
      revision++;
    }),
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
function mount(api: DatabaseCredentialVaultApi, initial = local) {
  let draft = initial;
  function Editor() {
    const [form, setForm] = useState(initial);
    draft = form;
    return (
      <>
        <CredentialSourceSection formData={form} setFormData={setForm} />
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
