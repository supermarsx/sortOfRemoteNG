import React from "react";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { useSecuritySettings } from "../../../hooks/settings/useSecuritySettings";
import SectionHeading from '../../ui/SectionHeading';
import AutoLockSection from "./security/AutoLockSection";
import CollectionKeyGenSection from "./security/CollectionKeyGenSection";
import CredSSPSection from "./security/CredSSPSection";
import EncryptionAlgorithmSection from "./security/EncryptionAlgorithmSection";
import EncryptionAtRestSection from "./security/EncryptionAtRestSection";
import ExportSecuritySection from "./security/ExportSecuritySection";
import KeyDerivationSection from "./security/KeyDerivationSection";
import PasswordRevealSection from "./security/PasswordRevealSection";
import SSHKeyGenSection from "./security/SSHKeyGenSection";
import TOTPDefaultsSection from "./security/TOTPDefaultsSection";
import type { SecuritySettingsProps } from "./security/types";

export const SecuritySettings: React.FC<SecuritySettingsProps> = ({
  settings,
  updateSettings,
  handleBenchmark,
  isBenchmarking,
}) => {
  const { t } = useTranslation();
  const mgr = useSecuritySettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <SectionHeading icon={<Shield className="w-5 h-5 text-primary" />} title="Security" description="Encryption algorithms, key derivation, master password, and credential storage settings." />

      <EncryptionAtRestSection />
      <EncryptionAlgorithmSection settings={settings} updateSettings={updateSettings} mgr={mgr} t={t} />
      <KeyDerivationSection settings={settings} updateSettings={updateSettings} handleBenchmark={handleBenchmark} isBenchmarking={isBenchmarking} t={t} />
      <ExportSecuritySection settings={settings} updateSettings={updateSettings} />
      <AutoLockSection settings={settings} updateSettings={updateSettings} mgr={mgr} />
      <SSHKeyGenSection mgr={mgr} />
      <CollectionKeyGenSection mgr={mgr} />
      <CredSSPSection settings={settings} updateSettings={updateSettings} />
      <PasswordRevealSection settings={settings} updateSettings={updateSettings} />
      <TOTPDefaultsSection settings={settings} updateSettings={updateSettings} />
    </div>
  );
};

export default SecuritySettings;
