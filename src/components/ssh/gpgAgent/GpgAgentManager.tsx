import React from "react";
import { Shield, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../../ui/overlays/Modal";
import { useGpgAgent } from "../../../hooks/ssh/useGpgAgent";
import { ErrorBanner } from "./helpers";
import { tabs, type GpgTab, type GpgAgentManagerProps } from "./types";
import OverviewTab from "./OverviewTab";
import KeyringTab from "./KeyringTab";
import SignVerifyTab from "./SignVerifyTab";
import EncryptDecryptTab from "./EncryptDecryptTab";
import TrustTab from "./TrustTab";
import SmartCardTab from "./SmartCardTab";
import KeyserverTab from "./KeyserverTab";
import AuditTab from "./AuditTab";
import ConfigTab from "./ConfigTab";

/* ------------------------------------------------------------------ */
/*  TabBar (internal)                                                  */
/* ------------------------------------------------------------------ */

const TabBar: React.FC<{ active: string; onChange: (tab: GpgTab) => void }> = ({
  active,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <div className="sor-gpg-tabbar flex gap-1 mb-4 border-b border-border pb-2 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-sm whitespace-nowrap transition-colors ${
            active === tab.id
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          {tab.icon}
          {t(tab.labelKey, tab.id)}
        </button>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  GpgAgentManager                                                    */
/* ------------------------------------------------------------------ */

const GpgAgentManager: React.FC<GpgAgentManagerProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const mgr = useGpgAgent();

  return (
    <Modal isOpen={isOpen} onClose={onClose} panelClassName="max-w-5xl">
      <ModalHeader
        onClose={onClose}
        title={
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            {t("gpgAgent.title", "GPG Agent Manager")}
          </div>
        }
      />
      <ModalBody>
        <ErrorBanner error={mgr.error} />

        {mgr.loading && (
          <div className="sor-gpg-loading absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        <TabBar active={mgr.activeTab} onChange={(tab) => mgr.setActiveTab(tab)} />

        {mgr.activeTab === "overview" && <OverviewTab mgr={mgr} />}
        {mgr.activeTab === "keyring" && <KeyringTab mgr={mgr} />}
        {mgr.activeTab === "sign-verify" && <SignVerifyTab mgr={mgr} />}
        {mgr.activeTab === "encrypt-decrypt" && <EncryptDecryptTab mgr={mgr} />}
        {mgr.activeTab === "trust" && <TrustTab mgr={mgr} />}
        {mgr.activeTab === "smartcard" && <SmartCardTab mgr={mgr} />}
        {mgr.activeTab === "keyserver" && <KeyserverTab mgr={mgr} />}
        {mgr.activeTab === "audit" && <AuditTab mgr={mgr} />}
        {mgr.activeTab === "config" && <ConfigTab mgr={mgr} />}
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors"
        >
          {t("common.close", "Close")}
        </button>
      </ModalFooter>
    </Modal>
  );
};

export { GpgAgentManager };
