import { useId, useRef, useState } from "react";
import { Download, FolderOpen, Loader2, Lock, Upload } from "lucide-react";
import { useConnections } from "../../contexts/useConnections";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import {
  FullDatabaseArchiveError,
  FullDatabaseRestoreIncompleteError,
  isFullDatabaseArchive,
} from "../../utils/connection/fullDatabaseArchive";
import { decryptWithPassword } from "../../utils/crypto/webCryptoAes";
import { PasswordInput, Checkbox } from "../ui/forms";
import { captureImportExportOperation } from "./operationGuard";
import {
  openExportFolder,
  saveExportFile,
  type ExportFileResult,
} from "./exportFile";
import type { ExportDatabaseOption } from "./types";

type Result = { name: string; result: ExportFileResult };
export function FullDatabaseTransfer({
  tab,
  databases,
  selectedIds,
  onSelectedIds,
  onUnlock,
}: {
  tab: "export" | "import";
  databases: ExportDatabaseOption[];
  selectedIds: string[];
  onSelectedIds: (ids: string[]) => void;
  onUnlock: (id: string) => Promise<boolean>;
}) {
  const formId = useId();
  const manager = DatabaseManager.getInstance();
  const { databaseAvailability, flushPendingSave } = useConnections();
  const generation = useRef(databaseAvailability?.generation);
  generation.current = databaseAvailability?.generation;
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [destinationPassword, setDestinationPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [restored, setRestored] = useState("");
  const selected = databases.filter((database) =>
    selectedIds.includes(database.id),
  );
  const invalidSelection =
    selectedIds.length === 0 ||
    selected.length !== selectedIds.length ||
    selected.some((database) => !database.isExportable);

  const transfer = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setResults([]);
    setRestored("");
    try {
      if (password.length < 12 || password.length > 1024)
        throw new FullDatabaseArchiveError("password");
      if (tab === "export") {
        if (invalidSelection) throw new Error("Unavailable selection");
        const operation = captureImportExportOperation(
          manager,
          selectedIds,
          () => generation.current,
        );
        if (selectedIds.includes(manager.getCurrentDatabase()?.id ?? "")) {
          await flushPendingSave();
          operation.assertCurrent();
        }
        for (const database of selected) {
          await operation.verifyCurrent();
          const content = await manager.exportFullDatabaseArchive(
            database.id,
            password,
          );
          operation.assertCurrent();
          const filename = `${database.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "database"}.sorngdb.json`;
          const result = await saveExportFile(
            content,
            filename,
            "application/json",
            operation.verifyCurrent,
          );
          setResults((previous) => [
            ...previous,
            { name: database.name, result },
          ]);
          if (result.status === "cancelled") break;
        }
      } else {
        if (
          !file ||
          destinationPassword.length < 12 ||
          destinationPassword.length > 1024 ||
          destinationPassword !== confirmation
        )
          throw new Error("Invalid restore options");
        const operation = captureImportExportOperation(
          manager,
          [],
          () => generation.current,
        );
        const content = await file.text();
        const envelope = JSON.parse(content);
        if (envelope.version !== 2 || envelope.algorithm !== "AES-256-GCM")
          throw new FullDatabaseArchiveError("protection");
        const archive = JSON.parse(
          await decryptWithPassword(content, password),
        );
        if (!isFullDatabaseArchive(archive))
          throw new FullDatabaseArchiveError("format");
        await operation.verifyCurrent();
        const database = await manager.importDatabase(content, {
          importPassword: password,
          collectionName: name.trim() || undefined,
          includeTrust: true,
          protectionTarget: {
            dataCipher: "aes-256-gcm",
            keepSlotIds: [],
            newSlots: [
              {
                type: "password",
                label: "Database password",
                password: destinationPassword,
              },
            ],
          },
        });
        setRestored(database.name);
        setPassword("");
        setDestinationPassword("");
        setConfirmation("");
      }
    } catch (failure) {
      setError(
        failure instanceof FullDatabaseArchiveError ||
          failure instanceof FullDatabaseRestoreIncompleteError
          ? failure.message
          : "Full database transfer did not finish. Access may have changed or validation failed. Review Databases before retrying a restore; previously completed files remain saved.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Full database archive"
      className="min-w-0 w-full space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text)] sm:p-6"
    >
      <h3 className="text-lg font-medium">
        {tab === "export" ? "Export full databases" : "Restore full database"}
      </h3>
      <p className="text-sm text-[var(--color-textSecondary)]">
        Includes documents and attachments, password vault and linked
        credentials, trusted hosts and certificates, connections, database
        settings, automation, and recycle bin. All categories are included by
        default in this complete archive.
      </p>
      <p className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm text-[var(--color-textSecondary)]">
        <Lock
          size={16}
          className="mt-0.5 shrink-0 text-primary"
          aria-hidden="true"
        />{" "}
        Password encryption is required. The archive password is separate from
        the source database’s unlock methods.
      </p>
      <form
        aria-label={
          tab === "export" ? "Export full databases" : "Restore full database"
        }
        aria-busy={busy}
        className="min-w-0"
        onSubmit={(event) => {
          event.preventDefault();
          void transfer();
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          {tab === "export" ? (
            <section
              aria-labelledby={`${formId}-databases-heading`}
              className="min-w-0 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-4"
            >
              <h4
                id={`${formId}-databases-heading`}
                className="text-sm font-medium"
              >
                Databases to export
              </h4>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Each selected database is saved as a separate encrypted JSON
                archive. Cancelling a Save dialog stops the remaining exports.
              </p>
              {databases.length === 0 && (
                <p className="text-sm text-[var(--color-textSecondary)]">
                  No eligible databases are available. Open a database
                  explicitly, or choose global VPN/tunnel transfer.
                </p>
              )}
              {databases.map((database) => (
                <div
                  key={database.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
                >
                  <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                    <Checkbox
                      variant="form"
                      className="mt-0.5 shrink-0"
                      aria-label={`Archive ${database.name}`}
                      checked={selectedIds.includes(database.id)}
                      disabled={
                        !database.isExportable &&
                        !selectedIds.includes(database.id)
                      }
                      onChange={(checked) =>
                        onSelectedIds(
                          checked
                            ? [...selectedIds, database.id]
                            : selectedIds.filter((id) => id !== database.id),
                        )
                      }
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {database.name}
                      {!database.isExportable && " (locked)"}
                    </span>
                  </label>
                  {!database.isExportable && manager.getCurrentDatabase() && (
                    <button
                      type="button"
                      className="sor-btn-secondary-sm shrink-0"
                      onClick={() => void onUnlock(database.id)}
                    >
                      Unlock
                    </button>
                  )}
                </div>
              ))}
              {selectedIds.some(
                (id) => !databases.some((database) => database.id === id),
              ) && (
                <p role="alert" className="text-sm text-warning">
                  A selected database is no longer available.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      onSelectedIds(selected.map((database) => database.id))
                    }
                  >
                    Remove unavailable selections
                  </button>
                </p>
              )}
            </section>
          ) : (
            <section
              aria-labelledby={`${formId}-restore-heading`}
              className="min-w-0 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-4"
            >
              <h4
                id={`${formId}-restore-heading`}
                className="text-sm font-medium"
              >
                Archive to restore
              </h4>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Restore creates a new managed protected database, with new
                unlock credentials. It preserves the archive’s IDs and
                references without merging into an existing database.
              </p>
              <div className="space-y-2">
                <label htmlFor={`${formId}-file`} className="sor-form-label">
                  Encrypted database archive
                </label>
                <input
                  id={`${formId}-file`}
                  aria-label="Encrypted database archive"
                  className="sor-form-input min-w-0 w-full max-w-full file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-surfaceHover)] file:px-3 file:py-1.5 file:text-[var(--color-text)]"
                  type="file"
                  accept=".json"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor={`${formId}-name`} className="sor-form-label">
                  New database name (optional)
                </label>
                <input
                  id={`${formId}-name`}
                  aria-label="New database name"
                  className="sor-form-input w-full"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </section>
          )}
          <section
            aria-labelledby={`${formId}-protection-heading`}
            className="min-w-0 space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-4"
          >
            <h4
              id={`${formId}-protection-heading`}
              className="flex items-center gap-2 text-sm font-medium"
            >
              <Lock
                size={16}
                className="shrink-0 text-primary"
                aria-hidden="true"
              />
              Password protection
            </h4>
            <p
              id={`${formId}-password-policy`}
              className="text-xs text-[var(--color-textSecondary)]"
            >
              Passwords must contain 12–1024 characters and meet the password
              policy.
            </p>
            <div className="space-y-2">
              <label
                htmlFor={`${formId}-archive-password`}
                className="sor-form-label"
              >
                Archive password
              </label>
              <PasswordInput
                id={`${formId}-archive-password`}
                aria-label="Archive password"
                aria-describedby={`${formId}-password-policy`}
                className="sor-form-input w-full"
                maxLength={1024}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  tab === "export" ? "new-password" : "current-password"
                }
              />
            </div>
            {tab === "import" && (
              <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <label
                    htmlFor={`${formId}-new-password`}
                    className="sor-form-label"
                  >
                    New database password
                  </label>
                  <PasswordInput
                    id={`${formId}-new-password`}
                    aria-label="New database password"
                    aria-describedby={`${formId}-password-policy`}
                    className="sor-form-input w-full"
                    maxLength={1024}
                    value={destinationPassword}
                    onChange={(event) =>
                      setDestinationPassword(event.target.value)
                    }
                    autoComplete="new-password"
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <label
                    htmlFor={`${formId}-confirm-password`}
                    className="sor-form-label"
                  >
                    Confirm new database password
                  </label>
                  <PasswordInput
                    id={`${formId}-confirm-password`}
                    aria-label="Confirm new database password"
                    aria-describedby={`${formId}-password-policy`}
                    className="sor-form-input w-full"
                    maxLength={1024}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}
          </section>
          <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
            <button
              type="submit"
              className="sor-btn sor-btn-primary w-full sm:w-auto"
              style={{ whiteSpace: "normal" }}
              disabled={
                password.length < 12 ||
                password.length > 1024 ||
                (tab === "export"
                  ? invalidSelection
                  : !file ||
                    destinationPassword.length < 12 ||
                    destinationPassword.length > 1024 ||
                    destinationPassword !== confirmation)
              }
            >
              {busy ? (
                <Loader2
                  size={16}
                  className="shrink-0 animate-spin"
                  aria-hidden="true"
                />
              ) : tab === "export" ? (
                <Download size={16} className="shrink-0" aria-hidden="true" />
              ) : (
                <Upload size={16} className="shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {busy
                  ? "Processing…"
                  : tab === "export"
                    ? `Export ${selectedIds.length} full database archive(s)`
                    : "Restore as new protected database"}
              </span>
            </button>
          </div>
        </fieldset>
      </form>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      )}
      {restored && (
        <p
          role="status"
          className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success [overflow-wrap:anywhere]"
        >
          Restored “{restored}” as a new protected database. Open it from
          Databases.
        </p>
      )}
      {results.map(({ name: databaseName, result }, index) => (
        <div
          key={index}
          role="status"
          className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm [overflow-wrap:anywhere]"
        >
          <p>
            {databaseName}:{" "}
            {result.status === "saved"
              ? "Export saved"
              : result.status === "downloaded"
                ? "Download started"
                : "Export cancelled"}
          </p>
          {result.status === "saved" && (
            <>
              <p className="break-all">{result.path}</p>
              <button
                type="button"
                className="sor-btn-secondary-sm"
                onClick={() =>
                  void openExportFolder(result.path).catch(() =>
                    setError(
                      "The export was saved, but its folder could not be opened. Use the saved path to locate it.",
                    ),
                  )
                }
              >
                <FolderOpen size={14} /> Open folder
              </button>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
