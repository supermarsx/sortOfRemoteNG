import { Network, RotateCcw } from "lucide-react";
import { Connection } from "../../types/connection/connection";
import { useSSHOverrides } from "../../hooks/ssh/useSSHOverrides";
import { OverrideSummary } from "./OverrideSummary";
import { clearLegacySshProtocolField } from "../../utils/ssh/sshProtocolConfig";
import type { SSHConnectionConfig } from "../../types/settings/settings";

const PANEL_KEYS = {
  connection: [
    "connectTimeout",
    "keepAliveInterval",
    "strictHostKeyChecking",
    "sshVersion",
    "enableCompression",
    "compressionLevel",
    "ptyType",
    "tcpNoDelay",
    "tcpKeepAlive",
    "ipProtocol",
    "showBanner",
    "bannerTimeout",
  ],
  authentication: [
    "preferredAuthMethods",
    "tryPublicKeyFirst",
    "agentForwarding",
  ],
  security: [
    "preferredCiphers",
    "preferredMACs",
    "preferredKeyExchanges",
    "preferredHostKeyAlgorithms",
  ],
  forwarding: [
    "enableTcpForwarding",
    "enableX11Forwarding",
    "x11Trusted",
    "x11DisplayOffset",
    "x11DisplayOverride",
    "agentForwarding",
    "proxyCommand",
    "proxyCommandTemplate",
    "proxyCommandHost",
    "proxyCommandPort",
    "proxyCommandUsername",
    "proxyCommandPassword",
    "proxyCommandProxyType",
    "proxyCommandTimeout",
  ],
  advanced: ["sftpEnabled", "scpEnabled", "sftpStartPath", "environment"],
} satisfies Record<string, (keyof SSHConnectionConfig)[]>;

interface SSHConnectionOverridesProps {
  formData: Partial<Connection>;
  section?:
    "connection" | "security" | "forwarding" | "advanced" | "authentication";
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}
import ConnectionSection from "./sshOverrides/ConnectionSection";
import AuthSection from "./sshOverrides/AuthSection";
import ProtocolSection from "./sshOverrides/ProtocolSection";
import TcpIpSection from "./sshOverrides/TcpIpSection";
import ForwardingSection from "./sshOverrides/ForwardingSection";
import FileTransferSection from "./sshOverrides/FileTransferSection";
import CiphersSection from "./sshOverrides/CiphersSection";
import BannerSection from "./sshOverrides/BannerSection";
import EnvSection from "./sshOverrides/EnvSection";

export const SSHConnectionOverrides: React.FC<SSHConnectionOverridesProps> = ({
  formData,
  setFormData,
  section,
}) => {
  const mgr = useSSHOverrides(formData, setFormData);
  const keys = section
    ? PANEL_KEYS[section]
    : (Object.keys(mgr.overrides) as (keyof SSHConnectionConfig)[]);
  const count = keys.filter((key) => mgr.overrides[key] !== undefined).length;
  const resetPanel = () =>
    setFormData((previous) => {
      let next = previous;
      for (const key of keys) {
        next = clearLegacySshProtocolField(next, key);
        const { [key]: _removed, ...rest } =
          next.sshConnectionConfigOverride ?? {};
        next = {
          ...next,
          sshConnectionConfigOverride: Object.keys(rest).length
            ? rest
            : undefined,
        };
      }
      return next;
    });

  if (formData.protocol !== "ssh" || formData.isGroup) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-[var(--color-border)]/50">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-success" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            {section === "authentication"
              ? "SSH authentication preferences"
              : section === "security"
                ? "SSH security & algorithms"
                : section === "forwarding"
                  ? "SSH forwarding"
                  : section === "advanced"
                    ? "SSH advanced settings"
                    : "SSH Connection Settings Override"}
          </span>
          <OverrideSummary count={count} />
        </div>
      </div>

      <div className="p-4 space-y-4 bg-[var(--color-surface)]/50">
        <p className="text-xs text-[var(--color-textSecondary)]">
          Override global SSH connection settings for this connection. These
          settings control the SSH protocol layer.
        </p>

        {count > 0 && (
          <button
            type="button"
            onClick={section ? resetPanel : mgr.clearAllOverrides}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--color-surfaceHover)] hover:bg-[var(--color-secondary)] text-[var(--color-text)] rounded transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {section ? "Reset panel to global" : "Reset All to Global"}
          </button>
        )}

        {(!section || section === "connection") && (
          <>
            <ConnectionSection mgr={mgr} />
            <ProtocolSection mgr={mgr} />
            <TcpIpSection mgr={mgr} />
            <BannerSection mgr={mgr} />
          </>
        )}
        {(!section || section === "authentication") && (
          <AuthSection mgr={mgr} />
        )}
        {(!section || section === "security") && <CiphersSection mgr={mgr} />}
        {(!section || section === "forwarding") && (
          <ForwardingSection mgr={mgr} />
        )}
        {(!section || section === "advanced") && (
          <>
            <FileTransferSection mgr={mgr} />
            <EnvSection mgr={mgr} />
          </>
        )}
      </div>
    </div>
  );
};

export default SSHConnectionOverrides;
