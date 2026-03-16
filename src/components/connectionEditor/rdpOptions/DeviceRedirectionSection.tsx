import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { HardDrive, Info } from "lucide-react";
import { RDPConnectionSettings } from "../../../types/connection/connection";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Select } from "../../ui/forms";
const DeviceRedirectionSection: React.FC<SectionBaseProps> = ({
  rdp,
  updateRdp,
}) => {
  const devices: { key: keyof NonNullable<RDPConnectionSettings["deviceRedirection"]>; label: string; defaultVal: boolean; tooltip: string }[] = [
    { key: "clipboard", label: "Clipboard", defaultVal: true, tooltip: "Share clipboard between local and remote desktops for copy/paste." },
    { key: "printers", label: "Printers", defaultVal: false, tooltip: "Redirect local printers so they appear in the remote session." },
    { key: "ports", label: "Serial / COM Ports", defaultVal: false, tooltip: "Redirect serial/COM ports to the remote session for hardware devices." },
    { key: "smartCards", label: "Smart Cards", defaultVal: false, tooltip: "Redirect smart card readers for remote authentication or signing." },
    { key: "webAuthn", label: "WebAuthn / FIDO Devices", defaultVal: false, tooltip: "Redirect FIDO/WebAuthn security keys for passwordless authentication in the remote session." },
    { key: "videoCapture", label: "Video Capture (Cameras)", defaultVal: false, tooltip: "Redirect local webcams to the remote session for video calls." },
    { key: "audioInput", label: "Audio Input (Microphone)", defaultVal: false, tooltip: "Redirect microphone input to the remote session for voice calls and recording." },
    { key: "usbDevices", label: "USB Devices", defaultVal: false, tooltip: "Redirect USB devices to the remote session. May require additional drivers on the server." },
  ];

  return (
    <Section
      title="Local Resources"
      icon={<HardDrive size={14} className="text-accent" />}
    >
      {devices.map((d) => {
        const raw = rdp.deviceRedirection?.[d.key] as boolean | undefined;
        return (
        <div key={d.key}>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">{d.label} <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip={d.tooltip} /></label>
          <Select value={raw === undefined ? "" : raw ? "true" : "false"} onChange={(v: string) => updateRdp("deviceRedirection", { [d.key]: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
        </div>
        );
      })}
    </Section>
  );
};

export default DeviceRedirectionSection;
