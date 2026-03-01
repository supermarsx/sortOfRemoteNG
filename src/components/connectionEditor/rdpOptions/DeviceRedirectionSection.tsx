import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { HardDrive } from "lucide-react";
import { RDPConnectionSettings } from "../../../types/connection";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox } from "../../ui/forms";
const DeviceRedirectionSection: React.FC<SectionBaseProps> = ({
  rdp,
  updateRdp,
}) => {
  const devices: { key: keyof NonNullable<RDPConnectionSettings["deviceRedirection"]>; label: string; defaultVal: boolean }[] = [
    { key: "clipboard", label: "Clipboard", defaultVal: true },
    { key: "printers", label: "Printers", defaultVal: false },
    { key: "ports", label: "Serial / COM Ports", defaultVal: false },
    { key: "smartCards", label: "Smart Cards", defaultVal: false },
    { key: "webAuthn", label: "WebAuthn / FIDO Devices", defaultVal: false },
    { key: "videoCapture", label: "Video Capture (Cameras)", defaultVal: false },
    { key: "audioInput", label: "Audio Input (Microphone)", defaultVal: false },
    { key: "usbDevices", label: "USB Devices", defaultVal: false },
  ];

  return (
    <Section
      title="Local Resources"
      icon={<HardDrive size={14} className="text-purple-400" />}
    >
      {devices.map((d) => (
        <label key={d.key} className={CSS.label}>
          <Checkbox checked={(rdp.deviceRedirection?.[d.key] as boolean | undefined) ?? d.defaultVal} onChange={(v: boolean) => updateRdp("deviceRedirection", { [d.key]: v })} className="CSS.checkbox" />
          <span>{d.label}</span>
        </label>
      ))}
    </Section>
  );
};

export default DeviceRedirectionSection;
