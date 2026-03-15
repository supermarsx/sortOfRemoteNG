import type { WinrmSectionProps } from "./types";
import { CollapsibleSection } from "../../ui/CollapsibleSection";
import { Database } from "lucide-react";

const CSS = {
  input: "sor-form-input text-sm",
} as const;

const COMMON_NAMESPACES = [
  "root\\cimv2",
  "root\\default",
  "root\\Microsoft\\Windows\\Storage",
  "root\\StandardCimv2",
  "root\\wmi",
  "root\\Microsoft\\SqlServer",
];

const WmiSection: React.FC<WinrmSectionProps> = ({ ws, update }) => (
  <CollapsibleSection
    title="WMI Namespace"
    icon={<Database size={14} className="text-accent" />}
    defaultOpen
  >
    <div>
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Namespace
      </label>
      <input
        type="text"
        value={ws.namespace ?? "root\\cimv2"}
        onChange={(e) => update({ namespace: e.target.value })}
        className={CSS.input}
        placeholder="root\cimv2"
        list="winrm-ns-suggestions"
      />
      <datalist id="winrm-ns-suggestions">
        {COMMON_NAMESPACES.map((ns) => (
          <option key={ns} value={ns} />
        ))}
      </datalist>
      <p className="text-xs text-[var(--color-textMuted)] mt-1.5">
        The default <code className="font-mono text-[var(--color-textSecondary)]">root\cimv2</code> covers
        most Windows management classes (services, processes, event logs, etc.).
      </p>
    </div>
  </CollapsibleSection>
);

export default WmiSection;
