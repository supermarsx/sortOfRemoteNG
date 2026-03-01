import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Network,
  RotateCcw,
  Plus,
  X,
} from "lucide-react";
import { Connection } from "../../types/connection";
import {
  SSHConnectionConfig,
  SSHVersion,
  SSHAuthMethod,
  SSHAuthMethods,
  IPProtocol,
} from "../../types/settings";
import {
  useSSHOverrides,
  CIPHER_OPTIONS,
  MAC_OPTIONS,
  KEX_OPTIONS,
  HOST_KEY_OPTIONS,
  type SSHOverridesMgr,
} from "../../hooks/ssh/useSSHOverrides";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface SSHConnectionOverridesProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

interface SectionProps {
  mgr: SSHOverridesMgr;
}

/* ═══════════════════════════════════════════════════════════════
   OverrideToggle — shared row wrapper for each override field
   ═══════════════════════════════════════════════════════════════ */

const OverrideToggle: React.FC<{
  label: string;
  isOverridden: boolean;
  globalValue: string;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}> = ({ label, isOverridden, globalValue, onToggle, children }) => (
  <div className="flex items-start gap-3">
    <label className="flex items-center gap-2 min-w-[140px]">
      <input
        type="checkbox"
        checked={isOverridden}
        onChange={(e) => onToggle(e.target.checked)}
        className="sor-form-checkbox"
      />
      <span className="text-sm text-[var(--color-textSecondary)]">
        {label}
      </span>
    </label>
    <div className="flex-1">
      {isOverridden ? (
        children
      ) : (
        <span className="text-sm text-gray-500 italic">
          Global: {globalValue}
        </span>
      )}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   AuthMethodSelector
   ═══════════════════════════════════════════════════════════════ */

const AuthMethodSelector: React.FC<{
  value: SSHAuthMethod[];
  onChange: (methods: SSHAuthMethod[]) => void;
}> = ({ value, onChange }) => {
  const toggleMethod = (method: SSHAuthMethod) => {
    if (value.includes(method)) {
      onChange(value.filter((m) => m !== method));
    } else {
      onChange([...value, method]);
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const nv = [...value];
    [nv[index - 1], nv[index]] = [nv[index], nv[index - 1]];
    onChange(nv);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {SSHAuthMethods.map((method) => (
          <label
            key={method}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
              value.includes(method)
                ? "bg-green-600 text-[var(--color-text)]"
                : "bg-gray-600 text-[var(--color-textSecondary)] hover:bg-gray-500"
            }`}
          >
            <input
              type="checkbox"
              checked={value.includes(method)}
              onChange={() => toggleMethod(method)}
              className="sr-only"
            />
            {method}
          </label>
        ))}
      </div>
      {value.length > 0 && (
        <div className="text-xs text-[var(--color-textSecondary)]">
          Order:{" "}
          {value.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => moveUp(i)}
              className="mx-0.5 px-1 py-0.5 bg-[var(--color-border)] rounded hover:bg-[var(--color-border)]"
              title="Click to move up"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   CipherSelector
   ═══════════════════════════════════════════════════════════════ */

const CipherSelector: React.FC<{
  label: string;
  value: string[];
  onChange: (values: string[]) => void;
  options: string[];
}> = ({ value, onChange, options }) => {
  const [showAll, setShowAll] = useState(false);

  const toggleOption = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter((v) => v !== option));
    } else {
      onChange([...value, option]);
    }
  };

  const visible = showAll ? options : options.slice(0, 4);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {visible.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => toggleOption(option)}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              value.includes(option)
                ? "bg-blue-600 text-[var(--color-text)]"
                : "bg-gray-600 text-[var(--color-textSecondary)] hover:bg-gray-500"
            }`}
          >
            {option.split("@")[0]}
          </button>
        ))}
        {options.length > 4 && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="px-2 py-0.5 text-xs bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded hover:bg-[var(--color-border)]"
          >
            {showAll ? "Less..." : `+${options.length - 4} more...`}
          </button>
        )}
      </div>
      {value.length > 0 && (
        <div className="text-xs text-gray-500">
          Selected: {value.length} (in order of preference)
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   EnvironmentEditor
   ═══════════════════════════════════════════════════════════════ */

const EnvironmentEditor: React.FC<{
  value: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}> = ({ value, onChange }) => {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const addVariable = () => {
    if (newKey && newValue) {
      onChange({ ...value, [newKey]: newValue });
      setNewKey("");
      setNewValue("");
    }
  };

  const removeVariable = (key: string) => {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  };

  return (
    <div className="space-y-2">
      {Object.entries(value).map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <code className="px-2 py-1 text-xs bg-[var(--color-border)] rounded text-green-400">
            {key}
          </code>
          <span className="text-gray-500">=</span>
          <code className="px-2 py-1 text-xs bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] flex-1 truncate">
            {val}
          </code>
          <button
            type="button"
            onClick={() => removeVariable(key)}
            className="p-1 text-red-400 hover:text-red-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="KEY"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toUpperCase())}
          className="sor-form-input-xs w-24"
        />
        <span className="text-gray-500">=</span>
        <input
          type="text"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="sor-form-input-xs flex-1"
        />
        <button
          type="button"
          onClick={addVariable}
          disabled={!newKey || !newValue}
          className="p-1 text-green-400 hover:text-green-300 disabled:text-gray-600"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   1. Connection section
   ═══════════════════════════════════════════════════════════════ */

const ConnectionSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Connection</h4>

      <OverrideToggle
        label="Connect Timeout"
        isOverridden={ov("connectTimeout")}
        globalValue={`${g.connectTimeout}s`}
        onToggle={(on) => u("connectTimeout", on ? g.connectTimeout : undefined)}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={5}
            max={300}
            value={v("connectTimeout")}
            onChange={(e) => u("connectTimeout", Number(e.target.value))}
            className="sor-form-input-sm w-20"
          />
          <span className="text-sm text-[var(--color-textSecondary)]">seconds</span>
        </div>
      </OverrideToggle>

      <OverrideToggle
        label="Keep Alive Interval"
        isOverridden={ov("keepAliveInterval")}
        globalValue={g.keepAliveInterval === 0 ? "Disabled" : `${g.keepAliveInterval}s`}
        onToggle={(on) => u("keepAliveInterval", on ? g.keepAliveInterval : undefined)}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={600}
            value={v("keepAliveInterval")}
            onChange={(e) => u("keepAliveInterval", Number(e.target.value))}
            className="sor-form-input-sm w-20"
          />
          <span className="text-sm text-[var(--color-textSecondary)]">seconds (0 = disabled)</span>
        </div>
      </OverrideToggle>

      <OverrideToggle
        label="Host Key Checking"
        isOverridden={ov("strictHostKeyChecking")}
        globalValue={g.strictHostKeyChecking ? "Strict" : "Disabled"}
        onToggle={(on) =>
          u("strictHostKeyChecking", on ? !g.strictHostKeyChecking : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("strictHostKeyChecking")}
            onChange={(e) => u("strictHostKeyChecking", e.target.checked)}
            className="sor-form-checkbox"
          />
          Strict host key verification
        </label>
      </OverrideToggle>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   2. Authentication section
   ═══════════════════════════════════════════════════════════════ */

const AuthSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Authentication</h4>

      <OverrideToggle
        label="Auth Methods"
        isOverridden={ov("preferredAuthMethods")}
        globalValue={g.preferredAuthMethods.join(", ")}
        onToggle={(on) =>
          u("preferredAuthMethods", on ? [...g.preferredAuthMethods] : undefined)
        }
      >
        <AuthMethodSelector
          value={v("preferredAuthMethods")}
          onChange={(methods) => u("preferredAuthMethods", methods)}
        />
      </OverrideToggle>

      <OverrideToggle
        label="Try Public Key First"
        isOverridden={ov("tryPublicKeyFirst")}
        globalValue={g.tryPublicKeyFirst ? "Yes" : "No"}
        onToggle={(on) =>
          u("tryPublicKeyFirst", on ? !g.tryPublicKeyFirst : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("tryPublicKeyFirst")}
            onChange={(e) => u("tryPublicKeyFirst", e.target.checked)}
            className="sor-form-checkbox"
          />
          Attempt public key auth first
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="Agent Forwarding"
        isOverridden={ov("agentForwarding")}
        globalValue={g.agentForwarding ? "Enabled" : "Disabled"}
        onToggle={(on) =>
          u("agentForwarding", on ? !g.agentForwarding : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("agentForwarding")}
            onChange={(e) => u("agentForwarding", e.target.checked)}
            className="sor-form-checkbox"
          />
          Enable SSH agent forwarding
        </label>
      </OverrideToggle>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   3. Protocol section
   ═══════════════════════════════════════════════════════════════ */

const ProtocolSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Protocol</h4>

      <OverrideToggle
        label="SSH Version"
        isOverridden={ov("sshVersion")}
        globalValue={g.sshVersion}
        onToggle={(on) => u("sshVersion", on ? g.sshVersion : undefined)}
      >
        <select
          value={v("sshVersion")}
          onChange={(e) => u("sshVersion", e.target.value as SSHVersion)}
          className="sor-form-select-sm w-32"
        >
          <option value="auto">Auto</option>
          <option value="2">SSH-2 only</option>
          <option value="1">SSH-1 only</option>
        </select>
      </OverrideToggle>

      <OverrideToggle
        label="Compression"
        isOverridden={ov("enableCompression")}
        globalValue={
          g.enableCompression ? `Level ${g.compressionLevel}` : "Disabled"
        }
        onToggle={(on) =>
          u("enableCompression", on ? !g.enableCompression : undefined)
        }
      >
        <div className="flex items-center gap-3">
          <label className="sor-form-inline-check">
            <input
              type="checkbox"
              checked={v("enableCompression")}
              onChange={(e) => u("enableCompression", e.target.checked)}
              className="sor-form-checkbox"
            />
            Enable
          </label>
          {v("enableCompression") && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--color-textSecondary)]">
                Level:
              </span>
              <input
                type="number"
                min={1}
                max={9}
                value={v("compressionLevel")}
                onChange={(e) =>
                  u("compressionLevel", Number(e.target.value))
                }
                className="sor-form-input-xs w-16"
              />
            </div>
          )}
        </div>
      </OverrideToggle>

      <OverrideToggle
        label="PTY Type"
        isOverridden={ov("ptyType")}
        globalValue={g.ptyType}
        onToggle={(on) => u("ptyType", on ? g.ptyType : undefined)}
      >
        <select
          value={v("ptyType")}
          onChange={(e) => u("ptyType", e.target.value)}
          className="sor-form-select-sm w-40"
        >
          <option value="xterm-256color">xterm-256color</option>
          <option value="xterm">xterm</option>
          <option value="vt100">vt100</option>
          <option value="vt220">vt220</option>
          <option value="linux">linux</option>
          <option value="dumb">dumb</option>
        </select>
      </OverrideToggle>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   4. TCP/IP section
   ═══════════════════════════════════════════════════════════════ */

const TcpIpSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">TCP/IP</h4>

      <OverrideToggle
        label="TCP No Delay"
        isOverridden={ov("tcpNoDelay")}
        globalValue={g.tcpNoDelay ? "Enabled" : "Disabled"}
        onToggle={(on) => u("tcpNoDelay", on ? !g.tcpNoDelay : undefined)}
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("tcpNoDelay")}
            onChange={(e) => u("tcpNoDelay", e.target.checked)}
            className="sor-form-checkbox"
          />
          Disable Nagle algorithm
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="TCP Keep Alive"
        isOverridden={ov("tcpKeepAlive")}
        globalValue={g.tcpKeepAlive ? "Enabled" : "Disabled"}
        onToggle={(on) => u("tcpKeepAlive", on ? !g.tcpKeepAlive : undefined)}
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("tcpKeepAlive")}
            onChange={(e) => u("tcpKeepAlive", e.target.checked)}
            className="sor-form-checkbox"
          />
          Enable TCP keep-alive
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="IP Protocol"
        isOverridden={ov("ipProtocol")}
        globalValue={g.ipProtocol}
        onToggle={(on) => u("ipProtocol", on ? g.ipProtocol : undefined)}
      >
        <select
          value={v("ipProtocol")}
          onChange={(e) => u("ipProtocol", e.target.value as IPProtocol)}
          className="sor-form-select-sm w-32"
        >
          <option value="auto">Auto</option>
          <option value="ipv4">IPv4 only</option>
          <option value="ipv6">IPv6 only</option>
        </select>
      </OverrideToggle>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   5. Forwarding section
   ═══════════════════════════════════════════════════════════════ */

const ForwardingSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Forwarding</h4>

      <OverrideToggle
        label="TCP Forwarding"
        isOverridden={ov("enableTcpForwarding")}
        globalValue={g.enableTcpForwarding ? "Enabled" : "Disabled"}
        onToggle={(on) =>
          u("enableTcpForwarding", on ? !g.enableTcpForwarding : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("enableTcpForwarding")}
            onChange={(e) => u("enableTcpForwarding", e.target.checked)}
            className="sor-form-checkbox"
          />
          Allow TCP port forwarding
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="X11 Forwarding"
        isOverridden={ov("enableX11Forwarding")}
        globalValue={g.enableX11Forwarding ? "Enabled" : "Disabled"}
        onToggle={(on) =>
          u("enableX11Forwarding", on ? !g.enableX11Forwarding : undefined)
        }
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("enableX11Forwarding")}
            onChange={(e) => u("enableX11Forwarding", e.target.checked)}
            className="sor-form-checkbox"
          />
          Enable X11 forwarding
        </label>
      </OverrideToggle>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   6. File Transfer section
   ═══════════════════════════════════════════════════════════════ */

const FileTransferSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">File Transfer</h4>

      <OverrideToggle
        label="SFTP"
        isOverridden={ov("sftpEnabled")}
        globalValue={g.sftpEnabled ? "Enabled" : "Disabled"}
        onToggle={(on) => u("sftpEnabled", on ? !g.sftpEnabled : undefined)}
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("sftpEnabled")}
            onChange={(e) => u("sftpEnabled", e.target.checked)}
            className="sor-form-checkbox"
          />
          Enable SFTP subsystem
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="SCP"
        isOverridden={ov("scpEnabled")}
        globalValue={g.scpEnabled ? "Enabled" : "Disabled"}
        onToggle={(on) => u("scpEnabled", on ? !g.scpEnabled : undefined)}
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("scpEnabled")}
            onChange={(e) => u("scpEnabled", e.target.checked)}
            className="sor-form-checkbox"
          />
          Enable SCP transfers
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="SFTP Start Path"
        isOverridden={ov("sftpStartPath")}
        globalValue={g.sftpStartPath || "Home directory"}
        onToggle={(on) =>
          u("sftpStartPath", on ? g.sftpStartPath || "" : undefined)
        }
      >
        <input
          type="text"
          placeholder="/path/to/start"
          value={v("sftpStartPath") || ""}
          onChange={(e) => u("sftpStartPath", e.target.value || undefined)}
          className="sor-form-input-sm w-full"
        />
      </OverrideToggle>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   7. Ciphers & Algorithms section
   ═══════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════
   8. Banner & Misc section
   ═══════════════════════════════════════════════════════════════ */

const BannerSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Banner & Misc</h4>

      <OverrideToggle
        label="Show Banner"
        isOverridden={ov("showBanner")}
        globalValue={g.showBanner ? "Yes" : "No"}
        onToggle={(on) => u("showBanner", on ? !g.showBanner : undefined)}
      >
        <label className="sor-form-inline-check">
          <input
            type="checkbox"
            checked={v("showBanner")}
            onChange={(e) => u("showBanner", e.target.checked)}
            className="sor-form-checkbox"
          />
          Display server banner
        </label>
      </OverrideToggle>

      <OverrideToggle
        label="Banner Timeout"
        isOverridden={ov("bannerTimeout")}
        globalValue={`${g.bannerTimeout}s`}
        onToggle={(on) => u("bannerTimeout", on ? g.bannerTimeout : undefined)}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={60}
            value={v("bannerTimeout")}
            onChange={(e) => u("bannerTimeout", Number(e.target.value))}
            className="sor-form-input-sm w-20"
          />
          <span className="text-sm text-[var(--color-textSecondary)]">seconds</span>
        </div>
      </OverrideToggle>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   9. Environment Variables section
   ═══════════════════════════════════════════════════════════════ */

const EnvSection: React.FC<SectionProps> = ({ mgr }) => {
  const { globalConfig: g, updateOverride: u, isOverridden: ov, getValue: v } = mgr;
  return (
    <div className="space-y-3">
      <h4 className="sor-form-section-heading">Environment Variables</h4>

      <OverrideToggle
        label="Custom Environment"
        isOverridden={ov("environment")}
        globalValue={
          Object.keys(g.environment || {}).length
            ? `${Object.keys(g.environment || {}).length} vars`
            : "None"
        }
        onToggle={(on) =>
          u("environment", on ? { ...(g.environment || {}) } : undefined)
        }
      >
        <EnvironmentEditor
          value={(v("environment") as Record<string, string>) || {}}
          onChange={(env) =>
            u("environment", Object.keys(env).length > 0 ? env : undefined)
          }
        />
      </OverrideToggle>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════ */

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
          <span className="text-sm font-medium text-gray-200">
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded transition-colors"
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
