import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  passwordReveal: {
    enabled: true,
    mode: "toggle",
    autoHideSeconds: 0,
    showByDefault: false,
    maskIcon: false,
    maskCharacter: "",
    lockSavedPasswords: false,
  },
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
// Render the real form controls, including PasswordInput's positioning and
// reveal behavior. Only the settings/storage boundaries are substituted.
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { passwordReveal: mock.passwordReveal } }),
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
  mock.passwordReveal.enabled = true;
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
  it.each(["export", "import"] as const)(
    "uses themed, full-width form controls and grouped sections for %s",
    (tab) => {
      render(
        <FullDatabaseTransfer
          tab={tab}
          databases={databases}
          selectedIds={["a"]}
          onSelectedIds={vi.fn()}
          onUnlock={vi.fn()}
        />,
      );
      const region = screen.getByRole("region", {
        name: "Full database archive",
      });
      expect(region).toHaveClass(
        "min-w-0",
        "w-full",
        "bg-[var(--color-surface)]",
        "text-[var(--color-text)]",
        "border-[var(--color-border)]",
      );
      for (const name of [
        tab === "export" ? "Databases to export" : "Archive to restore",
        "Password protection",
      ]) {
        expect(within(region).getByRole("region", { name })).toHaveClass(
          "bg-[var(--color-surfaceElevated)]",
          "border-[var(--color-border)]",
        );
      }
      const form = screen.getByRole("form", {
        name:
          tab === "export" ? "Export full databases" : "Restore full database",
      });
      expect(form).toHaveAttribute("aria-busy", "false");
      expect(form.querySelector("fieldset")).toHaveClass("min-w-0");
      const inputs = form.querySelectorAll<HTMLInputElement>(
        "input:not([type=checkbox])",
      );
      expect(inputs).toHaveLength(tab === "export" ? 1 : 5);
      for (const input of inputs) {
        expect(input).toHaveClass("sor-form-input", "w-full");
        expect(input.labels).toHaveLength(1);
        expect(input.labels![0]).toHaveClass("sor-form-label");
        expect(input.labels![0].htmlFor).toBe(input.id);
      }
      if (tab === "import") {
        expect(screen.getByLabelText("Encrypted database archive")).toHaveClass(
          "max-w-full",
          "file:bg-[var(--color-surfaceHover)]",
          "file:text-[var(--color-text)]",
        );
        expect(
          screen.getByLabelText("New database password").parentElement
            ?.parentElement?.parentElement,
        ).toHaveClass("grid", "grid-cols-1", "sm:grid-cols-2", "min-w-0");
      }
      const action = form.querySelector('button[type="submit"]');
      expect(action).toHaveClass(
        "sor-btn",
        "sor-btn-primary",
        "w-full",
        "sm:w-auto",
      );
      // The global .sor-btn white-space rule loads after Tailwind utilities.
      expect(action).toHaveStyle({ whiteSpace: "normal" });
      expect(action?.parentElement).toHaveClass(
        "flex-col",
        "sm:flex-row",
        "border-t",
      );
    },
  );

  it.each(["export", "import"] as const)(
    "keeps each real password eye inside its full-width field without submitting %s",
    (tab) => {
      render(
        <FullDatabaseTransfer
          tab={tab}
          databases={databases}
          selectedIds={["a"]}
          onSelectedIds={vi.fn()}
          onUnlock={vi.fn()}
        />,
      );
      const labels =
        tab === "export"
          ? ["Archive password"]
          : [
              "Archive password",
              "New database password",
              "Confirm new database password",
            ];
      for (const label of labels) {
        const input = screen.getByLabelText(label);
        expect(input).toHaveAttribute("type", "password");
        expect(input).toHaveAttribute(
          "autocomplete",
          tab === "import" && label === "Archive password"
            ? "current-password"
            : "new-password",
        );
        expect(input).toHaveAccessibleDescription(/12–1024 characters/);
        expect(input).toHaveStyle({ paddingRight: "2.25rem" });
        const frame = input.parentElement!;
        expect(frame).toHaveClass("relative", "w-full");
        const reveal = within(frame).getByRole("button", {
          name: "Show password",
        });
        expect(reveal).toHaveAttribute("type", "button");
        expect(reveal).toHaveClass(
          "absolute",
          "right-2",
          "top-1/2",
          "-translate-y-1/2",
        );
        fireEvent.change(input, { target: { value: "archive-secret-12345" } });
        fireEvent.click(reveal);
        expect(input).toHaveAttribute("type", "text");
        expect(input).toHaveValue("archive-secret-12345");
        fireEvent.click(
          within(frame).getByRole("button", { name: "Hide password" }),
        );
        expect(input).toHaveAttribute("type", "password");
      }
      expect(mock.export).not.toHaveBeenCalled();
      expect(mock.import).not.toHaveBeenCalled();
    },
  );

  it("respects disabled password reveal without losing the themed full-width input", () => {
    mock.passwordReveal.enabled = false;
    render(
      <FullDatabaseTransfer
        tab="export"
        databases={databases}
        selectedIds={["a"]}
        onSelectedIds={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Archive password");
    expect(input).toHaveClass("sor-form-input", "w-full");
    expect(input).toHaveAttribute("type", "password");
    expect(input.style.paddingRight).toBe("");
    expect(
      screen.queryByRole("button", { name: "Show password" }),
    ).not.toBeInTheDocument();
  });

  it("keeps long locked database names wrappable and unlock independent from form submission", () => {
    const lockedName = "LockedDatabase".repeat(20);
    const onUnlock = vi.fn().mockResolvedValue(true);
    const onSelectedIds = vi.fn();
    render(
      <FullDatabaseTransfer
        tab="export"
        databases={[
          databases[0],
          { ...databases[1], name: lockedName, isExportable: false },
        ]}
        selectedIds={["a"]}
        onSelectedIds={onSelectedIds}
        onUnlock={onUnlock}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: `Archive ${lockedName}` }),
    ).toBeDisabled();
    expect(screen.getByText(`${lockedName} (locked)`)).toHaveClass(
      "[overflow-wrap:anywhere]",
    );
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock.parentElement).toHaveClass("flex-wrap");
    expect(unlock).toHaveClass("shrink-0");
    fireEvent.click(unlock);
    expect(onUnlock).toHaveBeenCalledWith("b");
    expect(mock.export).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Archive Database a" }),
    );
    expect(onSelectedIds).toHaveBeenCalledWith([]);
  });

  it("disables the actual password eyes and form controls during a submitted export", async () => {
    let finishExport!: (content: string) => void;
    mock.export.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishExport = resolve;
      }),
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
    const form = screen.getByRole("form", { name: "Export full databases" });
    fireEvent.submit(form);
    await waitFor(() => expect(mock.export).toHaveBeenCalledOnce());
    expect(form).toHaveAttribute("aria-busy", "true");
    for (const control of form.querySelectorAll("input, button")) {
      expect(control).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Processing…" })).toBeDisabled();
    fireEvent.submit(form);
    expect(mock.export).toHaveBeenCalledOnce();
    finishExport("encrypted-whole-database");
    await screen.findByRole("status");
    expect(form).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "Show password" })).toBeEnabled();
    expect(mock.save).toHaveBeenCalledOnce();
  });

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
      expect(alert).toHaveClass("border-error/30", "bg-error/10", "text-error");
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
    expect(screen.getByRole("status")).toHaveClass(
      "border-success/30",
      "bg-success/10",
      "text-success",
    );
    for (const label of [
      "Archive password",
      "New database password",
      "Confirm new database password",
    ]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
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
