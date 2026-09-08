import { useState } from "react";
import type { ConnectionDatabase } from "../../../types/connection/connection";
import type {
  DatabaseBulkAction,
  DatabaseBulkOptions,
} from "../../../hooks/connection/useDatabaseBulkActions";
import { defaultExportSecuritySettings } from "../../../types/settings/settings";
import { SettingsManager } from "../../../utils/settings/settingsManager";
import { Checkbox, PasswordInput, Textarea } from "../../ui/forms";
import { ConfirmDialog } from "../../ui/dialogs/ConfirmDialog";
import type { Mgr } from "./types";

const ACTION_LABELS: Record<DatabaseBulkAction, string> = {
  clone: "Clone selected",
  export: "Export selected",
  delete: "Delete selected",
  lock: "Close / lock selected",
  unlock: "Unlock selected",
  metadata: "Edit selected metadata",
};

export function DatabaseBulkControls({
  mgr,
  visible,
  disabled,
}: {
  mgr: Mgr;
  visible: ConnectionDatabase[];
  disabled: boolean;
}) {
  const bulk = mgr.bulk;
  const [action, setAction] = useState<DatabaseBulkAction | null>(null);
  const [targets, setTargets] = useState<ConnectionDatabase[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [pattern, setPattern] = useState("");
  const [editDescription, setEditDescription] = useState(false);
  const [description, setDescription] = useState("");
  const [exportPassword, setExportPassword] = useState("");
  const [exportEncrypted, setExportEncrypted] = useState(false);
  const [exportSecurity, setExportSecurity] = useState(
    defaultExportSecuritySettings,
  );

  const begin = (next: DatabaseBulkAction) => {
    setTargets(mgr.collections.filter(({ id }) => bulk.selectedIds.has(id)));
    setPasswords({});
    setPattern("");
    setDescription("");
    setEditDescription(false);
    setExportPassword("");
    const security = {
      ...defaultExportSecuritySettings,
      ...SettingsManager.getInstance().getSettings().exportSecurity,
    };
    setExportSecurity(security);
    setExportEncrypted(security.encryptByDefault);
    setAction(next);
  };
  const clear = () => {
    setAction(null);
    setPasswords({});
    setExportPassword("");
  };
  const execute = async () => {
    if (!action) return;
    const options: DatabaseBulkOptions = {
      passwords,
      namePattern: pattern || undefined,
      description: editDescription ? description : undefined,
      export: {
        encrypted: exportEncrypted,
        password: exportPassword,
        security: exportSecurity,
      },
    };
    const selectedAction = action;
    const targetIds = targets.map(({ id }) => id);
    clear();
    await bulk.run(selectedAction, options, targetIds);
  };
  const visibleIds = visible.map(({ id }) => id);
  const lockedTargets = targets.filter(
    (item) => item.isEncrypted && !mgr.isDatabaseUnlocked(item.id),
  );
  const needsCredentials =
    action === "clone" || action === "export" || action === "unlock";
  const busy = disabled || bulk.running;

  return (
    <section
      aria-label="Bulk database management"
      className="space-y-3 rounded border border-[var(--color-border)] p-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span role="status">
          {visible.length} visible / {mgr.collections.length} total /{" "}
          {bulk.selectedIds.size} selected
        </span>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={busy}
          onClick={() => bulk.select("filtered", visibleIds)}
        >
          Select filtered
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={busy}
          onClick={() => bulk.select("all")}
        >
          Select all
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={busy}
          onClick={() => bulk.select("none")}
        >
          Select none
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={busy}
          onClick={() => bulk.select("invert", visibleIds)}
        >
          Invert filtered
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.entries(ACTION_LABELS) as [DatabaseBulkAction, string][]).map(
          ([key, label]) => (
            <button
              key={key}
              type="button"
              className="sor-btn-secondary-sm"
              disabled={busy || bulk.selectedIds.size === 0 || action !== null}
              onClick={() => begin(key)}
            >
              {label}
            </button>
          ),
        )}
      </div>
      {action && action !== "delete" && (
        <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
          <h4 className="text-sm font-medium">
            {ACTION_LABELS[action]} ({targets.length})
          </h4>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {targets.map(({ name }) => name).join(", ")}
          </p>
          {action === "lock" && (
            <p className="text-xs">
              The active database will be saved and closed. Other unlocked
              encrypted databases will be locked.
            </p>
          )}
          {action === "unlock" && (
            <p className="text-xs">
              Unlock caches each password for this app session; it does not open
              or switch databases.
            </p>
          )}
          {needsCredentials &&
            lockedTargets.map((target) => (
              <label className="block space-y-1 text-xs" key={target.id}>
                <span>Password for {target.name}</span>
                <PasswordInput
                  value={passwords[target.id] ?? ""}
                  onChange={(event) =>
                    setPasswords((previous) => ({
                      ...previous,
                      [target.id]: event.target.value,
                    }))
                  }
                  className="sor-form-input-xs w-full"
                  autoComplete="off"
                />
              </label>
            ))}
          {needsCredentials && lockedTargets.length > 0 && (
            <p className="text-xs">
              An omitted or incorrect password fails only that database; other
              selected items can continue.
            </p>
          )}
          {action === "metadata" && (
            <>
              <label className="block space-y-1 text-xs">
                <span>Name pattern (optional)</span>
                <input
                  value={pattern}
                  onChange={(event) => setPattern(event.target.value)}
                  className="sor-form-input-xs w-full"
                  placeholder="Prefix {name} - {index}"
                />
              </label>
              <p className="text-xs">
                Use {"{name}"} to retain each name or {"{index}"} for its batch
                number. Blank leaves names unchanged.
              </p>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={editDescription}
                  onChange={setEditDescription}
                />
                Replace description
              </label>
              {editDescription && (
                <Textarea
                  aria-label="Bulk database description"
                  value={description}
                  onChange={setDescription}
                  className="sor-form-textarea w-full"
                  rows={2}
                />
              )}
              <p className="text-xs">
                Encryption and passwords are not changed by metadata editing.
              </p>
            </>
          )}
          {action === "export" && (
            <>
              <p className="text-xs">
                Save one importable JSON database package using the native Save
                dialog. Credentials and secrets are excluded from all selected
                databases, including settings.
              </p>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={exportEncrypted}
                  onChange={setExportEncrypted}
                />
                Encrypt export package
              </label>
              {exportEncrypted && (
                <label className="block space-y-1 text-xs">
                  <span>Export package password</span>
                  <PasswordInput
                    value={exportPassword}
                    onChange={(event) => setExportPassword(event.target.value)}
                    className="sor-form-input-xs w-full"
                    autoComplete="new-password"
                  />
                </label>
              )}
            </>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="sor-btn-secondary-sm"
              onClick={clear}
            >
              Cancel batch
            </button>
            <button
              type="button"
              className="sor-btn-primary-sm"
              onClick={() => void execute()}
            >
              Run {targets.length} database operations
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={action === "delete"}
        title={`Delete ${targets.length} databases?`}
        variant="danger"
        confirmText={`Delete ${targets.length} databases`}
        cancelText="Cancel"
        message={`Permanently delete these databases and their stored data: ${targets.map(({ name }) => name).join(", ")}. The active database must be saved successfully first. This cannot be undone.`}
        onConfirm={() => void execute()}
        onCancel={clear}
      />
      {bulk.running && (
        <div className="flex items-center gap-2 text-xs" role="status">
          <span>
            {bulk.cancelRequested
              ? "Stopping after the current operation…"
              : "Processing selected databases…"}
          </span>
          <button
            type="button"
            className="sor-btn-secondary-sm"
            onClick={bulk.cancel}
            disabled={bulk.cancelRequested}
          >
            Cancel remaining
          </button>
        </div>
      )}
      {bulk.error && (
        <p role="alert" className="text-xs text-error">
          {bulk.error}
        </p>
      )}
      {bulk.results.length > 0 && (
        <div
          className="space-y-1 text-xs"
          aria-label="Bulk database results"
          aria-live="polite"
        >
          <p>
            {
              bulk.results.filter((result) => result.status === "success")
                .length
            }{" "}
            succeeded /{" "}
            {bulk.results.filter((result) => result.status === "failed").length}{" "}
            failed /{" "}
            {
              bulk.results.filter((result) => result.status === "skipped")
                .length
            }{" "}
            skipped /{" "}
            {
              bulk.results.filter((result) => result.status === "cancelled")
                .length
            }{" "}
            cancelled
          </p>
          {bulk.results.map((result) => (
            <p key={result.id}>
              {result.name}: {result.status} — {result.message}
            </p>
          ))}
          {bulk.results.some((result) => result.status === "failed") && (
            <p>
              Review the refreshed list before retrying: a storage failure may
              have partially completed an operation.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
