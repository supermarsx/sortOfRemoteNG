import { useRef, useState } from "react";
import { FolderOpen, Lock } from "lucide-react";
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
      className="space-y-4 rounded-lg border border-[var(--color-border)] p-4"
    >
      <h3 className="text-lg font-medium">
        {tab === "export" ? "Export full databases" : "Restore full database"}
      </h3>
      <p className="text-sm">
        Includes documents and attachments, password vault and linked
        credentials, trusted hosts and certificates, connections, database
        settings, automation, and recycle bin. All categories are included by
        default in this complete archive.
      </p>
      <p className="flex gap-2 text-sm">
        <Lock size={16} /> Password encryption is required. The archive password
        is separate from the source database’s unlock methods.
      </p>
      <fieldset disabled={busy} className="space-y-4">
        {tab === "export" ? (
          <>
            <p className="text-sm">
              Each selected database is saved as a separate encrypted JSON
              archive. Cancelling a Save dialog stops the remaining exports.
            </p>
            {databases.length === 0 && (
              <p>
                No eligible databases are available. Open a database explicitly,
                or choose global VPN/tunnel transfer.
              </p>
            )}
            {databases.map((database) => (
              <div key={database.id} className="flex items-center gap-2">
                <label className="flex items-center gap-2">
                  <Checkbox
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
                  {database.name}
                  {!database.isExportable && " (locked)"}
                </label>
                {!database.isExportable && manager.getCurrentDatabase() && (
                  <button
                    type="button"
                    className="sor-btn-secondary-sm"
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
              <p role="alert">
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
          </>
        ) : (
          <>
            <p className="text-sm">
              Restore creates a new managed protected database, with new unlock
              credentials. It preserves the archive’s IDs and references without
              merging into an existing database.
            </p>
            <label className="block">
              Encrypted database archive
              <input
                aria-label="Encrypted database archive"
                type="file"
                accept=".json"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="block">
              New database name (optional)
              <input
                aria-label="New database name"
                className="sor-form-input w-full"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </>
        )}
        <p className="text-sm">
          Passwords must contain 12–1024 characters and meet the password
          policy.
        </p>
        <label className="block">
          Archive password
          <PasswordInput
            aria-label="Archive password"
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={
              tab === "export" ? "new-password" : "current-password"
            }
          />
        </label>
        {tab === "import" && (
          <>
            <label className="block">
              New database password
              <PasswordInput
                aria-label="New database password"
                maxLength={1024}
                value={destinationPassword}
                onChange={(event) => setDestinationPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="block">
              Confirm new database password
              <PasswordInput
                aria-label="Confirm new database password"
                maxLength={1024}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
              />
            </label>
          </>
        )}
        <button
          type="button"
          className="sor-btn-primary-sm"
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
          onClick={() => void transfer()}
        >
          {busy
            ? "Processing…"
            : tab === "export"
              ? `Export ${selectedIds.length} full database archive(s)`
              : "Restore as new protected database"}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {restored && (
        <p role="status">
          Restored “{restored}” as a new protected database. Open it from
          Databases.
        </p>
      )}
      {results.map(({ name: databaseName, result }, index) => (
        <div key={index} role="status" className="space-y-1 text-sm">
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
