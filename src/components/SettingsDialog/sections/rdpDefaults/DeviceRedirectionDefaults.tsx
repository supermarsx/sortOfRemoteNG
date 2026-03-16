import type { SectionProps, Rdp } from "./selectClass";
import React from "react";
import { HardDrive } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const devices: { key: keyof Rdp; label: string; defaultVal: boolean; tooltip: string }[] = [
  { key: "clipboardRedirection", label: "Clipboard", defaultVal: true, tooltip: "Share the local clipboard with the remote session for copy and paste operations." },
  { key: "printerRedirection", label: "Printers", defaultVal: false, tooltip: "Redirect local printers so they appear as available printers in the remote session." },
  { key: "portRedirection", label: "Serial / COM Ports", defaultVal: false, tooltip: "Redirect local serial and COM ports to the remote session for hardware device communication." },
  { key: "smartCardRedirection", label: "Smart Cards", defaultVal: false, tooltip: "Redirect local smart card readers to the remote session for authentication purposes." },
  { key: "webAuthnRedirection", label: "WebAuthn / FIDO Devices", defaultVal: false, tooltip: "Redirect local WebAuthn and FIDO security keys to the remote session for passwordless authentication." },
  { key: "videoCaptureRedirection", label: "Video Capture (Cameras)", defaultVal: false, tooltip: "Redirect local cameras and video capture devices to the remote session." },
  { key: "audioInputRedirection", label: "Audio Input (Microphone)", defaultVal: false, tooltip: "Redirect the local microphone to the remote session for voice input." },
  { key: "usbRedirection", label: "USB Devices", defaultVal: false, tooltip: "Redirect local USB devices to the remote session for direct hardware access." },
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
        <span className="sor-toggle-label">{d.label} <InfoTooltip text={d.tooltip} /></span>
      </label>
    ))}
  </div>
);

export default DeviceRedirectionDefaults;
