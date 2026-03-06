import React from "react";
import SectionHeading from '../../ui/SectionHeading';
import { MonitorDot } from "lucide-react";
import selectClass from "./rdpDefaults/selectClass";
import SessionManagement from "./rdpDefaults/SessionManagement";
import SecurityDefaults from "./rdpDefaults/SecurityDefaults";
import DisplayDefaults from "./rdpDefaults/DisplayDefaults";
import GatewayDefaults from "./rdpDefaults/GatewayDefaults";
import HyperVDefaults from "./rdpDefaults/HyperVDefaults";
import NegotiationDefaults from "./rdpDefaults/NegotiationDefaults";
import TcpSocketDefaults from "./rdpDefaults/TcpSocketDefaults";
import RenderBackendDefaults from "./rdpDefaults/RenderBackendDefaults";
import PerformanceDefaults from "./rdpDefaults/PerformanceDefaults";
import BitmapCodecDefaults from "./rdpDefaults/BitmapCodecDefaults";

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
