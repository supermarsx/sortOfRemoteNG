import { KeyRound } from "lucide-react";

/** Settings launches the same dedicated tool; it never mounts a second vault. */
export default function DatabaseCredentialVaultSection({
  onOpen,
}: {
  onOpen?: () => void;
}) {
  return (
    <section
      data-setting-key="databaseCredentialVault"
      className="sor-settings-card space-y-3"
      aria-label="Database credential vault settings"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <KeyRound size={16} />
          Database credential vault
        </h3>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!onOpen}
          onClick={onOpen}
        >
          Manage database credentials
        </button>
      </div>
      <p className="text-sm text-[var(--color-textSecondary)]">
        Open the dedicated Database Credential Vault tab to manage reusable
        username/password, private-key and TOTP combinations in the current
        protected database. Social sign-in and passkey bindings are descriptive,
        non-portable metadata only.
      </p>
      {!onOpen && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          Open the credential vault from the main application toolbar.
        </p>
      )}
    </section>
  );
}
