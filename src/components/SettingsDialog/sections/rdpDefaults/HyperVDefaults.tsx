import { selectClass } from "./selectClass";
import type { SectionProps } from "./selectClass";
import React from "react";
import { Server } from "lucide-react";
import { Checkbox } from "../../../ui/forms";

const HyperVDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Server className="w-4 h-4 text-violet-400" />
      Hyper-V Defaults
    </h4>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.enhancedSessionMode ?? false} onChange={(v: boolean) => update({ enhancedSessionMode: v })} />
      <span className="sor-toggle-label">
        Use Enhanced Session Mode by default
      </span>
    </label>
    <p className="text-xs text-[var(--color-textMuted)] ml-7 -mt-2">
      Enhanced Session Mode enables clipboard, drive redirection and better
      audio in Hyper-V VMs.
    </p>
  </div>
);

export default HyperVDefaults;
