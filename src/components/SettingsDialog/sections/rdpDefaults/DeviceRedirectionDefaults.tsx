import type { SectionProps, Rdp } from "./selectClass";
import React from "react";
import { HardDrive } from "lucide-react";
import { Checkbox } from "../../../ui/forms";

const devices: { key: keyof Rdp; label: string; defaultVal: boolean }[] = [
  { key: "clipboardRedirection", label: "Clipboard", defaultVal: true },
  { key: "printerRedirection", label: "Printers", defaultVal: false },
  { key: "portRedirection", label: "Serial / COM Ports", defaultVal: false },
  { key: "smartCardRedirection", label: "Smart Cards", defaultVal: false },
  { key: "webAuthnRedirection", label: "WebAuthn / FIDO Devices", defaultVal: false },
  { key: "videoCaptureRedirection", label: "Video Capture (Cameras)", defaultVal: false },
  { key: "audioInputRedirection", label: "Audio Input (Microphone)", defaultVal: false },
  { key: "usbRedirection", label: "USB Devices", defaultVal: false },
];

const DeviceRedirectionDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <HardDrive className="w-4 h-4 text-accent" />
      Local Resource Defaults
    </h4>
    <p className="text-xs text-[var(--color-textMuted)] -mt-2">
      Default device redirection settings for new RDP connections.
    </p>

    {devices.map((d) => (
      <label key={d.key} className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={(rdp[d.key] as boolean | undefined) ?? d.defaultVal} onChange={(v: boolean) => update({ [d.key]: v } as any)} />
        <span className="sor-toggle-label">{d.label}</span>
      </label>
    ))}
  </div>
);

export default DeviceRedirectionDefaults;
