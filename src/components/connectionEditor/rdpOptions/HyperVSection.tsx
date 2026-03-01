import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Server } from "lucide-react";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox } from "../../ui/forms";
const HyperVSection: React.FC<SectionBaseProps> = ({ rdp, updateRdp }) => (
  <Section
    title="Hyper-V / Enhanced Session"
    icon={<Server size={14} className="text-violet-400" />}
  >
    <label className={CSS.label}>
      <Checkbox checked={rdp.hyperv?.useVmId ?? false} onChange={(v: boolean) => updateRdp("hyperv", { useVmId: v })} className="CSS.checkbox" />
      <span className="font-medium">Connect via VM ID</span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-5 -mt-1">
      Connect to a Hyper-V VM using its GUID instead of hostname.
    </p>

    {(rdp.hyperv?.useVmId ?? false) && (
      <div className="space-y-3 mt-2">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            VM ID (GUID)
          </label>
          <input
            type="text"
            value={rdp.hyperv?.vmId ?? ""}
            onChange={(e) => updateRdp("hyperv", { vmId: e.target.value })}
            className={CSS.input}
            placeholder="12345678-abcd-1234-ef00-123456789abc"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Hyper-V Host Server
          </label>
          <input
            type="text"
            value={rdp.hyperv?.hostServer ?? ""}
            onChange={(e) =>
              updateRdp("hyperv", { hostServer: e.target.value })
            }
            className={CSS.input}
            placeholder="hyperv-host.example.com"
          />
          <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
            The Hyper-V server hosting the VM.
          </p>
        </div>
      </div>
    )}

    <div className="pt-2 mt-2 border-t border-[var(--color-border)]/60">
      <label className={CSS.label}>
        <Checkbox checked={rdp.hyperv?.enhancedSessionMode ?? false} onChange={(v: boolean) => updateRdp("hyperv", { enhancedSessionMode: v })} className="CSS.checkbox" />
        <span>Enhanced Session Mode</span>
      </label>
      <p className="text-xs text-[var(--color-textMuted)] ml-5 -mt-1">
        Uses VMBus channel for better performance, clipboard, drive
        redirection and audio in Hyper-V VMs.
      </p>
    </div>
  </Section>
);

export default HyperVSection;
