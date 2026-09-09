import { useState } from "react";
import {
  Database,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Loader2,
} from "lucide-react";
import {
  SettingsCard,
  SettingsSectionHeader,
} from "../../../ui/settings/SettingsPrimitives";
import ConfirmDialog from "../../../ui/dialogs/ConfirmDialog";
import { useArtifactProtection } from "../../../../hooks/settings/useArtifactProtection";
import { ARTIFACT_LABELS } from "../../../../types/encryption/encryption";
import { formatBytes } from "../../../../utils/core/formatters";
import {
  isMutableArtifactId,
  type ArtifactId,
  type ArtifactPolicyTarget,
  type ArtifactProtectionStatus,
  type MutableArtifactId,
} from "../../../../types/encryption/artifactProtection";

const button =
  "inline-flex w-fit max-w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";
const iconButton = `${button} h-8 min-w-8 !p-0`;
const name = (id: ArtifactId) => ARTIFACT_LABELS[`sorng-v1::${id}`] ?? id;
const stateLabels = {
  encrypted: "Encrypted",
  plaintext: "Plaintext",
  mixed: "Mixed protection",
  absent: "No managed files",
  unverified: "Unverified",
};
const canChange = (row: ArtifactProtectionStatus) =>
  row.mutable &&
  isMutableArtifactId(row.id) &&
  row.diskState !== "unverified" &&
  row.unverifiedFiles === 0;

