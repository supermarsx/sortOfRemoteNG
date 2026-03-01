import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings";
import {
  Shield,
  Lock,
  Key,
  Timer,
  Gauge,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  FileKey,
  Download,
  CheckCircle,
  Database,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  useSecuritySettings,
  ENCRYPTION_ALGORITHMS,
} from "../../../hooks/settings/useSecuritySettings";
import { Checkbox, NumberInput, Select, Slider } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';
import AutoLockSection from "./security/AutoLockSection";
import SectionHeading from '../../ui/SectionHeading';
import CollectionKeyGenSection from "./security/CollectionKeyGenSection";
import SectionHeading from '../../ui/SectionHeading';
import CredSSPSection from "./security/CredSSPSection";
import SectionHeading from '../../ui/SectionHeading';
import EncryptionAlgorithmSection from "./security/EncryptionAlgorithmSection";
import SectionHeading from '../../ui/SectionHeading';
import KeyDerivationSection from "./security/KeyDerivationSection";
import SectionHeading from '../../ui/SectionHeading';
import PasswordRevealSection from "./security/PasswordRevealSection";
import SectionHeading from '../../ui/SectionHeading';
import SSHKeyGenSection from "./security/SSHKeyGenSection";
import SectionHeading from '../../ui/SectionHeading';
import TOTPDefaultsSection from "./security/TOTPDefaultsSection";
import SectionHeading from '../../ui/SectionHeading';
import type { SecuritySettingsProps, Mgr } from "./security/types";
import SectionHeading from '../../ui/SectionHeading';

interface SecuritySettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
  handleBenchmark: () => void;
  isBenchmarking: boolean;
}

type Mgr = ReturnType<typeof useSecuritySettings>;

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
      <SectionHeading icon={<Shield className="w-5 h-5" />} title="Security" description="Encryption algorithms, key derivation, master password, and credential storage settings." />

      <EncryptionAlgorithmSection settings={settings} updateSettings={updateSettings} mgr={mgr} t={t} />
      <KeyDerivationSection settings={settings} updateSettings={updateSettings} handleBenchmark={handleBenchmark} isBenchmarking={isBenchmarking} t={t} />
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
