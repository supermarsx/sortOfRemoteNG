import React from "react";
import SectionHeading from '../../ui/SectionHeading';
import { useTranslation } from "react-i18next";
import { SSHTerminalConfig, defaultSSHTerminalConfig } from "../../../types/settings/settings";
import type { GlobalSettings } from "../../../types/settings/settings";
import { Terminal } from "lucide-react";
import Toggle from "./sshTerminal/Toggle";
import LineHandlingSection from "./sshTerminal/LineHandlingSection";
import LineDisciplineSection from "./sshTerminal/LineDisciplineSection";
import BELL_STYLE_LABELS, { BellSection } from "./sshTerminal/BELL_STYLE_LABELS";
import KeyboardSection from "./sshTerminal/KeyboardSection";
import DimensionsSection from "./sshTerminal/DimensionsSection";
import CharacterSetSection from "./sshTerminal/CharacterSetSection";
import FontSection from "./sshTerminal/FontSection";
import ColorsSection from "./sshTerminal/ColorsSection";
import TcpOptionsSection from "./sshTerminal/TcpOptionsSection";
import SSHProtocolSection from "./sshTerminal/SSHProtocolSection";
import ScrollbackSection from "./sshTerminal/ScrollbackSection";
import MiscSection from "./sshTerminal/MiscSection";
import TEXTAREA_CLASS, { AdvancedSSHSection } from "./sshTerminal/TEXTAREA_CLASS";
import BackgroundSection from "./sshTerminal/BackgroundSection";

interface SSHTerminalSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const SSHTerminalSettings: React.FC<SSHTerminalSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  const cfg = settings.sshTerminal || defaultSSHTerminalConfig;

  const up = (updates: Partial<SSHTerminalConfig>) => {
    updateSettings({ sshTerminal: { ...cfg, ...updates } });
  };

  return (
    <div className="space-y-6">
      <SectionHeading icon={<Terminal className="w-5 h-5" />} title="SSH Terminal" description="Terminal line handling, bell, keyboard, font, colors, scrollback, and SSH protocol settings." />

      <LineHandlingSection cfg={cfg} up={up} t={t} />
      <LineDisciplineSection cfg={cfg} up={up} t={t} />
      <BellSection cfg={cfg} up={up} t={t} />
      <KeyboardSection cfg={cfg} up={up} t={t} />
      <DimensionsSection cfg={cfg} up={up} t={t} />
      <CharacterSetSection cfg={cfg} up={up} t={t} />
      <FontSection cfg={cfg} up={up} t={t} />
      <ColorsSection cfg={cfg} up={up} t={t} />
      <BackgroundSection cfg={cfg} up={up} t={t} />
      <TcpOptionsSection cfg={cfg} up={up} t={t} />
      <SSHProtocolSection cfg={cfg} up={up} t={t} />
      <ScrollbackSection cfg={cfg} up={up} t={t} />
      <MiscSection cfg={cfg} up={up} t={t} />
      <AdvancedSSHSection cfg={cfg} up={up} t={t} />
    </div>
  );
};

export default SSHTerminalSettings;
