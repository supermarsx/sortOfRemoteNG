import {
  ExternalLink,
  LoaderCircle,
  MonitorUp,
  RefreshCw,
  ShieldAlert,
  Unplug,
} from "lucide-react";
import { useXdmcpClient } from "../../hooks/protocol/useXdmcpClient";
import type { ConnectionSession } from "../../types/connection/connection";

interface XdmcpClientProps {
  session: ConnectionSession;
}

export function XdmcpClient({ session }: XdmcpClientProps) {
  const client = useXdmcpClient(session);
  const running = client.status === "x-server-running";

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-background)]"
      aria-label={`Native XDMCP session for ${session.hostname}`}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <MonitorUp className="shrink-0 text-primary" size={20} />
          <div className="min-w-0">
            <h2 className="truncate font-medium text-[var(--color-text)]">
              XDMCP — {session.hostname}
            </h2>
            <p className="truncate text-xs text-[var(--color-textSecondary)]">
              User-visible session in a local native X server window
            </p>
          </div>
        </div>
        {running && (
          <button
            type="button"
            className="sor-button-secondary inline-flex items-center gap-2 text-xs"
            onClick={() => void client.disconnect()}
          >
            <Unplug size={14} /> Stop X server
          </button>
        )}
      </header>

      <div className="shrink-0 border-b border-warning/35 bg-warning/10 px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-start gap-3">
          <ShieldAlert className="mt-0.5 shrink-0 text-warning" size={20} />
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">
              XDMCP is unauthenticated and unencrypted
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-textSecondary)]">
              Session negotiation and X11 traffic can be observed or tampered
              with on the network. Use XDMCP only on a trusted isolated network.
              The app refuses launch until this risk is explicitly acknowledged.
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        <div className="w-full max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
          {client.status === "launching" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <LoaderCircle className="animate-spin text-primary" size={36} />
              <h3 className="font-medium text-[var(--color-text)]">
                Launching local X server
              </h3>
              <p className="text-sm text-[var(--color-textSecondary)]">
                The selected X server will own the complete XDMCP exchange and
                render the remote login in its native window.
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
                    Local X server process is running
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--color-textSecondary)]">
                    The user-visible session is in a separate native X server
                    window. This status confirms only that the local process is
                    alive; it does not claim that a remote login screen or
                    authenticated desktop was established.
                  </p>
                </div>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-[var(--color-textMuted)]">
                    Target
                  </dt>
                  <dd className="break-all text-[var(--color-text)]">
                    {client.sessionInfo?.host ?? session.hostname}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-textMuted)]">
                    Display
                  </dt>
                  <dd className="text-[var(--color-text)]">
                    :{client.sessionInfo?.display_number ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-textMuted)]">
                    Local process ID
                  </dt>
                  <dd className="font-mono text-xs text-[var(--color-text)]">
                    {client.sessionInfo?.x_server_pid ?? "—"}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {(client.status === "error" || client.status === "stopped") && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <MonitorUp className="text-[var(--color-textMuted)]" size={38} />
              <h3 className="font-medium text-[var(--color-text)]">
                {client.status === "error"
                  ? "X server could not be launched"
                  : "Local X server process stopped"}
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
