import React, { useEffect, useMemo, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import type { TOTPConfig } from "../../../types/settings/settings";
import type { TotpAlgorithm } from "../../../types/totp";
import { totpApi } from "../../../hooks/totp/useTOTP";
import {
  DatabaseManager,
  onDatabaseAccessChange,
} from "../../../utils/connection/databaseManager";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import { getInvoke } from "../../../utils/tauri/invoke";
import { ENCRYPTION_EVENT_LOCKED } from "../../../types/encryption/encryption";

export interface WebTotpPanelProps {
  configs: TOTPConfig[];
  ownerDatabaseId: string | undefined;
  connectionId: string | undefined;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}
type Code = { value: string; expires: number };
const unavailable =
  "The owning database is unavailable. Unlock it and reopen 2FA Codes.";

/** Displays already-enrolled connection codes only. No seed management, page
 * messaging, automatic typing, or website recovery-code generation. */
export default function WebTotpPanel({
  configs,
  ownerDatabaseId,
  connectionId,
  onClose,
  anchorRef,
}: WebTotpPanelProps) {
  const manager = DatabaseManager.getInstance();
  const access = useMemo(() => {
    try {
      const target = manager.captureCurrentDatabaseDataTarget();
      if (
        !ownerDatabaseId ||
        !connectionId ||
        manager.getCurrentDatabase()?.id !== ownerDatabaseId ||
        target?.databaseId !== ownerDatabaseId ||
        !target.assertAccessible
      )
        return null;
      target.assertAccessible();
      return () => {
        if (manager.getCurrentDatabase()?.id !== ownerDatabaseId)
          throw new Error(unavailable);
        target.assertAccessible!();
      };
    } catch {
      return null;
    }
  }, [manager, ownerDatabaseId, connectionId]);
  const latest = useRef({ configs, access });
  latest.current = { configs, access };
  const [revoked, setRevoked] = useState(false);
  const revokedRef = useRef(false);
  const [result, setResult] = useState<{
    source: TOTPConfig[];
    access: typeof access;
    codes: (Code | null)[];
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(false);
  const canAccess = () => {
    try {
      if (revokedRef.current || !access) return false;
      access();
      return true;
    } catch {
      return false;
    }
  };
  const allowed = !revoked && canAccess();

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let offNative: (() => void) | undefined;
    const revoke = () => {
      revokedRef.current = true;
      setRevoked(true);
      setResult(null);
      setNotice(null);
    };
    const offAccess = onDatabaseAccessChange((event) => {
      if (event.databaseId === ownerDatabaseId && event.status === "suspended")
        revoke();
    });
    const offCurrent = manager.onCurrentDatabaseChange(() => {
      try {
        if (!access) throw new Error();
        access();
      } catch {
        revoke();
      }
    });
    void getInvoke()
      .then(async (invoke) => {
        if (!invoke || disposed) return;
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen(ENCRYPTION_EVENT_LOCKED, revoke);
        if (disposed) off();
        else offNative = off;
      })
      .catch(() => {
        if (!disposed) revoke();
      });
    return () => {
      disposed = true;
      alive.current = false;
      offAccess();
      offCurrent();
      offNative?.();
    };
  }, [manager, ownerDatabaseId, access]);

  useEffect(() => {
    let disposed = false,
      computing = false;
    let cached: (Code | null)[] = [];
    const periods: number[] = [];
    const valid = () => {
      if (
        disposed ||
        revokedRef.current ||
        latest.current.configs !== configs ||
        latest.current.access !== access ||
        !access
      )
        return false;
      try {
        access();
        return true;
      } catch {
        return false;
      }
    };
    const refresh = async () => {
      const started = Date.now();
      setNow(started);
      if (!valid()) {
        setResult(null);
        return;
      }
      if (computing) return;
      computing = true;
      try {
        const codes = await Promise.all(
          configs
            .slice(0, 64)
            .map(async (config, index): Promise<Code | null> => {
              if (
                !valid() ||
                typeof config.secret !== "string" ||
                !config.secret ||
                config.secret.length > 4096 ||
                !["sha1", "sha256", "sha512"].includes(config.algorithm) ||
                !Number.isInteger(config.digits) ||
                config.digits < 6 ||
                config.digits > 8 ||
                !Number.isInteger(config.period) ||
                config.period < 1 ||
                config.period > 3600
              )
                return null;
              const period = Math.floor(started / (config.period * 1000));
              if (periods[index] === period) return cached[index] ?? null;
              periods[index] = period;
              try {
                const value = await totpApi.computeCode(
                  config.secret,
                  config.algorithm.toUpperCase() as TotpAlgorithm,
                  config.digits,
                  config.period,
                );
                const expires =
                  (Math.floor(started / (config.period * 1000)) + 1) *
                  config.period *
                  1000;
                return valid() &&
                  Date.now() < expires &&
                  new RegExp(`^\\d{${config.digits}}$`).test(value)
                  ? { value, expires }
                  : null;
              } catch {
                return null;
              }
            }),
        );
        if (valid()) {
          cached = codes;
          setResult({ source: configs, access, codes });
        }
      } finally {
        computing = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [configs, access]);

  const copy = async (index: number) => {
    if (
      !canAccess() ||
      result?.source !== configs ||
      result.access !== access ||
      latest.current.access !== access ||
      latest.current.configs !== configs
    ) {
      setResult(null);
      return;
    }
    const code = result.codes[index];
    if (!code || Date.now() >= code.expires) {
      setNotice("Wait for a fresh code before copying.");
      return;
    }
    try {
      await navigator.clipboard.writeText(code.value);
      if (alive.current && canAccess() && latest.current.configs === configs)
        setNotice("Code copied. Paste it manually on the website.");
    } catch {
      if (alive.current && canAccess())
        setNotice("Could not copy the code. Select it and copy manually.");
    }
  };
  const panel = (
    <section
      aria-label="Website 2FA codes"
      className="sor-popover-panel w-96 max-w-[calc(100vw-1rem)] overflow-hidden"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] p-3">
        <h2 className="text-sm font-semibold">2FA Codes</h2>
        <button
          type="button"
          className="sor-icon-btn-sm"
          aria-label="Close 2FA codes"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="max-h-[60vh] overflow-y-auto p-3 space-y-3">
        {!allowed ? (
          <p role="status" className="text-sm">
            {unavailable}
          </p>
        ) : (
          <>
            <p className="text-xs text-[var(--color-textSecondary)]">
              Copy a code from an existing authenticator configuration, then
              paste it yourself. Nothing is typed or submitted automatically.
            </p>
            {!configs.length && (
              <p className="text-sm">
                No saved authenticator configurations. Use your existing
                authenticator, or configure an already-enrolled secret in this
                connection’s Protocol → Recovery settings.
              </p>
            )}
            {configs.slice(0, 64).map((config, index) => {
              const code =
                result?.source === configs && result.access === access
                  ? result.codes[index]
                  : null;
              const fresh =
                code && now < code.expires && Date.now() < code.expires;
              return (
                <div
                  key={index}
                  className="border-t border-[var(--color-border)] pt-2"
                >
                  <div className="text-xs break-words">
                    {config.account || "Authenticator"}
                    {config.issuer ? ` · ${config.issuer}` : ""}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-lg tracking-widest select-text">
                      {fresh ? code.value : "Unavailable"}
                    </span>
                    <button
                      type="button"
                      className="sor-icon-btn-sm"
                      aria-label={`Copy code ${index + 1}`}
                      disabled={!fresh}
                      onClick={() => void copy(index)}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  {fresh && (
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      Expires in {Math.ceil((code.expires - now) / 1000)}s
                    </p>
                  )}
                </div>
              );
            })}
            {configs.length > 64 && (
              <p role="status">
                Only the first 64 configurations are shown. Manage the list in
                connection settings.
              </p>
            )}
            {notice && (
              <p role="status" className="text-xs">
                {notice}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
  return anchorRef ? (
    <PopoverSurface
      isOpen
      onClose={onClose}
      anchorRef={anchorRef}
      align="end"
      offset={4}
      dataTestId="web-totp-popover"
    >
      {panel}
    </PopoverSurface>
  ) : (
    panel
  );
}
