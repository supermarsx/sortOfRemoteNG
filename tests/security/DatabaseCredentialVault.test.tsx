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
import {
  databaseCredentialMetadata,
  normalizeDatabaseCredentialEntry,
} from "../../src/utils/security/databaseCredentialVault";
import DatabaseCredentialVault from "../../src/components/security/DatabaseCredentialVault";
import CredentialSourceSection from "../../src/components/connectionEditor/CredentialSourceSection";
import DatabaseCredentialVaultSection from "../../src/components/SettingsDialog/sections/security/DatabaseCredentialVaultSection";
vi.mock("../../src/components/ui/dialogs/ConfirmDialog", () => ({
  ConfirmDialog: ({
    isOpen,
    message,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div role="dialog">
        <p>{message}</p>
        <button onClick={onConfirm}>Confirm review</button>
        <button onClick={onCancel}>Cancel review</button>
      </div>
    ) : null,
}));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const entry = (): DatabaseCredentialEntry => ({
  id,
  name: "NAS operator",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  facets: {
    username: "PRIVATE_ACCOUNT",
    password: "PRIVATE_PASSWORD",
    privateKey: "PRIVATE_KEY\nSECOND_LINE",
    totp: [
      {
        id,
        label: "OTP",
        secret: "JBSWY3DPEHPK3PXP",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      },
    ],
  },
});
function facade(initial: DatabaseCredentialEntry[] = []) {
  let rows = structuredClone(initial),
    revision = 0;
  const scope = { databaseId: "db-a", generation: 1 };
  const snapshot = (): DatabaseCredentialSnapshot => ({
    scope,
    revision,
    receipt: `review-${revision}`,
    entries: rows.map(databaseCredentialMetadata),
  });
  const api: DatabaseCredentialVaultApi = {
    scope,
    changeRevision: 0,
    list: vi.fn(async () => snapshot()),
    resolve: vi.fn<DatabaseCredentialVaultApi["resolve"]>(
      async (_snapshot, id, requested) =>
        structuredClone(
          Object.fromEntries(
            requested.map((key) => [
              key,
              rows.find((row) => row.id === id)!.facets[key],
            ]),
          ),
        ),
    ),
    compareAndSwap: vi.fn(async (review, changes) => {
      if (review.revision !== revision) throw Error("stale review");
      for (const change of changes) {
        if (change.operation === "delete")
          rows = rows.filter((row) => row.id !== change.id);
        else {
          const next = normalizeDatabaseCredentialEntry(change.entry);
          rows = [...rows.filter((row) => row.id !== next.id), next];
        }
      }
      revision++;
    }),
  };
  return { api, snapshot };
}
const context = (api: DatabaseCredentialVaultApi): ConnectionContextType =>
  ({ credentialVault: api }) as ConnectionContextType;
const mount = (
  api: DatabaseCredentialVaultApi,
  children: React.ReactNode = <DatabaseCredentialVault />,
) =>
  render(
    <ConnectionContext.Provider value={context(api)}>
      {children}
    </ConnectionContext.Provider>,
  );
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(cleanup);

describe("database vault manager", () => {
  it("reads metadata only until explicit Edit, masks every secret and preserves multiline keys", async () => {
    const { api } = facade([entry()]);
    mount(api);
    await screen.findByRole("button", { name: "Edit NAS operator" });
    expect(api.resolve).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/PRIVATE_|JBSW/);
    fireEvent.click(screen.getByRole("button", { name: "Edit NAS operator" }));
    const password = await screen.findByLabelText("Password", {
      selector: "input[type=password]",
    });
    expect(password).toHaveValue("PRIVATE_PASSWORD");
    expect(
      screen.getByLabelText("Private key", {
        selector: "input[type=password]",
      }),
    ).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Authenticator 1 seed")).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal private key" }));
    expect(screen.getByRole("textbox", { name: "Private key" })).toHaveValue(
      "PRIVATE_KEY\nSECOND_LINE",
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide private key" }));
    fireEvent.change(screen.getByLabelText("Credential name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save credential" }));
    await screen.findByRole("button", { name: "Edit Renamed" });
    expect(api.compareAndSwap).toHaveBeenCalledWith(expect.anything(), [
      {
        operation: "put",
        entry: expect.objectContaining({
          name: "Renamed",
          facets: expect.objectContaining({
            privateKey: "PRIVATE_KEY\nSECOND_LINE",
          }),
        }),
      },
    ]);
  });
  it("creates independent username/password/TOTP combinations using validated fields", async () => {
    const { api } = facade();
    mount(api);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "New credential" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "New credential" }));
    expect(
      screen.getByRole("button", { name: "Save credential" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Credential name"), {
      target: { value: "Reusable" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Username" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Password" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "TOTP authenticators" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Username" }), {
      target: { value: "account" },
    });
    fireEvent.change(
      screen.getByLabelText("Password", { selector: "input[type=password]" }),
      { target: { value: "new-secret" } },
    );
    fireEvent.change(screen.getByLabelText("Authenticator 1 seed"), {
      target: { value: "jbsw y3dp ehpk 3pxp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save credential" }));
    await screen.findByRole("button", { name: "Edit Reusable" });
    expect(api.resolve).not.toHaveBeenCalled();
    expect(api.compareAndSwap).toHaveBeenCalledWith(expect.anything(), [
      {
        operation: "put",
        entry: expect.objectContaining({
          facets: expect.objectContaining({
            username: "account",
            password: "new-secret",
            totp: [expect.objectContaining({ secret: "JBSWY3DPEHPK3PXP" })],
          }),
        }),
      },
    ]);
  });
  it("keeps a failed-save draft and requires explicit review before deletion", async () => {
    const { api } = facade([entry()]);
    mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit NAS operator" }),
    );
    fireEvent.change(await screen.findByLabelText("Credential name"), {
      target: { value: "Keep me" },
    });
    vi.mocked(api.compareAndSwap).mockRejectedValueOnce(
      Error("PRIVATE_BACKEND_VALUE"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save credential" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      "PRIVATE_BACKEND_VALUE",
    );
    expect(screen.getByLabelText("Credential name")).toHaveValue("Keep me");
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel review" }));
    expect(screen.getByLabelText("Credential name")).toHaveValue("Keep me");
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete NAS operator" }),
    );
    expect(api.compareAndSwap).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Edit NAS operator" }),
      ).not.toBeInTheDocument(),
    );
    expect(api.compareAndSwap).toHaveBeenLastCalledWith(
      expect.objectContaining({ receipt: "review-0" }),
      [{ operation: "delete", id }],
    );
  });
  it("drops an in-flight secret edit when its owning scope is replaced", async () => {
    const { api } = facade([entry()]),
      gate = deferred<DatabaseCredentialEntry["facets"]>();
    vi.mocked(api.resolve).mockReturnValueOnce(gate.promise);
    const view = mount(api);
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit NAS operator" }),
    );
    const other = facade().api;
    other.scope = { databaseId: "db-b", generation: 2 };
    view.rerender(
      <ConnectionContext.Provider value={context(other)}>
        <DatabaseCredentialVault />
      </ConnectionContext.Provider>,
    );
    await act(async () => gate.resolve(entry().facets));
    expect(screen.queryByLabelText("Credential name")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("PRIVATE_");
    expect(other.resolve).not.toHaveBeenCalled();
  });
  it("accepts provider bindings only as non-portable metadata and exposes no token fields", async () => {
    const { api } = facade();
    mount(api);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "New credential" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "New credential" }));
    fireEvent.change(screen.getByLabelText("Credential name"), {
      target: { value: "External identity" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Social sign-in bindings" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Passkey bindings" }));
    fireEvent.change(screen.getByLabelText("Social binding 1 provider"), {
      target: { value: "Example SSO" },
    });
    fireEvent.change(
      screen.getByLabelText(
        "Social binding 1 Website HTTPS origin where sign-in starts",
      ),
      {
        target: { value: "https://example.com" },
      },
    );
    fireEvent.change(screen.getByLabelText("Passkey binding 1 provider"), {
      target: { value: "Hardware key" },
    });
    fireEvent.change(
      screen.getByLabelText("Passkey binding 1 relying-party domain"),
      { target: { value: "example.com" } },
    );
    expect(screen.queryByLabelText(/access token/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save credential" }));
    await screen.findByRole("button", { name: "Edit External identity" });
    const changes = vi.mocked(api.compareAndSwap).mock.calls[0][1];
    expect(changes[0]).toMatchObject({
      entry: {
        facets: {
          social: [{ portable: false }],
          passkey: [{ portable: false }],
        },
      },
    });
  });
});

