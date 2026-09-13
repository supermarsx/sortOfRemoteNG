import React from "react";
import { Shield } from "lucide-react";
import { useSecuritySettings } from "../../../hooks/settings/useSecuritySettings";
import SectionHeading from "../../ui/SectionHeading";
import AutoLockSection from "./security/AutoLockSection";
import CollectionKeyGenSection from "./security/CollectionKeyGenSection";
import CredSSPSection from "./security/CredSSPSection";
import EncryptionAlgorithmSection from "./security/EncryptionAlgorithmSection";
import EncryptionAtRestSection from "./security/EncryptionAtRestSection";
import ExportSecuritySection from "./security/ExportSecuritySection";
import KeyDerivationSection from "./security/KeyDerivationSection";
import PasswordRevealSection from "./security/PasswordRevealSection";
import TerminalLinksSection from "./security/TerminalLinksSection";
import SSHKeyGenSection from "./security/SSHKeyGenSection";
import TOTPDefaultsSection from "./security/TOTPDefaultsSection";
import type { SecuritySettingsProps } from "./security/types";
import YubiKeySecuritySection from "./security/YubiKeySecuritySection";
import PasswordPolicySection from "./security/PasswordPolicySection";

export const SecuritySettings: React.FC<SecuritySettingsProps> = ({
  settings,
  updateSettings,
  onOpenCurrentDatabase,
  onOpenHardwareKeys,
}) => {
  const mgr = useSecuritySettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Shield className="w-5 h-5 text-primary" />}
        title="Security"
        description="Global master-key protection and application-wide security policies. Database-owned controls are in Current Database."
      />

      <EncryptionAtRestSection />
      <section className="sor-settings-card space-y-2">
        <h3 className="text-sm font-medium">
          Database-specific settings moved
        </h3>
        <p className="text-sm text-[var(--color-textSecondary)]">
          Current database protection, document types, recycle-bin retention and
          credentials now have their own settings section. Global at-rest
          protection above is unchanged.
        </p>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={onOpenCurrentDatabase}
          disabled={!onOpenCurrentDatabase}
        >
          Open Current Database settings
        </button>
      </section>
      <h3 className="text-sm font-medium">
        Global policies, export defaults, and key tools
      </h3>
      <EncryptionAlgorithmSection />
      <PasswordPolicySection />
      <KeyDerivationSection />
      <ExportSecuritySection
        settings={settings}
        updateSettings={updateSettings}
      />
      <AutoLockSection
        settings={settings}
        updateSettings={updateSettings}
        mgr={mgr}
      />
      <SSHKeyGenSection mgr={mgr} />
      <YubiKeySecuritySection onOpen={onOpenHardwareKeys} />
      <CollectionKeyGenSection mgr={mgr} />
      <CredSSPSection settings={settings} updateSettings={updateSettings} />
      <PasswordRevealSection
        settings={settings}
        updateSettings={updateSettings}
      />
      <TerminalLinksSection
        settings={settings}
        updateSettings={updateSettings}
      />
      <TOTPDefaultsSection
        settings={settings}
        updateSettings={updateSettings}
      />
    </div>
  );
};

export default SecuritySettings;
