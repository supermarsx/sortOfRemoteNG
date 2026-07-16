import {
  AlertTriangle,
  ExternalLink,
  MonitorUp,
  Power,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { ConnectionSession } from "../../types/connection/connection";
import { useX2goNativeSession } from "../../hooks/protocol/useX2goNativeSession";

export interface X2goNativeClientProps {
  session: ConnectionSession;
}

export function X2goNativeClient({ session }: X2goNativeClientProps) {
  const client = useX2goNativeSession(session);
  const running = client.status === "native-client-running";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-[var(--color-background)] p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center">
        <section className="w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <MonitorUp aria-hidden="true" size={28} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textMuted)]">
                Native desktop handoff
              </p>
              <h2 className="mt-1 text-xl font-semibold text-[var(--color-text)]">
                X2Go Client
              </h2>
              <p className="mt-1 break-all text-sm text-[var(--color-textSecondary)]">
                {session.hostname}
              </p>
            </div>
          </div>

          <div
            className={`mt-6 rounded-xl border p-4 ${
              running
                ? "border-success/40 bg-success/10"
                : client.status === "error"
                  ? "border-error/40 bg-error/10"
                  : "border-[var(--color-border)] bg-[var(--color-background)]"
            }`}
          >
            <div className="flex items-center gap-2 font-medium text-[var(--color-text)]">
              {client.status === "error" ? (
                <AlertTriangle className="text-error" size={18} />
              ) : running ? (
                <ExternalLink className="text-success" size={18} />
              ) : (
                <RefreshCw
                  className={
                    client.status === "launching" ? "animate-spin" : ""
                  }
                  size={18}
                />
              )}
              {client.status === "launching" && "Launching X2Go Client…"}
              {running && "Native X2Go Client is running"}
              {client.status === "exited" && "Native X2Go Client has exited"}
              {client.status === "error" && "X2Go Client could not be launched"}
            </div>
            {client.info?.native_client_pid ? (
              <p className="mt-2 text-xs text-[var(--color-textMuted)]">
                Local process ID: {client.info.native_client_pid}
              </p>
            ) : null}
            {client.error ? (
              <p className="mt-3 text-sm text-error" role="alert">
                {client.error}
              </p>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 text-sm text-[var(--color-textSecondary)] sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex items-center gap-2 font-medium text-[var(--color-text)]">
                <ShieldCheck size={16} /> Authentication stays native
              </div>
              <p className="mt-2">
                Complete host-key trust, password, key-passphrase, and MFA
                prompts in the X2Go window. Saved passwords are not sent on argv
                or written to its temporary profile.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="font-medium text-[var(--color-text)]">
                Process status, not an auth claim
              </div>
              <p className="mt-2">
                “Running” confirms only the local client process. The native
                window owns the real remote pixels and input; no embedded
                framebuffer is claimed here.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {!running ? (
              <button
                type="button"
                onClick={() => void client.launch()}
                disabled={client.status === "launching"}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ExternalLink size={16} /> Launch X2Go Client
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void client.disconnect()}
                className="inline-flex items-center gap-2 rounded-lg border border-error/50 px-4 py-2 text-sm font-medium text-error hover:bg-error/10"
              >
                <Power size={16} /> Close native client
              </button>
            )}
            <button
              type="button"
              onClick={() => void client.refresh()}
              disabled={!client.info}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={16} /> Refresh process status
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
