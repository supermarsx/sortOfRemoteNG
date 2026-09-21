import React, { useEffect, useRef, useState } from "react";
import { Copy, KeyRound, X } from "lucide-react";
import type {
  RuntimeVaultTotpController,
  RuntimeVaultTotpEntry,
} from "../../hooks/security/useRuntimeVaultTotp";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { useSessionObservationActivity } from "../../hooks/session/useSessionObservationActivity";
import { PopoverSurface } from "../ui/overlays/PopoverSurface";

type Props = {
  controller: RuntimeVaultTotpController;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  footer?: React.ReactNode;
};
type Code = Awaited<ReturnType<RuntimeVaultTotpController["generate"]>>;

function Codes({ controller, onClose, footer }: Omit<Props, "anchorRef">) {
  const connectionSource = controller.sourceKind === "connection";
  const [entries, setEntries] = useState<RuntimeVaultTotpEntry[]>([]);
  const [code, setCode] = useState<Code | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const active = useSessionObservationActivity(
    useSessionRenderActivity().isActive,
  );
  const latest = useRef(controller);
  latest.current = controller;
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
          "The code expired or vault access changed. Generate a fresh code.",
        );
      }
    };
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [active, controller.available, code]);
  const generate = async (id: string) => {
    if (busy || !active || !latest.current.available) return;
    const ticket = ++epoch.current;
    setCode(null);
    setError("");
    setBusy(true);
    try {
      const value = await latest.current.generate(id);
      value.assertCurrent();
      if (epoch.current === ticket) {
        setNow(Date.now());
        setCode(value);
      }
    } catch {
      if (epoch.current === ticket)
        setError(
          "A code could not be generated safely. Check vault access and try again.",
        );
    } finally {
      if (epoch.current === ticket) setBusy(false);
    }
  };
  const copy = async () => {
    if (!code || !active || !latest.current.available) return;
    try {
      code.assertCurrent();
      await navigator.clipboard.writeText(code.code);
    } catch {
      setCode(null);
      setError(
        "The code could not be copied safely. Generate a fresh code after checking vault access.",
      );
    }
  };
  return (
    <section
      className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-4"
      aria-label={`${connectionSource ? "Connection" : "Vault"} authenticator codes`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <KeyRound size={16} />
          {connectionSource ? "Connection" : "Vault"} authenticator codes
        </h3>
        <button
          type="button"
          className="sor-icon-btn"
          aria-label="Close authenticator codes"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Generate and copy explicitly. Codes are not pasted or submitted
        automatically.
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
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm">{entry.label}</span>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={busy || !active || !controller.available}
            onClick={() => void generate(entry.id)}
          >
            Generate<span className="sr-only"> {entry.label}</span>
          </button>
        </div>
      ))}
      {code && active && controller.available && (
        <div className="rounded border border-[var(--color-border)] p-3">
          <div className="flex items-center justify-between">
            <output
              aria-label="Generated authenticator code"
              className="font-mono text-lg tracking-widest"
            >
              {code.code}
            </output>
            <button
              type="button"
              className="sor-icon-btn"
              aria-label="Copy authenticator code"
              onClick={() => void copy()}
            >
              <Copy size={16} />
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
            Expires in {Math.max(0, Math.ceil((code.expires - now) / 1000))}{" "}
            seconds
          </p>
        </div>
      )}
      {footer}
    </section>
  );
}

export default function RuntimeVaultTotpPanel({
  controller,
  onClose,
  anchorRef,
  footer,
}: Props) {
  return (
    <PopoverSurface isOpen onClose={onClose} anchorRef={anchorRef}>
      <Codes
        key={controller.scopeKey}
        controller={controller}
        onClose={onClose}
        footer={footer}
      />
    </PopoverSurface>
  );
}
