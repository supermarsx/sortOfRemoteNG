import React from "react";
import SectionHeading from '../../ui/SectionHeading';
import { useTranslation } from "react-i18next";
import SectionHeading from '../../ui/SectionHeading';
import { SSHTerminalConfig, defaultSSHTerminalConfig } from "../../../types/settings";
import SectionHeading from '../../ui/SectionHeading';
import { Terminal } from "lucide-react";
import SectionHeading from '../../ui/SectionHeading';
import Toggle from "./sshTerminal/Toggle";
import SectionHeading from '../../ui/SectionHeading';
import LineHandlingSection from "./sshTerminal/LineHandlingSection";
import SectionHeading from '../../ui/SectionHeading';
import LineDisciplineSection from "./sshTerminal/LineDisciplineSection";
import SectionHeading from '../../ui/SectionHeading';
import BELL_STYLE_LABELS from "./sshTerminal/BELL_STYLE_LABELS";
import SectionHeading from '../../ui/SectionHeading';
import KeyboardSection from "./sshTerminal/KeyboardSection";
import SectionHeading from '../../ui/SectionHeading';
import DimensionsSection from "./sshTerminal/DimensionsSection";
import SectionHeading from '../../ui/SectionHeading';
import CharacterSetSection from "./sshTerminal/CharacterSetSection";
import SectionHeading from '../../ui/SectionHeading';
import FontSection from "./sshTerminal/FontSection";
import SectionHeading from '../../ui/SectionHeading';
import ColorsSection from "./sshTerminal/ColorsSection";
import SectionHeading from '../../ui/SectionHeading';
import TcpOptionsSection from "./sshTerminal/TcpOptionsSection";
import SectionHeading from '../../ui/SectionHeading';
import SSHProtocolSection from "./sshTerminal/SSHProtocolSection";
import SectionHeading from '../../ui/SectionHeading';
import ScrollbackSection from "./sshTerminal/ScrollbackSection";
import SectionHeading from '../../ui/SectionHeading';
import MiscSection from "./sshTerminal/MiscSection";
import SectionHeading from '../../ui/SectionHeading';
import TEXTAREA_CLASS from "./sshTerminal/TEXTAREA_CLASS";
import SectionHeading from '../../ui/SectionHeading';

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
      <TcpOptionsSection cfg={cfg} up={up} t={t} />
      <SSHProtocolSection cfg={cfg} up={up} t={t} />
      <ScrollbackSection cfg={cfg} up={up} t={t} />
      <MiscSection cfg={cfg} up={up} t={t} />
      <AdvancedSSHSection cfg={cfg} up={up} t={t} />
    </div>
  );
};

export default SSHTerminalSettings;
