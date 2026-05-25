import type { SectionProps } from "./selectClass";
import React from "react";
import { Server } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const HyperVDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Server className="w-4 h-4 text-primary" />}
      title="Hyper-V Defaults"
    />

    <Card>
      <Toggle
        checked={rdp.enhancedSessionMode ?? false}
        onChange={(v) => update({ enhancedSessionMode: v })}
        icon={<Server size={16} />}
        label="Use Enhanced Session Mode by default"
        description="Enable clipboard, drive redirection, and improved audio in Hyper-V VMs"
        infoTooltip="Enables Enhanced Session Mode for Hyper-V VMs, providing clipboard sharing, drive redirection, and improved audio."
      />
    </Card>
  </div>
);

export default HyperVDefaults;
