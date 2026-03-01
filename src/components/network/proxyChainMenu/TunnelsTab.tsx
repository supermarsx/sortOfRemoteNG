import { Mgr } from "./types";

function TunnelsTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text)]">
          SSH Tunnels
        </h3>
        <button
          onClick={mgr.handleNewTunnel}
          className="sor-btn-primary-sm"
        >
          <Plus size={14} />
          New Tunnel
        </button>
      </div>

      <div className="text-sm text-[var(--color-textSecondary)]">
        Create SSH tunnels using existing SSH connections to forward ports
        securely.
      </div>

      <div className="space-y-2">
        {mgr.sshTunnels.length === 0 ? (
          <div className="text-sm text-[var(--color-textSecondary)] py-8 text-center">
            No SSH tunnels configured. Click "New Tunnel" to create one.
          </div>
        ) : (
          mgr.sshTunnels.map((tunnel) => {
            const sshConn = mgr.connections.find(
              (c) => c.id === tunnel.sshConnectionId,
            );
            const localPort =
              tunnel.actualLocalPort || tunnel.localPort || "?";

            const getTunnelInfo = () => {
              switch (tunnel.type) {
                case "dynamic":
                  return `SOCKS5 proxy on localhost:${localPort}`;
                case "remote":
                  return `${tunnel.remoteHost}:${tunnel.remotePort} → localhost:${localPort}`;
                case "local":
                default:
                  return `localhost:${localPort} → ${tunnel.remoteHost}:${tunnel.remotePort}`;
              }
            };

            const getTypeLabel = () => {
              switch (tunnel.type) {
                case "dynamic":
                  return "Dynamic";
                case "remote":
                  return "Remote";
                case "local":
                default:
                  return "Local";
              }
            };

            return (
              <div
                key={tunnel.id}
                className="sor-selection-row"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {tunnel.name}
                    </div>
                    <span className="sor-badge sor-badge-blue">
                      {getTypeLabel()}
                    </span>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        tunnel.status === "connected"
                          ? "bg-green-500/20 text-green-400"
                          : tunnel.status === "connecting"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : tunnel.status === "error"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-[var(--color-secondary)]/20 text-[var(--color-textSecondary)]"
                      }`}
                    >
                      {tunnel.status}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)] mt-1">
                    <span className="text-[var(--color-textMuted)]">via</span>{" "}
                    {sshConn?.name || "Unknown SSH"}
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)] mt-0.5 font-mono">
                    {getTunnelInfo()}
                  </div>
                  {tunnel.error && (
                    <div className="text-xs text-red-400 mt-1">
                      {tunnel.error}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {tunnel.status === "connected" ? (
                    <button
                      onClick={() => mgr.handleDisconnectTunnel(tunnel.id)}
                      className="p-2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded-md"
                      title="Disconnect"
                    >
                      <Square size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => mgr.handleConnectTunnel(tunnel.id)}
                      disabled={tunnel.status === "connecting"}
                      className="p-2 text-[var(--color-textSecondary)] hover:text-green-400 hover:bg-[var(--color-border)] rounded-md disabled:opacity-50"
                      title="Connect"
                    >
                      <Play size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => mgr.handleEditTunnel(tunnel)}
                    disabled={tunnel.status === "connected"}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-[var(--color-border)] rounded-md disabled:opacity-50"
                    title="Edit"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleDeleteTunnel(tunnel.id)}
                    disabled={tunnel.status === "connected"}
                    className="p-2 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-[var(--color-border)] rounded-md disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default TunnelsTab;
