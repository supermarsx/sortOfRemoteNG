import React from "react";
import { useTranslation } from "react-i18next";
import { Database } from "lucide-react";
import DialogHeader from "../../ui/overlays/DialogHeader";
import type { SubPropsWithClose } from "./types";

const SynologyHeader: React.FC<SubPropsWithClose> = ({ mgr, onClose }) => {
  const { t } = useTranslation();
  const subtitle =
    mgr.connectionStatus === "connected"
      ? mgr.dashboard?.system_info?.model
        ? `${mgr.dashboard.system_info.model} — DSM ${mgr.dashboard.system_info.version ?? ""}`
        : t("synology.connected", "Connected")
      : t("synology.disconnected", "Not connected");

  return (
    <DialogHeader
      icon={Database}
      iconColor="text-teal-500"
      iconBg="bg-teal-500/20"
      title={t("synology.title", "Synology NAS Manager")}
      subtitle={subtitle}
      onClose={onClose}
      className="shrink-0"
    />
  );
};

export default SynologyHeader;
