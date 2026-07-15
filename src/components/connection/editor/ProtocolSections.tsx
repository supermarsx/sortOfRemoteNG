import React from "react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import BackupCodesSection from "../../connectionEditor/BackupCodesSection";
import CloudProviderOptions from "../../connectionEditor/CloudProviderOptions";
import HTTPOptions from "../../connectionEditor/HTTPOptions";
import RDPOptions from "../../connectionEditor/RDPOptions";
import RecoveryInfoSection from "../../connectionEditor/RecoveryInfoSection";
import SecurityQuestionsSection from "../../connectionEditor/SecurityQuestionsSection";
import SSHOptions from "../../connectionEditor/SSHOptions";
import TOTPOptions from "../../connectionEditor/TOTPOptions";
import WinRMOptions from "../../connectionEditor/WinRMOptions";

export const ProtocolSections: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => (
  <div
    data-editor-search-section="protocol-options"
    data-editor-search-field="protocol-options"
    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-3 space-y-2"
  >
    <SSHOptions
      formData={mgr.formData}
      setFormData={mgr.setFormData}
      sshSecretManager={mgr.sshSecrets}
    />
    <HTTPOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <CloudProviderOptions
      formData={mgr.formData}
      setFormData={mgr.setFormData}
    />
    <RDPOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <WinRMOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <TOTPOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <BackupCodesSection formData={mgr.formData} setFormData={mgr.setFormData} />
    <SecurityQuestionsSection
      formData={mgr.formData}
      setFormData={mgr.setFormData}
    />
    <RecoveryInfoSection
      formData={mgr.formData}
      setFormData={mgr.setFormData}
    />
  </div>
);