describe("vault picker and settings entry point", () => {
  function Picker({
    initial = { password: "LOCAL_SECRET" },
    capture,
  }: {
    initial?: Partial<Connection>;
    capture?: (value: Partial<Connection>) => void;
  }) {
    const [form, setForm] = useState(initial);
    capture?.(form);
    return <CredentialSourceSection formData={form} setFormData={setForm} />;
  }
  it("searches only same-owner metadata and saves a reference without resolving secrets", async () => {
    const { api } = facade([entry()]);
    let saved: Partial<Connection> = {};
    mount(
      api,
      <Picker
        capture={(value) => {
          saved = value;
        }}
      />,
    );
    expect(api.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Database vault" }));
    const picker = await screen.findByRole("combobox", {
      name: "Reusable vault credential",
    });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search credential names or types" }),
      { target: { value: "NAS" } },
    );
    fireEvent.mouseDown(screen.getByRole("option", { name: /NAS operator/ }));
    expect(saved).toMatchObject({
      password: "LOCAL_SECRET",
      credentialSource: { kind: "vault", credentialId: id },
    });
    expect(api.resolve).not.toHaveBeenCalled();
    expect(api.compareAndSwap).not.toHaveBeenCalled();
    expect(screen.getByRole("note")).toHaveTextContent("preserved but ignored");
    fireEvent.click(screen.getByRole("button", { name: "Connection-local" }));
    expect(saved.credentialSource).toEqual({ kind: "local" });
    expect(saved.password).toBe("LOCAL_SECRET");
  });
  it("does not display stale-owner picker rows after a database change", async () => {
    const { api } = facade([entry()]);
    const view = mount(
      api,
      <Picker
        initial={{ credentialSource: { kind: "vault", credentialId: id } }}
      />,
    );
    // Credential picker plus the explicit selected-authenticator metadata picker.
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    const other = facade().api;
    other.scope = { databaseId: "db-b", generation: 2 };
    view.rerender(
      <ConnectionContext.Provider value={context(other)}>
        <Picker />
      </ConnectionContext.Provider>,
    );
    expect(
      screen.getByRole("combobox", { name: "Reusable vault credential" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "owning database changed",
    );
    expect(other.list).not.toHaveBeenCalled();
  });
  it("loads the settings manager only after explicit action and guards its dirty close", async () => {
    const { api } = facade();
    mount(api, <DatabaseCredentialVaultSection />);
    expect(api.list).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Manage database credentials" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "New credential" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "New credential" }));
    fireEvent.change(screen.getByLabelText("Credential name"), {
      target: { value: "Unsaved" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Close credential vault" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel review" }));
    expect(screen.getByLabelText("Credential name")).toHaveValue("Unsaved");
    fireEvent.click(
      screen.getByRole("button", { name: "Close credential vault" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    expect(screen.queryByLabelText("Credential name")).not.toBeInTheDocument();
  });
  it("shows locked state without a current database instead of global credentials", () => {
    const { api } = facade([entry()]);
    api.scope = null;
    mount(api);
    expect(
      screen.getByText("Database credential vault unavailable"),
    ).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });
});
