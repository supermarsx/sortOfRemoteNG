import { KeyRound } from "lucide-react";

/** Hardware discovery is owned by the explicitly opened tool, not Settings. */
export default function YubiKeySecuritySection({
  onOpen,
}: {
  onOpen?: () => void;
}) {
  return (
    <section
      aria-label="YubiKey and hardware security keys"
      data-setting-key="hardwareKeyManagement"
      className="sor-settings-card space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <KeyRound size={16} aria-hidden="true" /> YubiKey &amp; hardware keys
        </h3>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!onOpen}
          onClick={onOpen}
        >
          Manage YubiKeys
        </button>
      </div>
      <p className="text-sm text-[var(--color-textSecondary)]">
        Open the dedicated Hardware Keys tab to manage connected YubiKeys, PIV
        certificates, FIDO2 credentials, and hardware-held OATH authenticator
        codes. Local device management requires YubiKey Manager (ykman); PINs
        and touch requirements remain enforced by the key.
      </p>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Website passkeys and security-key sign-in use the real website in your
        system browser, not its local proxy address. Database protection is
        configured separately under Current database security. Managing a key
        does not enroll it with a website or unlock a database.
      </p>
      {!onOpen && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          Open Hardware Keys from the main application toolbar.
        </p>
      )}
    </section>
  );
}
