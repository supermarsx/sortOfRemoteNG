import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { HardDrive } from "lucide-react";
import { RDPConnectionSettings } from "../../../types/connection/connection";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Select } from "../../ui/forms";
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
      icon={<HardDrive size={14} className="text-accent" />}
    >
      {devices.map((d) => {
        const raw = rdp.deviceRedirection?.[d.key] as boolean | undefined;
        return (
        <div key={d.key}>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">{d.label}</label>
          <Select value={raw === undefined ? "" : raw ? "true" : "false"} onChange={(v: string) => updateRdp("deviceRedirection", { [d.key]: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
        </div>
        );
      })}
    </Section>
  );
};

export default DeviceRedirectionSection;
