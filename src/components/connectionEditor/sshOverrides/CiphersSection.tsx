import CipherSelector from "./CipherSelector";
import OverrideToggle from "./OverrideToggle";
import { SSHConnectionConfig } from "../../../types/settings";
import { CIPHER_OPTIONS, MAC_OPTIONS, KEX_OPTIONS, HOST_KEY_OPTIONS } from "../../../hooks/ssh/useSSHOverrides";

const CiphersSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;

  const groups: {
    key: keyof Pick<SSHConnectionConfig, "preferredCiphers" | "preferredMACs" | "preferredKeyExchanges" | "preferredHostKeyAlgorithms">;
    label: string;
    selectorLabel: string;
    options: string[];
  }[] = [
    { key: "preferredCiphers", label: "Preferred Ciphers", selectorLabel: "Ciphers", options: CIPHER_OPTIONS },
    { key: "preferredMACs", label: "Preferred MACs", selectorLabel: "MACs", options: MAC_OPTIONS },
    { key: "preferredKeyExchanges", label: "Key Exchanges", selectorLabel: "Key Exchange", options: KEX_OPTIONS },
    { key: "preferredHostKeyAlgorithms", label: "Host Key Algorithms", selectorLabel: "Host Key", options: HOST_KEY_OPTIONS },
  ];

  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Ciphers & Algorithms</h4>
      {groups.map(({ key, label, selectorLabel, options }) => (
        <OverrideToggle
          key={key}
          label={label}
          isOverridden={ov(key)}
          globalValue={
            (g[key] as string[]).length ? (g[key] as string[]).join(", ") : "Default"
          }
          onToggle={(on) =>
            u(key, on ? [...(g[key] as string[])] : undefined)
          }
        >
          <CipherSelector
            label={selectorLabel}
            value={v(key) as string[]}
            onChange={(vals) => u(key, vals)}
            options={options}
          />
        </OverrideToggle>
      ))}
    </div>
  );
};

export default CiphersSection;
