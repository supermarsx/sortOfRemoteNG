import { Card } from "../../../ui/settings/SettingsPrimitives";
import type { useDatabaseEncryptionStatus } from "../../../../hooks/settings/useDatabaseEncryptionStatus";

export default function DatabaseProtectionStatus({
  probe,
}: {
  probe: ReturnType<typeof useDatabaseEncryptionStatus>;
}) {
  const { status, loading, error, refresh } = probe;
  return (
    <section
      data-setting-key="encryptionAtRest.databaseStatus"
      aria-label="Database files on disk"
      className="space-y-3"
    >
      <h3 className="text-sm font-medium">
        Database files on disk — global master-key layer
      </h3>
      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Configuring a master key is not proof that existing files are
          encrypted. This read-only inspection checks selected current or
          fallback files; it does not verify decryption or certify every
          historical backup.
        </p>
        {loading && <p role="status">Inspecting disk protection…</p>}
        {error && (
          <p role="alert" className="text-xs text-warning">
            Protection status unknown: {error}
          </p>
        )}
        {status && (
          <>
            <p className="text-xs">
              Master key:{" "}
              {status.masterConfigured ? "configured" : "not configured"};{" "}
              {status.unlocked ? "unlocked" : "locked"}. Encrypted envelopes:{" "}
              {status.summary.encrypted}; plaintext: {status.summary.plaintext};
              unreadable: {status.summary.unreadable}; decryption:{" "}
              {status.verified
                ? `${status.summary.stranded} stranded`
                : "not verified"}
              .
            </p>
            <p className="text-xs">
              Database index: {status.index.atRest}. Database names and trust
              records are not protected by individual database passwords.
            </p>
            {(status.summary.plaintext > 0 ||
              status.summary.unreadable > 0 ||
              status.summary.stranded > 0) && (
              <p className="text-xs text-warning">
                Some database artifacts are not confirmed protected by the
                active master key. Review recovery and full master-key rotation
                before relying on at-rest protection.
              </p>
            )}
            {status.errors.map((message, index) => (
              <p key={`${index}-${message}`} className="text-xs text-warning">
                {message}
              </p>
            ))}
          </>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="text-xs underline disabled:opacity-50"
        >
          Refresh disk protection status
        </button>
      </Card>
    </section>
  );
}