export default function ArtifactProtectionPanel({
  refreshKey,
  onChanged,
}: {
  refreshKey?: unknown;
  onChanged?: () => void | Promise<void>;
}) {
  const mgr = useArtifactProtection(refreshKey);
  const [selected, setSelected] = useState<Set<MutableArtifactId>>(new Set());
  const [confirmRecovery, setConfirmRecovery] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const rows = mgr.status?.artifacts ?? [];
  const supported = rows.filter(canChange);
  const allIds = supported.map((row) => row.id).filter(isMutableArtifactId);
  const chosen = allIds.filter((id) => selected.has(id));
  const restricted =
    !mgr.status?.unlocked ||
    mgr.status.recoveryRequired ||
    !!mgr.status.policyError ||
    mgr.status.busy;
  const disabled = mgr.busy || mgr.loading || restricted;
  const inspect = (ids: MutableArtifactId[], target: ArtifactPolicyTarget) => {
    void mgr.inspect(ids, target);
  };
  const apply = async () => {
    const outcome = await mgr.apply();
    if (!outcome) return;
    {
      const completed = new Set(
        outcome.results
          .filter(
            (row) => row.outcome === "committed" || row.outcome === "unchanged",
          )
          .map((row) => row.id),
      );
      setSelected(
        (previous) => new Set([...previous].filter((id) => !completed.has(id))),
      );
    }
    // The native result remains authoritative even if a neighboring status card
    // cannot refresh. Its own hook reports that inspection failure separately.
    try {
      await onChanged?.();
      setRefreshError(null);
    } catch (error) {
      setRefreshError(
        `The operation result above remains authoritative; a related status refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const preview = mgr.preview;
  const plaintext = preview?.target === "plaintext";
  return (
    <div data-setting-key="encryptionAtRest.migratePlaintext">
      <div data-setting-key="encryptionAtRest.disable">
        <section
          className="space-y-4"
          data-setting-key="encryptionAtRest.artifacts"
        >
          <SettingsSectionHeader
            icon={<Database className="h-4 w-4 text-primary" />}
            title="Artifact protection"
          />
          <SettingsCard>
            <div className="space-y-4 min-w-0">
              <p className="text-xs text-[var(--color-textMuted)]">
                Manage the global master-key layer for existing app-managed
                files and future writes. Database passwords, export passwords,
                and master lock/unlock are separate. “All” means supported
                artifact families in this profile and configured local backup
                roots—not remote, offline, or unmanaged copies.
              </p>
              <p className="text-xs text-[var(--color-textMuted)]">
                Macros covers native macro files; macros embedded in settings
                follow Settings. Logs covers managed native application logs,
                not the intentionally plaintext encryption audit or separate
                frontend action/history logs.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={button}
                  onClick={() => void mgr.refresh()}
                  disabled={mgr.loading || mgr.busy}
                  aria-busy={mgr.loading}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 ${mgr.loading ? "animate-spin motion-reduce:animate-none" : ""}`}
                  />
                  {mgr.loading
                    ? "Inspecting artifact protection…"
                    : "Refresh artifact protection"}
                </button>
                <span className="text-xs text-[var(--color-textMuted)]">
                  {chosen.length} selected · {allIds.length} supported families
                </span>
                {!!chosen.length && (
                  <button
                    type="button"
                    className={button}
                    disabled={mgr.busy}
                    onClick={() => setSelected(new Set())}
                  >
                    Clear selection
                  </button>
                )}
              </div>
              {mgr.error && (
                <p role="alert" className="text-xs text-error">
                  {mgr.error}
                </p>
              )}
              {refreshError && (
                <p role="alert" className="text-xs text-error">
                  {refreshError}
                </p>
              )}
              {mgr.status?.policyError && (
                <p role="alert" className="text-xs text-error">
                  Policy cannot be verified: {mgr.status.policyError}
                </p>
              )}
              {mgr.status && !mgr.status.unlocked && (
                <p className="text-xs text-warning">
                  Set up or unlock the global master key above before changing
                  protection. No encryption state is inferred from codec
                  availability.
                </p>
              )}
              {mgr.status?.busy && (
                <p role="status" className="text-xs">
                  Another artifact operation is active. Refresh when it
                  finishes.
                </p>
              )}
              {(mgr.status?.warnings ?? []).map((warning, index) => (
                <p key={`${index}:${warning}`} className="text-xs text-warning">
                  {warning}
                </p>
              ))}
              {mgr.status?.recoveryRequired && (
                <div className="space-y-2 rounded-md border border-warning/40 p-3">
                  <p role="alert" className="text-xs text-warning">
                    An interrupted transition needs recovery. Further changes
                    are blocked until native recovery verifies the result.
                  </p>
                  <button
                    type="button"
                    className={button}
                    disabled={mgr.busy || mgr.loading || !mgr.status.unlocked}
                    onClick={() => setConfirmRecovery(true)}
                  >
                    Recover interrupted transition
                  </button>
                </div>
              )}
              {mgr.status && (
                <>
                  <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
                    <table className="w-full min-w-[42rem] text-left text-xs">
                      <caption className="sr-only">
                        Inspected artifact protection and future-write policy
                      </caption>
                      <thead className="bg-[var(--color-surface)] text-[var(--color-textMuted)]">
                        <tr>
                          <th className="p-2">
                            <input
                              type="checkbox"
                              aria-label="Select all supported artifact families"
                              ref={(input) => {
                                if (input)
                                  input.indeterminate =
                                    chosen.length > 0 &&
                                    chosen.length < allIds.length;
                              }}
                              checked={
                                allIds.length > 0 &&
                                chosen.length === allIds.length
                              }
                              aria-checked={
                                chosen.length > 0 &&
                                chosen.length < allIds.length
                                  ? "mixed"
                                  : chosen.length === allIds.length &&
                                    allIds.length > 0
                              }
                              disabled={disabled || !allIds.length}
                              onChange={(event) =>
                                setSelected(
                                  event.target.checked
                                    ? new Set(allIds)
                                    : new Set(),
                                )
                              }
                            />
                          </th>
                          <th className="p-2">Artifact</th>
                          <th className="p-2">Inspected files</th>
                          <th className="p-2">Future writes</th>
                          <th className="p-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const mutable = canChange(row);
                          return (
                            <tr
                              key={row.id}
                              className="border-t border-[var(--color-border)]/50"
                            >
                              <td className="p-2 align-top">
                                {mutable && (
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${name(row.id)}`}
                                    checked={selected.has(
                                      row.id as MutableArtifactId,
                                    )}
                                    disabled={disabled}
                                    onChange={(event) => {
                                      const checked = event.target.checked;
                                      if (!isMutableArtifactId(row.id)) return;
                                      const id = row.id;
                                      setSelected((previous) => {
                                        const next = new Set(previous);
                                        if (checked) next.add(id);
                                        else next.delete(id);
                                        return next;
                                      });
                                    }}
                                  />
                                )}
                              </td>
                              <td className="p-2 align-top">
                                <span className="font-medium">
                                  {name(row.id)}
                                </span>
                                <code className="mt-1 block text-[10px] text-[var(--color-textMuted)]">
                                  sorng-v1::{row.id}
                                </code>
                                {row.reason && (
                                  <p className="mt-1 max-w-56 break-words [overflow-wrap:anywhere] text-warning">
                                    {row.reason}
                                  </p>
                                )}
                              </td>
                              <td className="p-2 align-top">
                                <span>
                                  {stateLabels[row.diskState] ?? "Unverified"}
                                </span>
                                <span className="mt-1 block text-[var(--color-textMuted)]">
                                  {row.encryptedFiles} encrypted ·{" "}
                                  {row.plaintextFiles} plaintext ·{" "}
                                  {row.unverifiedFiles} unverified
                                </span>
                                <span
                                  tabIndex={0}
                                  data-tooltip={`${row.bytes.toLocaleString()} bytes inspected`}
                                  aria-label={`${name(row.id)}: ${row.bytes.toLocaleString()} bytes inspected`}
                                  className="block w-fit rounded-sm text-[var(--color-textMuted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                  {formatBytes(row.bytes)} inspected
                                </span>
                              </td>
                              <td className="p-2 align-top">
                                {row.policy === "default"
                                  ? "Automatic / native default"
                                  : row.policy === "encrypted"
                                    ? "Encryption enabled"
                                    : "Encryption disabled (plaintext)"}
                              </td>
                              <td className="p-2 align-top">
                                {mutable ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    <button
                                      type="button"
                                      className={iconButton}
                                      disabled={disabled}
                                      aria-label={`Encrypt and enable ${name(row.id)}`}
                                      data-tooltip={`Encrypt and enable ${name(row.id)}`}
                                      onClick={() =>
                                        isMutableArtifactId(row.id) &&
                                        inspect([row.id], "encrypted")
                                      }
                                    >
                                      <ShieldCheck
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5"
                                      />
                                    </button>
                                    <button
                                      type="button"
                                      className={`${iconButton} text-warning`}
                                      disabled={disabled}
                                      aria-label={`Decrypt and disable ${name(row.id)}`}
                                      data-tooltip={`Decrypt and disable ${name(row.id)}`}
                                      onClick={() =>
                                        isMutableArtifactId(row.id) &&
                                        inspect([row.id], "plaintext")
                                      }
                                    >
                                      <ShieldOff
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5"
                                      />
                                    </button>
                                  </div>
                                ) : (
                                  <span>
                                    {isMutableArtifactId(row.id)
                                      ? "Changes unavailable"
                                      : "Read-only protection"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <div
                      role="group"
                      aria-label="Selected artifact actions"
                      className="flex items-center gap-1.5"
                    >
                      <span className="mr-1 text-xs text-[var(--color-textMuted)]">
                        Selected
                      </span>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label="Encrypt selected"
                        data-tooltip="Encrypt and enable selected artifact families"
                        disabled={disabled || !chosen.length}
                        onClick={() => inspect(chosen, "encrypted")}
                      >
                        <ShieldCheck
                          aria-hidden="true"
                          className="h-3.5 w-3.5"
                        />
                      </button>
                      <button
                        type="button"
                        className={`${iconButton} text-warning`}
                        aria-label="Decrypt selected"
                        data-tooltip="Decrypt and disable selected artifact families"
                        disabled={disabled || !chosen.length}
                        onClick={() => inspect(chosen, "plaintext")}
                      >
                        <ShieldOff aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div
                      role="group"
                      aria-label="All supported artifact actions"
                      className="flex items-center gap-1.5"
                    >
                      <span className="mr-1 text-xs text-[var(--color-textMuted)]">
                        All supported
                      </span>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label="Encrypt all supported"
                        data-tooltip="Encrypt and enable all supported artifact families"
                        disabled={disabled || !allIds.length}
                        onClick={() => inspect(allIds, "encrypted")}
                      >
                        <ShieldCheck
                          aria-hidden="true"
                          className="h-3.5 w-3.5"
                        />
                      </button>
                      <button
                        type="button"
                        className={`${iconButton} text-warning`}
                        aria-label="Decrypt all supported"
                        data-tooltip="Decrypt and disable all supported artifact families"
                        disabled={disabled || !allIds.length}
                        onClick={() => inspect(allIds, "plaintext")}
                      >
                        <ShieldOff aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--color-textMuted)]">
                    The recovery key ring and artifact policy are protected
                    infrastructure, never included in bulk actions. Enabling
                    encryption is distinct from unlocking the key; decrypting
                    does not delete any keys. The unlocked master key is still
                    needed to authenticate policy even when all supported data
                    families are plaintext. Removing obsolete plaintext copies
                    is not secure erasure of free space, OS snapshots, or
                    external copies.
                  </p>
                </>
              )}
              {mgr.busy && (
                <div role="status" className="space-y-2 text-xs">
                  <span className="inline-flex items-center gap-2">
                    <Loader2
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                    />
                    {mgr.progress
                      ? `${mgr.progress.phase}: ${mgr.progress.completed} / ${mgr.progress.total}`
                      : "Preparing or recovering the transition…"}
                  </span>
                  {mgr.progress && (
                    <>
                      <progress
                        className="block w-full"
                        aria-label="Artifact transition progress"
                        max={Math.max(mgr.progress.total, 1)}
                        value={Math.min(
                          mgr.progress.completed,
                          Math.max(mgr.progress.total, 1),
                        )}
                      />
                      <button
                        type="button"
                        className={button}
                        disabled={
                          mgr.cancelling ||
                          ["commit", "rollback", "complete"].includes(
                            mgr.progress.phase,
                          )
                        }
                        onClick={() => void mgr.cancel()}
                      >
                        {mgr.cancelling
                          ? "Cancellation requested…"
                          : "Request cancellation"}
                      </button>
                      <p>
                        Cancellation is honored before commit only. Already
                        committed families are not undone.
                      </p>
                    </>
                  )}
                </div>
              )}
              {mgr.result && (
                <div
                  className="space-y-2 text-xs"
                  role={mgr.result.outcome === "failed" ? "alert" : "status"}
                >
                  <p className="font-medium">
                    Operation {mgr.result.outcome}. Review each family below;
                    bulk changes are not one all-or-nothing transaction.
                  </p>
                  {mgr.result.error && (
                    <p className="text-error">{mgr.result.error}</p>
                  )}
                  {mgr.result.recoveryRequired && (
                    <p className="text-warning">
                      Recovery is required before another change.
                    </p>
                  )}
                  <ul className="space-y-1">
                    {mgr.result.results.map((row) => (
                      <li key={row.id}>
                        {name(row.id)}: {row.outcome} · {row.files} files
                        {row.error && (
                          <span className="text-error"> — {row.error}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </SettingsCard>
          <ConfirmDialog
            isOpen={!!preview}
            title={
              plaintext
                ? "Decrypt and disable artifact protection?"
                : "Encrypt and enable artifact protection?"
            }
            variant={plaintext ? "danger" : "default"}
            confirmText={plaintext ? "Decrypt & disable" : "Encrypt & enable"}
            confirmOnEnter={false}
            onCancel={() => mgr.dismissPreview()}
            onConfirm={() => void apply()}
            message={
              preview
                ? `${preview.artifacts.map((row) => name(row.id)).join(", ")}: ${preview.totalFiles} managed files, ${formatBytes(preview.totalBytes)}. ${plaintext ? "Existing files and future writes become plaintext at the global artifact layer. Separate database passwords remain unchanged. Master and retained recovery keys are not deleted; external copies remain as they were." : "Existing managed files will be encrypted and future writes will use encryption under the global master key. Separate database passwords are unchanged."} The preview expires after five minutes and is revalidated before applying. Unsupported, remote, offline and unmanaged copies are excluded. Earlier families may stay committed if a later family fails.`
                : ""
            }
          />
          <ConfirmDialog
            isOpen={confirmRecovery}
            title="Recover interrupted transition?"
            message="Native recovery will roll back an uncommitted transition or finish cleanup for a committed one. This does not promise to undo already committed changes. Refresh inspected status after recovery."
            confirmText="Recover transition"
            confirmOnEnter={false}
            onCancel={() => setConfirmRecovery(false)}
            onConfirm={() => {
              setConfirmRecovery(false);
              void mgr.recover();
            }}
          />
        </section>
      </div>
    </div>
  );
}
