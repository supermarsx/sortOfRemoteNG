import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConnectionContext } from "../../src/contexts/ConnectionContextTypes";
import AssociatedCredentialAccounts from "../../src/components/connectionEditor/AssociatedCredentialAccounts";
import { credentialAccountSelection } from "../../src/utils/security/connectionCredentialAccounts";
import type { Connection } from "../../src/types/connection/connection";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialVaultApi,
} from "../../src/types/security/databaseCredentialVault";

vi.mock("../../src/components/ui/forms", async (original) => ({
  ...(await original<typeof import("../../src/components/ui/forms")>()),
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input type="password" {...props} />
  ),
}));
const one = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const two = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let entries: DatabaseCredentialEntry[];
let api: DatabaseCredentialVaultApi;
beforeEach(() => {
  entries = [one, two].map((id, index) => ({
    id,
    name: index ? "Read-only account" : "Administrator",
    createdAt: "2026-11-27",
    updatedAt: "2026-11-27",
    facets: { username: "private-user", password: "private-password" },
  }));
  api = {
    scope: { databaseId: "owner", generation: 1 },
    changeRevision: 1,
    list: vi.fn(async () => ({
      scope: { databaseId: "owner", generation: 1 },
      revision: 1,
      receipt: "review",
      entries: entries.map(({ facets: _facets, ...entry }) => ({
        ...entry,
        availableFacets: ["username", "password"] as (
          "username" | "password"
        )[],
      })),
    })),
    resolve: vi.fn(),
    compareAndSwap: vi.fn(async (_snapshot, changes) => {
      for (const change of changes)
        if (change.operation === "put") entries.push(change.entry);
    }),
  };
});
function Fixture({ vault = api }: { vault?: DatabaseCredentialVaultApi }) {
  const [formData, setFormData] = useState<Partial<Connection>>({
    id: "connection",
    credentialSource: { kind: "vault", credentialId: one },
  });
  return (
    <ConnectionContext.Provider
      value={
        { credentialVault: vault } as React.ContextType<
          typeof ConnectionContext
        >
      }
    >
      <AssociatedCredentialAccounts
        formData={formData}
        setFormData={setFormData}
        onSelect={(account) =>
          setFormData((previous) => ({
            ...previous,
            ...credentialAccountSelection(previous, {
              kind: "vault",
              ...account,
            }),
          }))
        }
      />
      <output data-testid="saved-draft">{JSON.stringify(formData)}</output>
    </ConnectionContext.Provider>
  );
}
const draft = () => JSON.parse(screen.getByTestId("saved-draft").textContent!);
async function chooseAccount() {
  fireEvent.click(screen.getByRole("button", { name: "Link saved account" }));
  const picker = screen.getByRole("combobox", { name: "Account to associate" });
  await waitFor(() => expect(picker).not.toBeDisabled());
  fireEvent.click(picker);
  fireEvent.mouseDown(
    screen.getByRole("option", { name: "Read-only account" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Link account" }));
  await screen.findByText("Read-only account");
}
describe("associated connection accounts", () => {
  it("links and switches named accounts without disclosing passwords or removing the previous default", async () => {
    render(<Fixture />);
    await chooseAccount();
    expect(draft().credentialSource.credentialId).toBe(one);
    const row = screen.getByText("Read-only account").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Make default" }));
    expect(draft().credentialSource.credentialId).toBe(two);
    expect(draft().credentialAccounts).toEqual([
      { credentialId: one },
      { credentialId: two },
    ]);
    expect(api.resolve).not.toHaveBeenCalled();
    expect(screen.queryByText("private-user")).not.toBeInTheDocument();
    expect(JSON.stringify(draft())).not.toContain("private-password");
  });
  it("removes an association while keeping the reusable vault entry", async () => {
    render(<Fixture />);
    await chooseAccount();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Read-only account association",
      }),
    );
    expect(draft().credentialAccounts).toEqual([{ credentialId: one }]);
    expect(entries).toHaveLength(2);
    expect(api.compareAndSwap).not.toHaveBeenCalled();
  });
  it("creates a separate encrypted-vault entry and stores only its reference on the connection", async () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "New account" }));
    fireEvent.change(screen.getByLabelText("Account name"), {
      target: { value: "Personal account" },
    });
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "personal-user" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "personal-secret" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save account" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await screen.findByText("Personal account");
    expect(entries[2].facets).toEqual({
      username: "personal-user",
      password: "personal-secret",
    });
    expect(draft().credentialAccounts).toContainEqual({
      credentialId: entries[2].id,
    });
    expect(draft().credentialSource.credentialId).toBe(one);
    expect(JSON.stringify(draft())).not.toContain("personal-secret");
    expect(JSON.stringify(draft())).not.toContain("personal-user");
  });
  it("blocks account changes and clears the password draft after a database switch", async () => {
    const view = render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "New account" }));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "discard-me" },
    });
    view.rerender(
      <Fixture
        vault={{ ...api, scope: { databaseId: "other", generation: 2 } }}
      />,
    );
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Link saved account" }),
    ).toBeDisabled();
    expect(api.compareAndSwap).not.toHaveBeenCalled();
  });
  it("recovers a committed but unconfirmed save without creating another account", async () => {
    api.compareAndSwap = vi.fn(async (_snapshot, changes) => {
      for (const change of changes)
        if (change.operation === "put") entries.push(change.entry);
      throw new Error("response lost");
    });
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "New account" }));
    for (const [label, value] of [
      ["Account name", "Recovered account"],
      ["Username", "user"],
      ["Password", "secret"],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save account" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Save account" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload accounts" }));
    await screen.findByText("Recovered account");
    expect(api.compareAndSwap).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(3);
    expect(draft().credentialAccounts).toContainEqual({
      credentialId: entries[2].id,
    });
  });
});
