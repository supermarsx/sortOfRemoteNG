import React from "react";
import SectionHeading from '../../ui/SectionHeading';
import { MonitorDot } from "lucide-react";
import SectionHeading from '../../ui/SectionHeading';
import selectClass from "./rdpDefaults/selectClass";
import SectionHeading from '../../ui/SectionHeading';
import SessionManagement from "./rdpDefaults/SessionManagement";
import SectionHeading from '../../ui/SectionHeading';
import SecurityDefaults from "./rdpDefaults/SecurityDefaults";
import SectionHeading from '../../ui/SectionHeading';
import DisplayDefaults from "./rdpDefaults/DisplayDefaults";
import SectionHeading from '../../ui/SectionHeading';
import GatewayDefaults from "./rdpDefaults/GatewayDefaults";
import SectionHeading from '../../ui/SectionHeading';
import HyperVDefaults from "./rdpDefaults/HyperVDefaults";
import SectionHeading from '../../ui/SectionHeading';
import NegotiationDefaults from "./rdpDefaults/NegotiationDefaults";
import SectionHeading from '../../ui/SectionHeading';
import TcpSocketDefaults from "./rdpDefaults/TcpSocketDefaults";
import SectionHeading from '../../ui/SectionHeading';
import RenderBackendDefaults from "./rdpDefaults/RenderBackendDefaults";
import SectionHeading from '../../ui/SectionHeading';
import PerformanceDefaults from "./rdpDefaults/PerformanceDefaults";
import SectionHeading from '../../ui/SectionHeading';
import BitmapCodecDefaults from "./rdpDefaults/BitmapCodecDefaults";
import SectionHeading from '../../ui/SectionHeading';

export const RDPDefaultSettings: React.FC<RDPDefaultSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const rdp = settings.rdpDefaults ?? ({} as Rdp);

  const update = (patch: Partial<Rdp>) => {
    updateSettings({ rdpDefaults: { ...rdp, ...patch } });
  };

  return (
    <div className="space-y-6">
      <div>
        <SectionHeading icon={<MonitorDot className="w-5 h-5" />} title="RDP" description="Default configuration applied to all new RDP connections. Individual connections can override these settings." />
      </div>

      <SessionManagement settings={settings} updateSettings={updateSettings} />
      <SecurityDefaults rdp={rdp} update={update} />
      <DisplayDefaults rdp={rdp} update={update} />
      <GatewayDefaults rdp={rdp} update={update} />
      <HyperVDefaults rdp={rdp} update={update} />
      <NegotiationDefaults rdp={rdp} update={update} />
      <TcpSocketDefaults rdp={rdp} update={update} />
      <RenderBackendDefaults rdp={rdp} update={update} />
      <PerformanceDefaults rdp={rdp} update={update} />
      <BitmapCodecDefaults rdp={rdp} update={update} />
    </div>
  );
};

export default RDPDefaultSettings;
