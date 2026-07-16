import {
  ExternalLink,
  LoaderCircle,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { useSpiceClient } from "../../hooks/protocol/useSpiceClient";
import type { ConnectionSession } from "../../types/connection/connection";

interface SpiceClientProps {
  session: ConnectionSession;
}

export function SpiceClient({ session }: SpiceClientProps) {
  const client = useSpiceClient(session);
  const running = client.status === "viewer-running";

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-background)]"
      aria-label={`Native SPICE viewer for ${session.hostname}`}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Monitor className="shrink-0 text-primary" size={20} />
          <div className="min-w-0">
            <h2 className="truncate font-medium text-[var(--color-text)]">
              SPICE — {session.hostname}
            </h2>
            <p className="truncate text-xs text-[var(--color-textSecondary)]">
              Complete display session in virt-viewer&apos;s native window
            </p>
          </div>
        </div>
        {running && (
          <button
            type="button"
            className="sor-button-secondary inline-flex items-center gap-2 text-xs"
            onClick={() => void client.disconnect()}
          >
            <Unplug size={14} /> Stop viewer
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
          {client.status === "launching" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <LoaderCircle className="animate-spin text-primary" size={36} />
              <h3 className="font-medium text-[var(--color-text)]">
                Launching native SPICE viewer
              </h3>
              <p className="text-sm text-[var(--color-textSecondary)]">
                Checking virt-viewer and handing the connection settings to it
                over a private standard-input stream.
              </p>
            </div>
          )}

          {running && (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <ExternalLink
                  className="mt-0.5 shrink-0 text-success"
                  size={24}
                />
                <div>
                  <h3 className="font-medium text-[var(--color-text)]">
                    Native viewer process is running
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--color-textSecondary)]">
                    The interactive display is in a separate remote-viewer
                    window. This status confirms only that the local viewer
                    process remains alive; authentication and remote display
                    readiness are owned by that window and cannot be verified
                    here.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4">
                <ShieldCheck
                  className="mt-0.5 shrink-0 text-primary"
                  size={19}
                />
                <p className="text-xs leading-relaxed text-[var(--color-textSecondary)]">
                  SPICE ticket credentials are streamed to remote-viewer via
                  stdin. They are not placed in process arguments, logs, or
                  retained backend session metadata.
                </p>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[var(--color-textMuted)]">
                    Target
                  </dt>
                  <dd className="break-all text-[var(--color-text)]">
                    {client.sessionInfo?.host ?? session.hostname}:
                    {client.sessionInfo?.port ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-textMuted)]">
                    Backend handle
                  </dt>
                  <dd className="break-all font-mono text-xs text-[var(--color-text)]">
                    {client.backendSessionId}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {(client.status === "error" || client.status === "stopped") && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Monitor className="text-[var(--color-textMuted)]" size={38} />
              <h3 className="font-medium text-[var(--color-text)]">
                {client.status === "error"
                  ? "Native viewer could not be launched"
                  : "Native viewer process stopped"}
              </h3>
              {client.error && (
                <p className="max-w-xl rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 p-3 text-left text-xs text-[var(--color-textSecondary)]">
                  {client.error}
                </p>
              )}
              <button
                type="button"
                className="sor-button-primary inline-flex items-center gap-2 text-xs"
                onClick={() => void client.reconnect()}
              >
                <RefreshCw size={14} /> Launch again
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
