import { Database } from "lucide-react";
import DialogHeader from "../../ui/overlays/DialogHeader";
import type { useSynologyFileConnection } from "../../../hooks/synology/useSynologyFileConnection";
export default function SynologyHeader({
  connection,
  onClose,
}: {
  connection: ReturnType<typeof useSynologyFileConnection>;
  onClose: () => void;
}) {
  const connected = connection.connectionStatus === "connected";
  // The account used for this sign-in, so a saved or mistyped username is obvious.
  const username = connected ? connection.username.trim() : "";
  return (
    <DialogHeader
      icon={Database}
      iconColor="text-teal-500"
      iconBg="bg-teal-500/20"
      title="Synology NAS API"
      subtitle={
        connected ? (
          <>
            <span data-testid="synology-header-host">{connection.host}</span>
            {username && (
              <>
                {" · "}
                <span
                  data-testid="synology-header-account"
                  className="break-all"
                >
                  Signed in as{" "}
                  <span className="text-[var(--color-text)]">{username}</span>
                </span>
              </>
            )}
          </>
        ) : (
          "Not connected"
        )
      }
      onClose={onClose}
      className="shrink-0"
    />
  );
}
