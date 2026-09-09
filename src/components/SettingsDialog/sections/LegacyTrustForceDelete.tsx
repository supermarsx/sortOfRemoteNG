import type { useLegacyTrustForceDelete } from "../../../hooks/settings/useLegacyTrustForceDelete";
import { formatBytes } from "../../../utils/core/formatters";

export function LegacyTrustForceDelete({
  force,
  busy,
}: {
  force: ReturnType<typeof useLegacyTrustForceDelete>;
  busy: boolean;
}) {
  return (
    <div className="sor-settings-card space-y-3 border border-error/30 text-xs">
      <p>
        Force cleanup is separate from verified migration. Approvals not
        migrated may be lost, and future connections may prompt according to
        your trust policy. Current per-database trust records are not removed.
      </p>
      <p>
        Recovery copies retain the original format and may contain unencrypted
        trust metadata; this is not secure erasure. Recovery copies are not
        automatically imported or covered by artifact encryption management.
      </p>
      {!force.preview && (
        <button
          type="button"
          className="sor-btn-danger-sm"
          disabled={busy || force.running}
          onClick={() => void force.review()}
        >
          Force delete legacy trust files…
        </button>
      )}
      {force.preview && (
        <div
          role="group"
          aria-label="Review force deletion"
          className="space-y-3"
        >
          <p>
            Only these reviewed legacy files will be removed, after every
            recovery copy is verified:
          </p>
          <ul className="list-disc pl-5">
            {force.preview.files.map((file) => (
              <li key={file.name} title={`${file.bytes} bytes`}>
                {file.name} ({formatBytes(file.bytes)})
              </li>
            ))}
          </ul>
          <label className="block">
            Type {force.preview.confirmationPhrase} to confirm
            <input
              className="sor-form-input mt-1 block w-full"
              value={force.confirmation}
              disabled={force.running}
              onChange={(event) => force.setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sor-btn-danger-sm"
              disabled={
                force.running ||
                force.confirmation !== force.preview.confirmationPhrase ||
                force.preview.expiresAt <= Date.now()
              }
              onClick={() => void force.apply()}
            >
              Preserve recovery copy and force delete
            </button>
            <button
              type="button"
              className="sor-btn-secondary-sm"
              disabled={force.running}
              onClick={force.cancel}
            >
              Cancel force deletion
            </button>
          </div>
          <p>
            No files are removed before confirmation. Reviews expire after five
            minutes.
          </p>
        </div>
      )}
      {force.running && (
        <p role="status">
          {force.preview
            ? "Preserving and verifying recovery copies before cleanup…"
            : "Inspecting the exact legacy file inventory…"}
        </p>
      )}
      {force.error && (
        <p role="alert" className="text-error">
          {force.error}
        </p>
      )}
      {force.refreshWarning && (
        <p role="alert" className="text-warning">
          {force.refreshWarning}
        </p>
      )}
      {force.result && (
        <div
          role={force.result.completed ? "status" : "alert"}
          className="space-y-2"
        >
          <p>
            {force.result.completed
              ? "Reviewed legacy files removed; verified recovery copies retained."
              : "Force cleanup did not complete. Review the exact outcome before retrying."}
          </p>
          <p>
            Removed files:{" "}
            {force.result.removedFiles.length
              ? force.result.removedFiles.join(", ")
              : "none"}
            .
          </p>
          <p>
            Verified copies:{" "}
            {force.result.preservedFiles.length
              ? force.result.preservedFiles.join(", ")
              : "none"}
            .
          </p>
          {force.result.recoveryPath && (
            <p className="break-all">
              Recovery location: {force.result.recoveryPath}
            </p>
          )}
          {force.result.errors.map((error, index) => (
            <p key={index} className="text-error">
              {error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
