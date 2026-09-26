import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FullDatabaseTransfer } from "../../src/components/ImportExport/FullDatabaseTransfer";
import { FullDatabaseRestoreIncompleteError } from "../../src/utils/connection/fullDatabaseArchive";

const mock = vi.hoisted(() => ({
  current: vi.fn(),
  guard: vi.fn(),
  flush: vi.fn(),
  export: vi.fn(),
  import: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: mock.current,
      captureDatabaseOperationGuard: mock.guard,
      exportFullDatabaseArchive: mock.export,
      importDatabase: mock.import,
    }),
  },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    databaseAvailability: { generation: 1 },
    flushPendingSave: mock.flush,
  }),
}));
vi.mock("../../src/components/ImportExport/exportFile", () => ({
  saveExportFile: mock.save,
  openExportFolder: mock.open,
}));
vi.mock("../../src/utils/crypto/webCryptoAes", () => ({
  decryptWithPassword: mock.decrypt,
}));
vi.mock("../../src/components/ui/forms", () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} type="password" />
  ),
  Checkbox: ({
    onChange,
    ...props
  }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
    onChange: (checked: boolean) => void;
  }) => (
    <input
      {...props}
      type="checkbox"
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
}));

const databases = ["a", "b"].map((id) => ({
  id,
  name: `Database ${id}`,
  isCurrent: id === "a",
  isEncrypted: true,
  isUnlocked: true,
  isExportable: true,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.current.mockReturnValue({ id: "a" });
  mock.guard.mockImplementation((databaseIds: string[]) => ({
    databaseIds,
    assertCurrent: vi.fn(),
    verifyCurrent: vi.fn().mockResolvedValue(undefined),
  }));
  mock.flush.mockResolvedValue(undefined);
  mock.export.mockResolvedValue("encrypted-whole-database");
  mock.save.mockResolvedValue({
    status: "saved",
    path: "F:\\Chosen\\archive.json",
  });
  mock.open.mockResolvedValue(undefined);
  mock.import.mockResolvedValue({ id: "restored", name: "Restored database" });
  mock.decrypt.mockResolvedValue(
    JSON.stringify({ format: "sorng-full-database", version: 1 }),
  );
});

describe("full database transfer", () => {
  it.each([true, false])(
    "reports typed partial restore safely (typed=%s)",
    async (typed) => {
      const partial = new FullDatabaseRestoreIncompleteError("created-db-id");
      mock.import.mockRejectedValueOnce(
        typed ? partial : new Error("secret backend diagnostic"),
      );
      render(
        <FullDatabaseTransfer
          tab="import"
          databases={[]}
          selectedIds={[]}
          onSelectedIds={vi.fn()}
          onUnlock={vi.fn()}
        />,
      );
      const file = new File(["ciphertext"], "archive.json", {
        type: "application/json",
      });
      Object.defineProperty(file, "text", {
        value: async () =>
          JSON.stringify({ version: 2, algorithm: "AES-256-GCM" }),
      });
      fireEvent.change(screen.getByLabelText("Encrypted database archive"), {
        target: { files: [file] },
      });
      for (const label of [
        "Archive password",
        "New database password",
        "Confirm new database password",
      ]) {
        fireEvent.change(screen.getByLabelText(label), {
          target: { value: "archive-secret-12345" },
        });
      }
      fireEvent.click(
        screen.getByRole("button", {
          name: "Restore as new protected database",
        }),
      );
      const alert = await screen.findByRole("alert");
      if (typed) expect(alert).toHaveTextContent(partial.message);
      else expect(alert).not.toHaveTextContent("secret backend diagnostic");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  it("rejects oversized archive passwords before exporting", () => {
    render(
      <FullDatabaseTransfer
        tab="export"
        databases={databases}
        selectedIds={["a"]}
        onSelectedIds={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Archive password")).toHaveAttribute(
      "maxlength",
      "1024",
    );
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "x".repeat(1025) },
    });
    expect(
      screen.getByRole("button", { name: "Export 1 full database archive(s)" }),
    ).toBeDisabled();
    expect(mock.export).not.toHaveBeenCalled();
  });

  it("stops before building an archive if the workspace switches during save flush", async () => {
    mock.flush.mockImplementationOnce(async () => {
      mock.current.mockReturnValue({ id: "b" });
    });
    render(
      <FullDatabaseTransfer
        tab="export"
        databases={databases}
        selectedIds={["a"]}
        onSelectedIds={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "archive-secret-12345" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Export 1 full database archive(s)" }),
    );
    await screen.findByRole("alert");
    expect(mock.export).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("carries the revocable manager access guard through the final save boundary", async () => {
    let revoked = false;
    const assertCurrent = () => {
      if (revoked) throw new Error("secret backend details");
    };
    mock.guard.mockReturnValue({
      assertCurrent,
      verifyCurrent: async () => assertCurrent(),
    });
    mock.save.mockImplementationOnce(
      async (_content, _name, _mime, verifyAccess) => {
        revoked = true;
        await verifyAccess();
        return { status: "saved", path: "should-not-write.json" };
      },
    );
    render(
      <FullDatabaseTransfer
        tab="export"
        databases={databases}
        selectedIds={["a"]}
        onSelectedIds={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "archive-secret-12345" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Export 1 full database archive(s)" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("secret backend details");
    expect(mock.export).toHaveBeenCalledOnce();
    expect(mock.save).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open folder" }),
    ).not.toBeInTheDocument();
  });

  it("requires encryption and exports complete archives for every selected database", async () => {
    render(
      <FullDatabaseTransfer
        tab="export"
        databases={databases}
        selectedIds={["a", "b"]}
        onSelectedIds={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Export 2 full database archive(s)",
    });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/Includes documents and attachments, password vault/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "archive-secret-12345" },
    });
    fireEvent.click(button);
    await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
    expect(mock.flush).toHaveBeenCalledOnce();
    expect(mock.export).toHaveBeenNthCalledWith(1, "a", "archive-secret-12345");
    expect(mock.export).toHaveBeenNthCalledWith(2, "b", "archive-secret-12345");
    expect(mock.save).toHaveBeenNthCalledWith(
      1,
      "encrypted-whole-database",
      "Database_a.sorngdb.json",
      "application/json",
      expect.any(Function),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Open folder" })[0]);
    expect(mock.open).toHaveBeenCalledWith("F:\\Chosen\\archive.json");
  });

  it("stops bulk export on cancelled save and does not report a saved folder", async () => {
    mock.save.mockResolvedValue({ status: "cancelled" });
    render(
      <FullDatabaseTransfer
        tab="export"
        databases={databases}
        selectedIds={["a", "b"]}
        onSelectedIds={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "archive-secret-12345" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Export 2 full database archive(s)" }),
    );
    await screen.findByText("Database a: Export cancelled");
    expect(mock.export).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Open folder" }),
    ).not.toBeInTheDocument();
  });

  it("restores a complete encrypted archive into a new managed database with fresh password protection", async () => {
    mock.current.mockReturnValue(null);
    render(
      <FullDatabaseTransfer
        tab="import"
        databases={[]}
        selectedIds={[]}
        onSelectedIds={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    const file = new File(["ciphertext"], "archive.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: async () =>
        JSON.stringify({ version: 2, algorithm: "AES-256-GCM" }),
    });
    fireEvent.change(screen.getByLabelText("Encrypted database archive"), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "archive-secret-12345" },
    });
    fireEvent.change(screen.getByLabelText("New database password"), {
      target: { value: "new-password-12345" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new database password"), {
      target: { value: "new-password-12345" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Restore as new protected database" }),
    );
    await screen.findByText(/Restored “Restored database”/);
    expect(mock.import).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        importPassword: "archive-secret-12345",
        includeTrust: true,
        protectionTarget: {
          dataCipher: "aes-256-gcm",
          keepSlotIds: [],
          newSlots: [
            {
              type: "password",
              label: "Database password",
              password: "new-password-12345",
            },
          ],
        },
      }),
    );
    expect(mock.flush).not.toHaveBeenCalled();
  });
});
