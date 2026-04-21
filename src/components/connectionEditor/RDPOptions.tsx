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
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux / Other' },
] as const;

interface RDPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const RDPOptions: React.FC<RDPOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const mgr = useRDPOptions(formData, setFormData);

  if (formData.isGroup || formData.protocol !== "rdp") return null;

  return (
    <div className="space-y-3">
      {/* OS Type + Domain */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
            Target OS
          </label>
          <Select
            value={formData.osType || "windows"}
            onChange={(v) => setFormData({ ...formData, osType: v as Connection["osType"] })}
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
            onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
            className={CSS.input}
            placeholder="DOMAIN (optional)"
          />
        </div>
      </div>

      <DisplaySection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <AudioSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <InputSection
        rdp={mgr.rdp}
        updateRdp={mgr.updateRdp}
        detectingLayout={mgr.detectingLayout}
        detectKeyboardLayout={mgr.detectKeyboardLayout}
      />
      <DeviceRedirectionSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <PerformanceSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <SecuritySection
        rdp={mgr.rdp}
        updateRdp={mgr.updateRdp}
        formData={formData}
        setFormData={setFormData}
        mgr={mgr}
      />
      <GatewaySection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <HyperVSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <NegotiationSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <AdvancedSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
      <TcpSection rdp={mgr.rdp} updateRdp={mgr.updateRdp} />
    </div>
  );
};

export default RDPOptions;
