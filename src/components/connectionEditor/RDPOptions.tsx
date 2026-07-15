import { useRDPOptions, CSS } from "../../hooks/rdp/useRDPOptions";
import type { Connection } from "../../types/connection/connection";
import { Select } from "../ui/forms";
import Section from "./rdpOptions/Section";
import DisplaySection from "./rdpOptions/DisplaySection";
import AudioSection from "./rdpOptions/AudioSection";
import InputSection from "./rdpOptions/InputSection";
import DeviceRedirectionSection from "./rdpOptions/DeviceRedirectionSection";
import PerformanceSection from "./rdpOptions/PerformanceSection";
import SecuritySection from "./rdpOptions/SecuritySection";
import GatewaySection from "./rdpOptions/GatewaySection";
import HyperVSection from "./rdpOptions/HyperVSection";
import NegotiationSection from "./rdpOptions/NegotiationSection";
import AdvancedSection from "./rdpOptions/AdvancedSection";
import TcpSection from "./rdpOptions/TcpSection";

const OS_OPTIONS = [
  { value: "windows", label: "Windows" },
  { value: "linux", label: "Linux / Other" },
] as const;

interface RDPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  sections?: readonly RDPOptionsSection[];
}

export type RDPOptionsSection =
  | "connection"
  | "display"
  | "audio"
  | "input"
  | "devices"
  | "performance"
  | "security"
  | "gateway"
  | "hyperv"
  | "negotiation"
  | "advanced"
  | "tcp";

export const RDPOptions: React.FC<RDPOptionsProps> = ({
  formData,
  setFormData,
  sections,
}) => {
  const mgr = useRDPOptions(formData, setFormData);
  const shows = (section: RDPOptionsSection) =>
    !sections || sections.includes(section);

  if (formData.isGroup || formData.protocol !== "rdp") return null;

  return (
    <div className="space-y-3">
      {shows("connection") && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
              Target OS
            </label>
            <Select
              value={formData.osType || "windows"}
              onChange={(v) =>
                setFormData({
                  ...formData,
                  osType: v as Connection["osType"],
                })
              }
              variant="form-sm"
              className="w-full"
              options={[...OS_OPTIONS]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
              Domain
            </label>
            <input
              type="text"
              value={formData.domain || ""}
              onChange={(e) =>
                setFormData({ ...formData, domain: e.target.value })
              }
              className={CSS.input}
              placeholder="DOMAIN (optional)"
            />
          </div>
        </div>
      )}

      {shows("display") && (
        <DisplaySection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      )}
      {shows("audio") && (
        <AudioSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      )}
      {shows("input") && (
        <InputSection
          rdp={mgr.rdp}
          updateRdp={mgr.updateRdp}
          detectingLayout={mgr.detectingLayout}
          detectKeyboardLayout={mgr.detectKeyboardLayout}
        />
      )}
      {shows("devices") && (
        <DeviceRedirectionSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      )}
      {shows("performance") && (
        <PerformanceSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      )}
      {shows("security") && (
        <SecuritySection
          rdp={mgr.rdp}
          updateRdp={mgr.updateRdp}
          formData={formData}
          setFormData={setFormData}
          mgr={mgr}
        />
      )}
      {shows("gateway") && (
        <GatewaySection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      )}
      {shows("hyperv") && (
        <HyperVSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      )}
      {shows("negotiation") && (
        <NegotiationSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      )}
      {shows("advanced") && (
        <AdvancedSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      )}
      {shows("tcp") && <TcpSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />}
    </div>
  );
};

export default RDPOptions;
