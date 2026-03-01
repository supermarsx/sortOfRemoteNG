import React from "react";
import { Mgr } from "./types";
import DialogHeader from "../../ui/overlays/DialogHeader";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";

const MonitorHeader: React.FC<{
  mgr: Mgr;
  onClose: () => void;
}> = ({ mgr, onClose }) => {
  const { t } = useTranslation();
  return (
    <DialogHeader
      icon={BarChart3}
      iconColor="text-green-500"
      iconBg="bg-green-500/20"
      title={t("performance.title")}
      subtitle={`${mgr.filteredMetrics.length} entries`}
      onClose={onClose}
      className="shrink-0"
    />
  );
};


export default MonitorHeader;
