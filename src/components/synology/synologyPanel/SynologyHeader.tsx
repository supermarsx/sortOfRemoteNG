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
  return (
    <DialogHeader
      icon={Database}
      iconColor="text-teal-500"
      iconBg="bg-teal-500/20"
      title="Synology NAS Manager"
      subtitle={
        connection.connectionStatus === "connected"
          ? connection.host
          : "Not connected"
      }
      onClose={onClose}
      className="shrink-0"
    />
  );
}
