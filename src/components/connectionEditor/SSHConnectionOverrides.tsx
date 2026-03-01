import { useState } from "react";
import { ChevronDown, ChevronUp, Network, RotateCcw } from "lucide-react";
import { Connection } from "../../types/connection";
import { useSSHOverrides } from "../../hooks/ssh/useSSHOverrides";
import OverrideToggle from "./sshOverrides/OverrideToggle";
import AuthMethodSelector from "./sshOverrides/AuthMethodSelector";
import CipherSelector from "./sshOverrides/CipherSelector";
import EnvironmentEditor from "./sshOverrides/EnvironmentEditor";
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
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const mgr = useSSHOverrides(formData, setFormData);

  if (formData.protocol !== "ssh" || formData.isGroup) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-[var(--color-border)]/50 hover:bg-[var(--color-border)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            SSH Connection Settings Override
          </span>
          {mgr.hasOverrides && (
            <span className="px-2 py-0.5 text-xs bg-green-600 text-[var(--color-text)] rounded-full">
              {mgr.overrideCount} custom
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-[var(--color-textSecondary)]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[var(--color-textSecondary)]" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-4 bg-[var(--color-surface)]/50">
          <p className="text-xs text-[var(--color-textSecondary)]">
            Override global SSH connection settings for this connection. These
            settings control the SSH protocol layer.
          </p>

          {mgr.hasOverrides && (
            <button
              type="button"
              onClick={mgr.clearAllOverrides}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--color-surfaceHover)] hover:bg-[var(--color-secondary)] text-[var(--color-text)] rounded transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset All to Global
            </button>
          )}

          <ConnectionSection mgr={mgr} />
          <AuthSection mgr={mgr} />
          <ProtocolSection mgr={mgr} />
          <TcpIpSection mgr={mgr} />
          <ForwardingSection mgr={mgr} />
          <FileTransferSection mgr={mgr} />
          <CiphersSection mgr={mgr} />
          <BannerSection mgr={mgr} />
          <EnvSection mgr={mgr} />
        </div>
      )}
    </div>
  );
};

export default SSHConnectionOverrides;
