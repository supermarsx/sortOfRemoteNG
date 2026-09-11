import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VaultArchiveDialog from "../../src/components/security/databaseCredentialVault/VaultArchiveDialog";
import type {
  DatabaseCredentialVaultApi,
  DatabaseCredentialSnapshot,
} from "../../src/types/security/databaseCredentialVault";
import type { DatabaseVaultArchive } from "../../src/types/security/vaultArchive";
const h = vi.hoisted(() => ({
  choose: vi.fn(),
  save: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("../../src/utils/security/vaultArchiveFiles", () => ({
  chooseVaultArchiveFile: h.choose,
  saveVaultArchiveFile: h.save,
}));
vi.mock("../../src/utils/security/vaultArchive", async (original) => ({
  ...(await original<object>()),
  encryptVaultArchive: h.encrypt,
  decryptVaultArchive: h.decrypt,
}));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  now = "2026-09-11T00:00:00.000Z";
const archive: DatabaseVaultArchive = {
  format: "sorng-vault-archive",
  version: 1,
  createdAt: now,
  credentials: [
    {
      id,
      name: "Fixture credential",
      createdAt: now,
      updatedAt: now,
      facets: { password: "NEVER_DISPLAY" },
    },
  ],
  connections: [],
};
const snapshot: DatabaseCredentialSnapshot = {
  scope: { databaseId: "db-a", generation: 1 },
  revision: 0,
  receipt: "receipt",
  entries: [
    {
      id,
      name: "Fixture credential",
      createdAt: now,
      updatedAt: now,
      availableFacets: ["password"],
    },
  ],
};
function api(): DatabaseCredentialVaultApi {
  return {
    scope: snapshot.scope,
    changeRevision: 0,
    list: vi.fn(async () => snapshot),
    resolve: vi.fn(async () => ({})),
    compareAndSwap: vi.fn(async () => {}),
    archiveConnections: vi.fn(async () => [
      {
        id: "conn",
        name: "Linked host",
        hostname: "host.test",
        protocol: "https",
        credentialId: id,
      },
    ]),
    exportArchive: vi.fn(async () => archive),
    importArchive: vi.fn(async () => ({
      credentialCount: 1,
      connectionCount: 0,
    })),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.choose.mockResolvedValue("ENCRYPTED_FILE");
  h.save.mockResolvedValue(true);
  h.encrypt.mockResolvedValue("CIPHERTEXT_ONLY");
  h.decrypt.mockResolvedValue(archive);
});
describe("vault archive native-dialog workflow", () => {
  it.each([true, false])(
    "shows committed counts and pending-edit warning without retrying import (refresh %s)",
    async (refreshed) => {
      const service = api();
      service.importArchive = vi.fn(async () => ({
        credentialCount: 1,
        connectionCount: 0,
        warning: "pending edits",
      }));
      render(
        <VaultArchiveDialog
          api={service}
          snapshot={snapshot}
          mode="import"
          onClose={vi.fn()}
          onImported={vi.fn(async () => refreshed)}
        />,
      );
      fireEvent.change(screen.getByLabelText("Archive password"), {
        target: { value: "password" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Open and review archive" }),
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "Import reviewed records" }),
      );
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Imported 1 credentials",
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        "Additional pending edits could not be saved",
      );
      expect(
        screen.queryByRole("button", { name: "Import reviewed records" }),
      ).not.toBeInTheDocument();
    },
  );
  it("exports reviewed selectedentries and optionalconnections onlyencrypted", async () => {
    const service = api();
    render(
      <VaultArchiveDialog
        api={service}
        snapshot={snapshot}
        mode="export"
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Linked host/ }),
    );
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "a confirmed password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm archive password"), {
      target: { value: "a confirmed password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Encrypt and save archive" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Encrypted archive saved",
    );
    expect(service.exportArchive).toHaveBeenCalledWith(
      snapshot,
      [id],
      ["conn"],
    );
    expect(h.save).toHaveBeenCalledWith(
      "CIPHERTEXT_ONLY",
      expect.any(Function),
      expect.any(Function),
    );
    expect(document.body.textContent).not.toContain("NEVER_DISPLAY");
  });
  it("requires passwordconfirmation andclearsdependentconnectionselection", async () => {
    const service = api();
    render(
      <VaultArchiveDialog
        api={service}
        snapshot={snapshot}
        mode="export"
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Linked host/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Fixture credential" }),
    );
    expect(
      screen.getByRole("checkbox", { name: /Linked host/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Linked host/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Encrypt and save archive" }),
    ).toBeDisabled();
    expect(service.exportArchive).not.toHaveBeenCalled();
  });
  it("decrypts into explicitmetadatareview then makes oneatomicimport withoutsecretrender", async () => {
    const service = api(),
      reload = vi.fn(async () => {});
    render(
      <VaultArchiveDialog
        api={service}
        snapshot={snapshot}
        mode="import"
        onClose={vi.fn()}
        onImported={reload}
      />,
    );
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "old archive password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open and review archive" }),
    );
    await screen.findByText("Review import");
    expect(service.importArchive).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("NEVER_DISPLAY");
    fireEvent.click(
      screen.getByRole("button", { name: "Import reviewed records" }),
    );
    await waitFor(() =>
      expect(service.importArchive).toHaveBeenCalledExactlyOnceWith(
        snapshot,
        archive,
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Imported 1 credentials",
    );
    expect(reload).toHaveBeenCalledOnce();
  });
  it("rejects a deferreddecrypt afterownerscopechanges", async () => {
    let release!: (value: DatabaseVaultArchive) => void;
    h.decrypt.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const service = api();
    const props = {
      snapshot,
      mode: "import" as const,
      onClose: vi.fn(),
      onImported: vi.fn(),
    };
    const view = render(<VaultArchiveDialog api={service} {...props} />);
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open and review archive" }),
    );
    await waitFor(() => expect(h.decrypt).toHaveBeenCalled());
    view.rerender(
      <VaultArchiveDialog
        api={{ ...service, scope: { databaseId: "db-b", generation: 2 } }}
        {...props}
      />,
    );
    await act(async () => release(archive));
    expect(screen.queryByText("Review import")).not.toBeInTheDocument();
    expect(service.importArchive).not.toHaveBeenCalled();
  });
  it.each(["throw", "false"])(
    "reports committed import despite refresh failure: %s",
    async (failure) => {
      const service = api();
      render(
        <VaultArchiveDialog
          api={service}
          snapshot={snapshot}
          mode="import"
          onClose={vi.fn()}
          onImported={vi.fn(async () => {
            if (failure === "false") return false;
            throw new Error("reload");
          })}
        />,
      );
      fireEvent.change(screen.getByLabelText("Archive password"), {
        target: { value: "password" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Open and review archive" }),
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "Import reviewed records" }),
      );
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Import committed successfully",
      );
      expect(
        screen.queryByRole("button", { name: "Import reviewed records" }),
      ).not.toBeInTheDocument();
    },
  );
});
