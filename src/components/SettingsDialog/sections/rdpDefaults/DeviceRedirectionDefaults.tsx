import type { SectionProps, Rdp } from "./selectClass";
import React from "react";
import {
  HardDrive, FolderOpen, Copy, Printer, Cable, CreditCard,
  ShieldCheck, Video, Mic, Usb,
} from "lucide-react";
import { Toggle } from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import { DriveMappingEditor } from "../../../connectionEditor/rdpOptions/DeviceRedirectionSection";
import type { RdpDriveRedirection } from "../../../../types/connection/connection";

const devices: { key: keyof Rdp; label: string; description: string; defaultVal: boolean; icon: React.ReactNode }[] = [
  { key: "clipboardRedirection", label: "Clipboard", description: "Share clipboard between local and remote for copy/paste", defaultVal: true, icon: <Copy size={16} /> },
  { key: "printerRedirection", label: "Printers", description: "Redirect local printers to the remote session", defaultVal: false, icon: <Printer size={16} /> },
  { key: "portRedirection", label: "Serial / COM Ports", description: "Redirect serial/COM ports for hardware devices", defaultVal: false, icon: <Cable size={16} /> },
  { key: "smartCardRedirection", label: "Smart Cards", description: "Redirect smart card readers for authentication", defaultVal: false, icon: <CreditCard size={16} /> },
  { key: "webAuthnRedirection", label: "WebAuthn / FIDO", description: "Redirect security keys for passwordless auth", defaultVal: false, icon: <ShieldCheck size={16} /> },
  { key: "videoCaptureRedirection", label: "Video Capture", description: "Redirect local cameras to the remote session", defaultVal: false, icon: <Video size={16} /> },
  { key: "audioInputRedirection", label: "Audio Input", description: "Redirect microphone to the remote session", defaultVal: false, icon: <Mic size={16} /> },
  { key: "usbRedirection", label: "USB Devices", description: "Redirect USB devices for direct hardware access", defaultVal: false, icon: <Usb size={16} /> },
  { key: "driveRedirection", label: "Drive Redirection", description: "Share local drives and folders as mapped network drives", defaultVal: false, icon: <HardDrive size={16} /> },
];

const DeviceRedirectionDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <HardDrive className="w-4 h-4 text-accent" />
      Local Resource Defaults
    </h4>
    <p className="text-xs text-[var(--color-textMuted)] -mt-2">
      Global device redirection settings inherited by all connections. Per-connection settings can override these.
    </p>

    {devices.map((d) => (
      <Toggle
        key={d.key}
        checked={(rdp[d.key] as boolean | undefined) ?? d.defaultVal}
        onChange={(v: boolean) => update({ [d.key]: v } as any)}
        icon={d.icon}
        label={d.label}
        description={d.description}
        settingKey={`rdpDefaults.${d.key}`}
      />
    ))}

    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
      <h5 className="text-xs font-medium text-[var(--color-textSecondary)] mb-2 flex items-center gap-1.5">
        <FolderOpen size={12} className="text-accent" />
        Global Drive Mappings
        <InfoTooltip text="Drive mappings inherited by all RDP connections. Individual connections can exclude specific mappings or add their own. Requires Drive Redirection to be enabled." />
      </h5>
      <DriveMappingEditor
        drives={((rdp as Record<string, unknown>).driveRedirections as RdpDriveRedirection[] | undefined) ?? []}
        onChange={(drives) => {
          const patch: Record<string, unknown> = { driveRedirections: drives };
          if (drives.length > 0 && !rdp.driveRedirection) {
            patch.driveRedirection = true;
          }
          update(patch as any);
        }}
        selectClass="sor-form-input"
      />
    </div>
  </div>
);

export default DeviceRedirectionDefaults;
