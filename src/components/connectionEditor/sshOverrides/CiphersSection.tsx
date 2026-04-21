import type { SectionProps } from "./types";
import CipherSelector from "./CipherSelector";
import OverrideToggle from "./OverrideToggle";
import { SSHConnectionConfig } from "../../../types/settings/settings";
import { CIPHER_OPTIONS, MAC_OPTIONS, KEX_OPTIONS, HOST_KEY_OPTIONS } from "../../../hooks/ssh/useSSHOverrides";
import { InfoTooltip } from "../../ui/InfoTooltip";

const CiphersSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;

  const groups: {
    key: keyof Pick<SSHConnectionConfig, "preferredCiphers" | "preferredMACs" | "preferredKeyExchanges" | "preferredHostKeyAlgorithms">;
    label: React.ReactNode;
    selectorLabel: string;
    options: string[];
  }[] = [
    { key: "preferredCiphers", label: <>Preferred Ciphers <InfoTooltip text="The symmetric encryption ciphers offered to the server, in order of preference." /></>, selectorLabel: "Ciphers", options: CIPHER_OPTIONS },
    { key: "preferredMACs", label: <>Preferred MACs <InfoTooltip text="Message Authentication Code algorithms used to verify data integrity, in order of preference." /></>, selectorLabel: "MACs", options: MAC_OPTIONS },
    { key: "preferredKeyExchanges", label: <>Key Exchanges <InfoTooltip text="Key exchange algorithms used to establish the shared session key, in order of preference." /></>, selectorLabel: "Key Exchange", options: KEX_OPTIONS },
    { key: "preferredHostKeyAlgorithms", label: <>Host Key Algorithms <InfoTooltip text="Algorithms the client accepts for verifying the server's host key, in order of preference." /></>, selectorLabel: "Host Key", options: HOST_KEY_OPTIONS },
  ];

  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Ciphers & Algorithms <InfoTooltip text="Override the global cipher and algorithm preferences for this SSH connection." /></h4>
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
