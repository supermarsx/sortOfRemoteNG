import { useEffect, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import { sshTunnelService } from "../../utils/ssh/sshTunnelService";
import { SSHTunnelDialog } from "./SSHTunnelDialog";

/** Tool sessions carry only a tunnel id. Password drafts remain inside the editor. */
export function SSHTunnelEditor({
  tunnelId,
  onClose,
}: {
  tunnelId?: string;
  onClose: () => void;
}) {
  const { state, databaseAvailability } = useConnections();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void sshTunnelService.ready().then(
      () => {
        if (active) setReady(true);
      },
      (e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load SSH tunnels.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!ready) return <p>Loading SSH tunnels…</p>;
  const editing = tunnelId ? sshTunnelService.getTunnel(tunnelId) : undefined;
  if (tunnelId && !editing)
    return (
      <p role="alert">
        This SSH tunnel is no longer available. Reopen it from the tunnel
        manager.
      </p>
    );
  return (
    <SSHTunnelDialog
      isOpen
      onClose={onClose}
      editingTunnel={editing}
      requireBaseReselection={
        !!editing?.sshConnectionId && !editing.ownerDatabaseId
      }
      sshConnections={state.connections.filter(
        (c) => c.protocol === "ssh" && !c.isGroup,
      )}
      onSave={async (params) => {
        if (params.sshConnectionId && databaseAvailability?.status !== "ready")
          throw new Error(
            "Open and unlock the saved SSH connection's database before saving this tunnel.",
          );
        if (
          editing?.ownerDatabaseId &&
          params.sshConnectionId === editing.sshConnectionId &&
          editing.ownerDatabaseId !== databaseAvailability?.databaseId
        )
          throw new Error(
            "Open the tunnel's original database before editing its saved SSH base.",
          );
        const owned = {
          ...params,
          ownerDatabaseId: params.sshConnectionId
            ? databaseAvailability?.databaseId
            : undefined,
        };
        if (tunnelId) {
          if (!(await sshTunnelService.updateTunnel(tunnelId, owned)))
            throw new Error(
              "This SSH tunnel was deleted. Reopen the tunnel manager.",
            );
        } else await sshTunnelService.createTunnel(owned);
        onClose();
      }}
    />
  );
}
