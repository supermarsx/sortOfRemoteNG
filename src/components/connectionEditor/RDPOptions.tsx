import { useRDPOptions, CSS } from "../../hooks/rdp/useRDPOptions";
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

export const RDPOptions: React.FC<RDPOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const mgr = useRDPOptions(formData, setFormData);

  if (formData.isGroup || formData.protocol !== "rdp") return null;

  return (
    <div className="space-y-3">
      {/* Domain */}
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
