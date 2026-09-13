import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";
import type {
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../src/types/security/databaseCredentialVault";
import DatabaseCredentialVault from "../../src/components/security/DatabaseCredentialVault";
import { getCredentialVaultDraft } from "../../src/utils/security/credentialVaultDrafts";

afterEach(cleanup);
const connection = (
  id: string,
  extra: Partial<Connection> = {},
): Connection => ({
  id,
  name: `Server ${id}`,
  protocol: "ssh",
  hostname: "SECRET_HOST",
  port: 22,
  isGroup: false,
  createdAt: "2026-09-13",
  updatedAt: "2026-09-13",
  password: "SECRET_PASSWORD",
  ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(initial = [connection("a")], vault = true) {
  let current = initial;
  let locked = false;
  let availabilityGeneration = 7;
  const scope = { databaseId: "db-a", generation: 1 };
  const snapshot: DatabaseCredentialSnapshot = {
    scope,
    revision: 1,
    receipt: "review",
    entries: vault
      ? [
          {
            id: "a",
            name: "Reusable login",
            createdAt: "2026-09-13",
            updatedAt: "2026-09-13",
            availableFacets: ["password"],
          },
        ]
      : [],
  };
  const api: DatabaseCredentialVaultApi = {
    scope,
    changeRevision: 0,
    list: vi.fn(async () => snapshot),
    resolve: vi.fn(),
    compareAndSwap: vi.fn(),
    exportArchive: vi.fn(),
  };
  const getter = vi.fn((expected: typeof scope) => {
    if (
      locked ||
      expected.databaseId !== scope.databaseId ||
      expected.generation !== availabilityGeneration
    )
      throw Error("SECRET_NATIVE_DETAIL");
    return current;
  });
  const ctx = (): ConnectionContextType =>
    ({
      credentialVault: api,
      getCurrentConnections: getter,
      state: { connections: current },
      databaseAvailability: {
        status: locked ? "suspended" : "ready",
        ...scope,
        generation: availabilityGeneration,
      },
    }) as ConnectionContextType;
  const edit = vi.fn();
  const view = () => (
    <ConnectionContext.Provider value={ctx()}>
      <DatabaseCredentialVault
        sessionId="inventory-tab"
        onEditConnection={edit}
      />
    </ConnectionContext.Provider>
  );
  return {
    api,
    snapshot,
    getter,
    edit,
    view,
    setRows: (rows: Connection[]) => {
      current = rows;
    },
    lock: () => {
      locked = true;
    },
    renewAvailability: () => {
      availabilityGeneration += 1;
    },
  };
}
const table = () =>
  screen.getByRole("table", { name: "Database vault credentials" });
function source(label: string) {
  fireEvent.click(
    screen.getByRole("combobox", { name: "Credential source filter" }),
  );
  fireEvent.mouseDown(screen.getByRole("option", { name: label }));
}

describe("protected connection-backed credential inventory", () => {
  it("defaults to all sources, exposes types not values, and never resolves or exports virtual rows", async () => {
    const f = fixture([
      connection("a", {
        privateKey: "SECRET_KEY",
        httpHeaders: { Authorization: "SECRET_BEARER" },
        credentialSource: { kind: "vault", credentialId: "SECRET_REFERENCE" },
        integration: {
          descriptorKey: "example",
          credentialRefIds: { SECRET_KEY: "SECRET_OS_ID" },
        },
      }),
    ]);
    render(f.view());
    await screen.findByRole("button", {
      name: "Edit credentials in connection Server a",
    });
    expect(within(table()).getAllByRole("row")).toHaveLength(3);
    expect(
      screen.getByText(/1 reusable credentials · 1 connections/),
    ).toBeInTheDocument();
    expect(table()).toHaveTextContent("Private key / key file");
    expect(table()).toHaveTextContent("Database vault link");
    expect(table()).toHaveTextContent("External reference");
    expect(table()).toHaveTextContent("not a vault fallback");
    expect(document.body.innerHTML).not.toContain("SECRET_");
    expect(f.api.resolve).not.toHaveBeenCalled();
    expect(f.api.compareAndSwap).not.toHaveBeenCalled();
    expect(f.api.exportArchive).not.toHaveBeenCalled();
    source("Connections");
    expect(
      within(table()).queryByRole("button", { name: "Edit Reusable login" }),
    ).not.toBeInTheDocument();
    expect(
      within(table()).queryByRole("button", { name: /Delete/ }),
    ).not.toBeInTheDocument();
    source("Reusable vault");
    expect(
      within(table()).getByRole("button", { name: "Edit Reusable login" }),
    ).toBeInTheDocument();
    expect(
      within(table()).queryByRole("button", { name: /Edit credentials/ }),
    ).not.toBeInTheDocument();
  });

  it("searches only safe metadata, bounds pages, and updates edited/deleted connections", async () => {
    const f = fixture(
      Array.from({ length: 31 }, (_, i) => connection(String(i))),
      false,
    );
    const mounted = render(f.view());
    await screen.findByRole("button", {
      name: "Edit credentials in connection Server 0",
    });
    expect(within(table()).getAllByRole("row")).toHaveLength(26);
    expect(
      screen.getByRole("button", { name: "Export archive" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(within(table()).getAllByRole("row")).toHaveLength(7);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "SECRET_PASSWORD" },
    });
    expect(table()).toHaveTextContent("No matching credentials");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "connection-local" },
    });
    expect(within(table()).getAllByRole("row")).toHaveLength(26);
    f.setRows([connection("new", { name: "Updated owner record" })]);
    mounted.rerender(f.view());
    expect(
      within(table()).getByText("Updated owner record"),
    ).toBeInTheDocument();
    expect(within(table()).queryByText("Server 0")).not.toBeInTheDocument();
    f.setRows([]);
    mounted.rerender(f.view());
    expect(table()).toHaveTextContent("No matching credentials");
  });

  it("does not read connections before protection verification, or after native proof failure", async () => {
    const f = fixture();
    const pending = deferred<DatabaseCredentialSnapshot>();
    vi.mocked(f.api.list).mockReturnValueOnce(pending.promise);
    render(f.view());
    expect(f.getter).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Server a");
    await act(async () => {
      pending.resolve(f.snapshot);
    });
    await screen.findByRole("button", {
      name: "Edit credentials in connection Server a",
    });
    vi.mocked(f.api.list).mockRejectedValueOnce(Error("SECRET_BACKEND_ERROR"));
    fireEvent.click(screen.getByRole("button", { name: "Reload vault" }));
    await waitFor(() =>
      expect(table()).toHaveTextContent("vault is unavailable"),
    );
    expect(document.body.textContent).not.toContain("Server a");
    expect(document.body.innerHTML).not.toContain("SECRET_");
  });

  it("rechecks native protection and hands the latest authoritative connection to the editor once", async () => {
    const f = fixture();
    render(f.view());
    const button = await screen.findByRole("button", {
      name: "Edit credentials in connection Server a",
    });
    const pending = deferred<DatabaseCredentialSnapshot>();
    vi.mocked(f.api.list).mockReturnValueOnce(pending.promise);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(getCredentialVaultDraft("inventory-tab")?.busy).toBe(true);
    expect(f.edit).not.toHaveBeenCalled();
    const latest = connection("a", { password: "LATEST_SECRET" });
    f.setRows([latest]);
    await act(async () => {
      pending.resolve(f.snapshot);
    });
    expect(f.edit).toHaveBeenCalledExactlyOnceWith(latest);
    expect(f.api.list).toHaveBeenCalledTimes(2);
    expect(f.api.compareAndSwap).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("LATEST_SECRET");
  });

  it.each(["locked", "deleted", "unmounted", "owner", "availability"])(
    "refuses a pending editor action after %s",
    async (change) => {
      const f = fixture();
      const mounted = render(f.view());
      const button = await screen.findByRole("button", {
        name: "Edit credentials in connection Server a",
      });
      const pending = deferred<DatabaseCredentialSnapshot>();
      vi.mocked(f.api.list).mockReturnValueOnce(pending.promise);
      fireEvent.click(button);
      if (change === "locked") f.lock();
      if (change === "deleted") f.setRows([]);
      if (change === "availability") f.renewAvailability();
      if (change === "owner")
        f.api.scope = { databaseId: "db-b", generation: 2 };
      if (change === "unmounted") mounted.unmount();
      else mounted.rerender(f.view());
      await act(async () => {
        pending.resolve(f.snapshot);
      });
      expect(f.edit).not.toHaveBeenCalled();
      expect(document.body.innerHTML).not.toContain("SECRET_");
      if (change !== "unmounted" && change !== "availability")
        expect(document.body.textContent).not.toContain("Server a");
    },
  );
});
