import React, { useEffect, useRef, useState } from "react";
import { Copy, KeyRound, X } from "lucide-react";
import type {
  RuntimeVaultTotpController,
  RuntimeVaultTotpEntry,
} from "../../hooks/security/useRuntimeVaultTotp";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { useSessionObservationActivity } from "../../hooks/session/useSessionObservationActivity";
import { PopoverSurface } from "../ui/overlays/PopoverSurface";
import { prepareCredentialClipboard } from "../../utils/security/credentialClipboard";

type Props = {
  controller: RuntimeVaultTotpController;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  className?: string;
  footer?: React.ReactNode;
  credentialActions?: React.ReactNode;
  typingRef?: React.RefObject<HTMLElement | null>;
  renderTypeCode?: (id: string) => React.ReactNode;
};
type Code = Awaited<ReturnType<RuntimeVaultTotpController["generate"]>>;

function Codes({
  controller,
  onClose,
  footer,
  credentialActions,
  typingRef,
  renderTypeCode,
}: Omit<Props, "anchorRef">) {
  const connectionSource = controller.sourceKind === "connection";
  const title = credentialActions
    ? "Credentials & 2FA"
    : `${connectionSource ? "Connection" : "Vault"} authenticator codes`;
  const [entries, setEntries] = useState<RuntimeVaultTotpEntry[]>([]);
  const [code, setCode] = useState<(Code & { entryId: string }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const active = useSessionObservationActivity(
    useSessionRenderActivity().isActive,
  );
  const latest = useRef(controller);
  latest.current = controller;
  const latestActive = useRef(active);
  latestActive.current = active;
  const pending = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    const lifetime = epoch;
    const ticket = ++lifetime.current;
    setBusy(true);
    void controller
      .load()
      .then((values) => {
        if (epoch.current === ticket) setEntries(values);
      })
      .catch(() => {
        if (epoch.current === ticket)
          setError(
            `${connectionSource ? "Connection" : "Vault"} authenticators are unavailable. Unlock the owning database and reopen this panel.`,
          );
      })
      .finally(() => {
        if (epoch.current === ticket) setBusy(false);
      });
    return () => {
      lifetime.current++;
    };
    // A keyed instance owns one disclosure scope; callback identities may change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!active || !controller.available) {
      epoch.current++;
      setCode(null);
      setBusy(false);
      return;
    }
    if (!code) return;
    const check = () => {
      try {
        code.assertCurrent();
        if (Date.now() >= code.expires) throw new Error();
        setNow(Date.now());
      } catch {
        setCode(null);
        setError(
          "The code expired or vault access changed. Copy or type a fresh code.",
        );
      }
    };
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [active, controller.available, code]);
  const copy = async (id: string) => {
    if (
      busy ||
      pending.current ||
      !active ||
      document.hidden ||
      !latest.current.available
    )
      return;
    pending.current = true;
    const ticket = ++epoch.current;
    const scope = latest.current.scopeKey;
    setCode(null);
    setError("");
    setBusy(true);
    try {
      const writeClipboard = await prepareCredentialClipboard();
      if (
        epoch.current !== ticket ||
        !latestActive.current ||
        document.hidden ||
        !latest.current.available ||
        latest.current.scopeKey !== scope
      )
        return;
      const value = await latest.current.generate(id);
      value.assertCurrent();
      if (
        epoch.current !== ticket ||
        !latestActive.current ||
        document.hidden ||
        !latest.current.available ||
        latest.current.scopeKey !== scope ||
        Date.now() >= value.expires
      )
        return;
      await writeClipboard(
        value.code,
        "totpCode",
        () => {
          value.assertCurrent();
          if (
            epoch.current !== ticket ||
            !latestActive.current ||
            document.hidden ||
            !latest.current.available ||
            latest.current.scopeKey !== scope ||
            Date.now() >= value.expires
          )
            throw new Error("Authenticator access changed.");
        },
        { expires: value.expires },
      );
      if (epoch.current === ticket) {
        setNow(Date.now());
        setCode({ ...value, entryId: id });
      }
    } catch {
      if (epoch.current === ticket)
        setError(
          "The code could not be copied safely. Check vault access and try again.",
        );
    } finally {
      pending.current = false;
      if (epoch.current === ticket) setBusy(false);
    }
  };
  return (
    <section
      ref={typingRef}
      className="w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto space-y-3 p-4"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <KeyRound size={16} />
          {title}
        </h3>
        <button
          type="button"
          className="sor-icon-btn"
          aria-label={
            credentialActions
              ? "Close Credentials & 2FA"
              : "Close authenticator codes"
          }
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {credentialActions}
      <p className="text-xs text-[var(--color-textSecondary)]">
        Copy generates a fresh code.
        {renderTypeCode &&
          " Type does not press Enter or click a submit button."}
        {!connectionSource && " Connection-local authenticators are ignored."}
      </p>
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
      {!controller.available && (
        <p role="status" className="text-xs">
          {controller.unavailableReason}
        </p>
      )}
      {busy && (
        <p role="status" className="text-xs">
          Reading the owning database{" "}
          {connectionSource ? "connection" : "vault"}…
        </p>
      )}
      {!busy && !entries.length && !error && (
        <p className="text-xs">This credential has no authenticators.</p>
      )}
      {entries.map((entry, index) => (
        <div key={entry.id} className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm" title={entry.label}>
              {entry.label}
            </div>
            {code?.entryId === entry.id && active && controller.available && (
              <>
                <output
                  aria-label="Generated authenticator code"
                  className="block break-all font-mono text-lg tracking-widest"
                >
                  {code.code}
                </output>
                <p className="text-xs text-[var(--color-textSecondary)]">
                  Expires in{" "}
                  {Math.max(0, Math.ceil((code.expires - now) / 1000))} seconds
                </p>
              </>
            )}
          </div>
          <div
            role="group"
            aria-label={`${entry.label} (${index + 1}) actions`}
            className="ml-auto flex shrink-0 items-center gap-1"
          >
            <button
              type="button"
              className="sor-icon-btn-sm"
              aria-label={`Copy code ${entry.label} (${index + 1})`}
              title={`Copy code ${entry.label} (${index + 1})`}
              disabled={busy || !active || !controller.available}
              onClick={() => void copy(entry.id)}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
            {renderTypeCode?.(entry.id)}
          </div>
        </div>
      ))}
      {footer}
    </section>
  );
}

export default function RuntimeVaultTotpPanel({
  controller,
  onClose,
  anchorRef,
  className,
  footer,
  credentialActions,
  typingRef,
  renderTypeCode,
}: Props) {
  return (
    <PopoverSurface
      isOpen
      onClose={onClose}
      anchorRef={anchorRef}
      className={className}
    >
      <Codes
        key={controller.scopeKey}
        controller={controller}
        onClose={onClose}
        footer={footer}
        credentialActions={credentialActions}
        typingRef={typingRef}
        renderTypeCode={renderTypeCode}
      />
    </PopoverSurface>
  );
}
