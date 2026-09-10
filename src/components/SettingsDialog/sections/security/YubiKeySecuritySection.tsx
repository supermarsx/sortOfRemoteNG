import React, { lazy, Suspense, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { loadRuntimeCapabilities } from "../../../../utils/runtime/runtimeCapabilities";

const YubiKeyManager = lazy(() =>
  import("../../../ssh/yubiKey/YubiKeyManager").then((module) => ({
    default: module.YubiKeyManager,
  })),
);

/** Hardware discovery starts only after an explicit management action. */
export default function YubiKeySecuritySection() {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const manage = async () => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    setError(null);
    try {
      const capabilities = await loadRuntimeCapabilities();
      if (capabilities.source !== "native" || !capabilities.ops) {
        setError(
          "YubiKey management requires the full desktop build. Restart with the current desktop binary and try again.",
        );
        return;
      }
      setOpen(true);
    } catch {
      setError(
        "Unable to check desktop hardware-key support. Restart the desktop app and try again.",
      );
    } finally {
      busy.current = false;
      setChecking(false);
    }
  };
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
          disabled={checking}
          onClick={() => void manage()}
        >
          {checking ? "Checking desktop support…" : "Manage YubiKeys"}
        </button>
      </div>
      <p className="text-sm text-[var(--color-textSecondary)]">
        Manage connected YubiKeys, PIV certificates, FIDO2 credentials, and
        hardware-held OATH authenticator codes. Local device management requires
        YubiKey Manager (ykman); PINs and touch requirements remain enforced by
        the key.
      </p>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Website passkeys and security-key sign-in use the real website in your
        system browser, not its local proxy address. Database protection is
        configured separately under Current database security. Managing a key
        does not enroll it with a website or unlock a database.
      </p>
      {error && (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      )}
      {open && (
        <Suspense
          fallback={
            <p role="status" className="text-sm">
              Loading hardware-key manager…
            </p>
          }
        >
          <YubiKeyManager isOpen onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}
