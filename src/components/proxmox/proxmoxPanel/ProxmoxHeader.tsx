import React from "react";
import { useTranslation } from "react-i18next";
import { Server } from "lucide-react";
import DialogHeader from "../../ui/overlays/DialogHeader";
import type { SubPropsWithClose } from "./types";

const ProxmoxHeader: React.FC<SubPropsWithClose> = ({ mgr, onClose }) => {
  const { t } = useTranslation();
  const subtitle = mgr.connectionState === "connected"
    ? `${mgr.version?.version ?? ""} — ${mgr.nodes.length} node(s)`
    : t("proxmox.disconnected", "Not connected");

  return (
    <DialogHeader
      icon={Server}
      iconColor="text-warning"
      iconBg="bg-warning/20"
      title={t("proxmox.title", "Proxmox VE Manager")}
      subtitle={subtitle}
      onClose={onClose}
      className="shrink-0"
    />
  );
};

export default ProxmoxHeader;
