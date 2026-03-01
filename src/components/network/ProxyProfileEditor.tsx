import React from "react";
import { PasswordInput } from "../ui/forms/PasswordInput";
import {
  X,
  Save,
  Server,
  Key,
  Globe,
  Shield,
  Tag,
  Info,
  Wifi,
} from "lucide-react";
import { SavedProxyProfile, ProxyConfig } from "../../types/settings";
import { Modal, ModalHeader } from "../ui/overlays/Modal";
import { useProxyProfileEditor } from "../../hooks/network/useProxyProfileEditor";
import { Checkbox, NumberInput, Select } from '../ui/forms';

type Mgr = ReturnType<typeof useProxyProfileEditor>;

const PROXY_TYPES: Array<{
  value: ProxyConfig["type"];
  label: string;
  description: string;
}> = [
  { value: "http", label: "HTTP", description: "Standard HTTP proxy" },
  { value: "https", label: "HTTPS", description: "HTTP proxy with SSL/TLS" },
  { value: "socks4", label: "SOCKS4", description: "SOCKS version 4 proxy" },
  {
    value: "socks5",
    label: "SOCKS5",
    description: "SOCKS version 5 with authentication",
  },
  {
    value: "ssh",
    label: "SSH Tunnel",
    description: "SSH dynamic port forwarding",
  },
  {
    value: "shadowsocks",
    label: "Shadowsocks",
    description: "Encrypted proxy protocol",
  },
  {
    value: "http-connect",
    label: "HTTP CONNECT",
    description: "HTTP tunnel via CONNECT method",
  },
  {
    value: "websocket",
    label: "WebSocket",
    description: "WebSocket-based tunnel",
  },
  { value: "quic", label: "QUIC", description: "QUIC protocol tunnel" },
  {
    value: "dns-tunnel",
    label: "DNS Tunnel",
    description: "Traffic over DNS queries",
  },
  {
    value: "icmp-tunnel",
    label: "ICMP Tunnel",
    description: "Traffic over ICMP packets",
  },
  {
    value: "tcp-over-dns",
    label: "TCP over DNS",
    description: "TCP traffic encapsulated in DNS",
  },
];

/* ── sub-components ── */

const BasicInfoSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-1">
        Profile Name *
      </label>
      <input
        type="text"
        value={mgr.name}
        onChange={(e) => mgr.setName(e.target.value)}
        placeholder="My SOCKS5 Proxy"
        className="sor-form-input"
      />
    </div>
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-1">
        Description
      </label>
      <textarea
        value={mgr.description}
        onChange={(e) => mgr.setDescription(e.target.value)}
        placeholder="Optional description..."
        rows={2}
        className="sor-form-textarea resize-none"
      />
    </div>
  </div>
);

const ProxyTypeSelector: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const selectedProxyType = PROXY_TYPES.find((t) => t.value === mgr.config.type);
  return (
    <div>
      <label className="sor-form-label">
        <Server className="w-4 h-4 inline mr-1" />
        Proxy Type
      </label>
      <div className="grid grid-cols-3 gap-2">
        {PROXY_TYPES.map((type) => (
          <button
            key={type.value}
            onClick={() => mgr.updateConfig({ type: type.value })}
            className={`p-2 rounded-lg border text-left transition-all ${
              mgr.config.type === type.value
                ? "border-blue-500 bg-blue-500/20 text-blue-400"
                : "border-[var(--color-border)] bg-[var(--color-surface)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
            }`}
          >
            <div className="text-xs font-medium">{type.label}</div>
          </button>
        ))}
      </div>
      {selectedProxyType && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-2 flex items-center gap-1">
          <Info className="w-3 h-3" />
          {selectedProxyType.description}
        </p>
      )}
    </div>
  );
};

const ConnectionDetailsSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4 p-4 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)]">
    <div className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
      <Globe className="w-4 h-4" />
      Connection Details
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="sor-form-label-xs">Host *</label>
        <input
          type="text"
          value={mgr.config.host}
          onChange={(e) => mgr.updateConfig({ host: e.target.value })}
          placeholder="proxy.example.com"
          className="sor-form-input"
        />
      </div>
      <div>
        <label className="sor-form-label-xs">Port *</label>
        <NumberInput value={mgr.config.port} onChange={(v: number) => mgr.updateConfig({ port: v })} variant="form" placeholder="1080" />
      </div>
    </div>
    {["socks5", "http", "https", "http-connect", "shadowsocks"].includes(
      mgr.config.type,
    ) && (
      <>
        <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)] pt-2 border-t border-[var(--color-border)]">
          <Key className="w-3 h-3" />
          Authentication (Optional)
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="sor-form-label-xs">Username</label>
            <input
              type="text"
              value={mgr.config.username || ""}
              onChange={(e) =>
                mgr.updateConfig({ username: e.target.value || undefined })
              }
              placeholder="username"
              className="sor-form-input"
            />
          </div>
          <div>
            <label className="sor-form-label-xs">Password</label>
            <PasswordInput
              value={mgr.config.password || ""}
              onChange={(e) =>
                mgr.updateConfig({ password: e.target.value || undefined })
              }
              placeholder="••••••••"
              className="sor-form-input"
            />
          </div>
        </div>
      </>
    )}
    {mgr.config.type === "shadowsocks" && (
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="sor-form-label-xs">Encryption Method</label>
          <Select value={mgr.config.shadowsocksMethod || "aes-256-gcm"} onChange={(v: string) => mgr.updateConfig({ shadowsocksMethod: v })} options={[{ value: "aes-256-gcm", label: "AES-256-GCM" }, { value: "aes-128-gcm", label: "AES-128-GCM" }, { value: "chacha20-ietf-poly1305", label: "ChaCha20-IETF-Poly1305" }, { value: "xchacha20-ietf-poly1305", label: "XChaCha20-IETF-Poly1305" }, { value: "aes-256-cfb", label: "AES-256-CFB" }, { value: "aes-128-cfb", label: "AES-128-CFB" }]} variant="form" />
        </div>
        <div>
          <label className="sor-form-label-xs">Plugin (Optional)</label>
          <input
            type="text"
            value={mgr.config.shadowsocksPlugin || ""}
            onChange={(e) =>
              mgr.updateConfig({
                shadowsocksPlugin: e.target.value || undefined,
              })
            }
            placeholder="v2ray-plugin, simple-obfs"
            className="sor-form-input"
          />
        </div>
      </div>
    )}
    {mgr.config.type === "ssh" && (
      <div className="space-y-4">
        <div>
          <label className="sor-form-label-xs">SSH Key File (Optional)</label>
          <input
            type="text"
            value={mgr.config.sshKeyFile || ""}
            onChange={(e) =>
              mgr.updateConfig({ sshKeyFile: e.target.value || undefined })
            }
            placeholder="/path/to/private/key"
            className="sor-form-input"
          />
        </div>
        <div>
          <label className="sor-form-label-xs">
            Key Passphrase (if encrypted)
          </label>
          <PasswordInput
            value={mgr.config.sshKeyPassphrase || ""}
            onChange={(e) =>
              mgr.updateConfig({
                sshKeyPassphrase: e.target.value || undefined,
              })
            }
            placeholder="••••••••"
            className="sor-form-input"
          />
        </div>
      </div>
    )}
    {mgr.config.type === "websocket" && (
      <div>
        <label className="sor-form-label-xs">WebSocket Path</label>
        <input
          type="text"
          value={mgr.config.websocketPath || ""}
          onChange={(e) =>
            mgr.updateConfig({ websocketPath: e.target.value || undefined })
          }
          placeholder="/ws"
          className="sor-form-input"
        />
      </div>
    )}
  </div>
);

const TagsSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-2">
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-1">
      <Tag className="w-4 h-4" />
      Tags
    </label>
    <div className="flex flex-wrap gap-2 mb-2">
      {mgr.tags.map((tag) => (
        <span
          key={tag}
          className="px-2 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs flex items-center gap-1"
        >
          {tag}
          <button
            onClick={() => mgr.handleRemoveTag(tag)}
            className="hover:text-[var(--color-text)]"
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
    <div className="flex gap-2">
      <input
        type="text"
        value={mgr.tagInput}
        onChange={(e) => mgr.setTagInput(e.target.value)}
        onKeyDown={mgr.handleKeyDown}
        placeholder="Add tag..."
        className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
      />
      <button
        onClick={mgr.handleAddTag}
        disabled={!mgr.tagInput.trim()}
        className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed text-[var(--color-text)] text-sm"
      >
        Add
      </button>
    </div>
  </div>
);

const DefaultProfileToggle: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const selectedProxyType = PROXY_TYPES.find((t) => t.value === mgr.config.type);
  return (
    <label className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
      <Checkbox checked={mgr.isDefault} onChange={(v: boolean) => mgr.setIsDefault(v)} className="sor-form-checkbox w-4 h-4" />
      <div>
        <div className="text-sm font-medium text-[var(--color-text)] flex items-center gap-1">
          <Shield className="w-4 h-4 text-yellow-400" />
          Set as Default for {selectedProxyType?.label || mgr.config.type}
        </div>
        <div className="text-xs text-[var(--color-textSecondary)]">
          This profile will be pre-selected when creating new connections using
          this proxy type
        </div>
      </div>
    </label>
  );
};

/* ── main component ── */

interface ProxyProfileEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    profile: Omit<SavedProxyProfile, "id" | "createdAt" | "updatedAt">,
  ) => void;
  editingProfile?: SavedProxyProfile | null;
}

export const ProxyProfileEditor: React.FC<ProxyProfileEditorProps> = ({
  isOpen,
  onClose,
  onSave,
  editingProfile,
}) => {
  const mgr = useProxyProfileEditor(isOpen, editingProfile, onSave);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      backdropClassName="z-[60] bg-black/60 p-4"
      panelClassName="max-w-xl mx-4 max-h-[85vh]"
      dataTestId="proxy-profile-editor-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-h-[85vh] overflow-hidden flex flex-col border border-[var(--color-border)]">
        <ModalHeader
          onClose={onClose}
          className="px-5 py-4 border-b border-[var(--color-border)]"
          title={
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Wifi size={18} className="text-purple-400" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {mgr.editingProfile ? "Edit Proxy Profile" : "New Proxy Profile"}
              </h2>
            </div>
          }
        />

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <BasicInfoSection mgr={mgr} />
          <ProxyTypeSelector mgr={mgr} />
          <ConnectionDetailsSection mgr={mgr} />
          <TagsSection mgr={mgr} />
          <DefaultProfileToggle mgr={mgr} />
        </div>

        <div className="px-5 py-4 border-t border-[var(--color-border)] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={mgr.handleSave}
            disabled={!mgr.canSave}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed text-[var(--color-text)] text-sm flex items-center gap-2 transition-colors"
          >
            <Save size={14} />
            {mgr.editingProfile ? "Update Profile" : "Create Profile"}
          </button>
        </div>
      </div>
    </Modal>
  );
};
