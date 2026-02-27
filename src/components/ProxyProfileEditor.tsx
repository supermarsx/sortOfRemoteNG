import React, { useState, useEffect } from "react";
import { PasswordInput } from "./ui/PasswordInput";
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
import { SavedProxyProfile, ProxyConfig } from "../types/settings";
import { Modal, ModalHeader } from "./ui/Modal";

interface ProxyProfileEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    profile: Omit<SavedProxyProfile, "id" | "createdAt" | "updatedAt">,
  ) => void;
  editingProfile?: SavedProxyProfile | null;
}

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

export const ProxyProfileEditor: React.FC<ProxyProfileEditorProps> = ({
  isOpen,
  onClose,
  onSave,
  editingProfile,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [config, setConfig] = useState<ProxyConfig>({
    type: "socks5",
    host: "",
    port: 1080,
    enabled: true,
  });

  useEffect(() => {
    if (editingProfile) {
      setName(editingProfile.name);
      setDescription(editingProfile.description || "");
      setTags(editingProfile.tags || []);
      setIsDefault(editingProfile.isDefault || false);
      setConfig(editingProfile.config);
    } else {
      resetForm();
    }
  }, [editingProfile, isOpen]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setTags([]);
    setTagInput("");
    setIsDefault(false);
    setConfig({
      type: "socks5",
      host: "",
      port: 1080,
      enabled: true,
    });
  };

  const handleSave = () => {
    if (!name.trim() || !config.host.trim()) return;

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      isDefault,
      config,
    });

    resetForm();
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const updateConfig = (updates: Partial<ProxyConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput) {
      e.preventDefault();
      handleAddTag();
    }
  };

  if (!isOpen) return null;

  const selectedProxyType = PROXY_TYPES.find((t) => t.value === config.type);

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
                {editingProfile ? "Edit Proxy Profile" : "New Proxy Profile"}
              </h2>
            </div>
          }
        />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-1">
                Profile Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My SOCKS5 Proxy"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm resize-none"
              />
            </div>
          </div>

          {/* Proxy Type */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
              <Server className="w-4 h-4 inline mr-1" />
              Proxy Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {PROXY_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => updateConfig({ type: type.value })}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    config.type === type.value
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

          {/* Connection Details */}
          <div className="space-y-4 p-4 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)]">
            <div className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Connection Details
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Host *
                </label>
                <input
                  type="text"
                  value={config.host}
                  onChange={(e) => updateConfig({ host: e.target.value })}
                  placeholder="proxy.example.com"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Port *
                </label>
                <input
                  type="number"
                  value={config.port}
                  onChange={(e) =>
                    updateConfig({ port: parseInt(e.target.value) || 1080 })
                  }
                  placeholder="1080"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
            </div>

            {/* Authentication (for types that support it) */}
            {[
              "socks5",
              "http",
              "https",
              "http-connect",
              "shadowsocks",
            ].includes(config.type) && (
              <>
                <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)] pt-2 border-t border-[var(--color-border)]">
                  <Key className="w-3 h-3" />
                  Authentication (Optional)
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      value={config.username || ""}
                      onChange={(e) =>
                        updateConfig({ username: e.target.value || undefined })
                      }
                      placeholder="username"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                      Password
                    </label>
                    <PasswordInput
                      value={config.password || ""}
                      onChange={(e) =>
                        updateConfig({ password: e.target.value || undefined })
                      }
                      placeholder="••••••••"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Shadowsocks specific */}
            {config.type === "shadowsocks" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                    Encryption Method
                  </label>
                  <select
                    value={config.shadowsocksMethod || "aes-256-gcm"}
                    onChange={(e) =>
                      updateConfig({ shadowsocksMethod: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                  >
                    <option value="aes-256-gcm">AES-256-GCM</option>
                    <option value="aes-128-gcm">AES-128-GCM</option>
                    <option value="chacha20-ietf-poly1305">
                      ChaCha20-IETF-Poly1305
                    </option>
                    <option value="xchacha20-ietf-poly1305">
                      XChaCha20-IETF-Poly1305
                    </option>
                    <option value="aes-256-cfb">AES-256-CFB</option>
                    <option value="aes-128-cfb">AES-128-CFB</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                    Plugin (Optional)
                  </label>
                  <input
                    type="text"
                    value={config.shadowsocksPlugin || ""}
                    onChange={(e) =>
                      updateConfig({
                        shadowsocksPlugin: e.target.value || undefined,
                      })
                    }
                    placeholder="v2ray-plugin, simple-obfs"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                  />
                </div>
              </div>
            )}

            {/* SSH specific */}
            {config.type === "ssh" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                    SSH Key File (Optional)
                  </label>
                  <input
                    type="text"
                    value={config.sshKeyFile || ""}
                    onChange={(e) =>
                      updateConfig({ sshKeyFile: e.target.value || undefined })
                    }
                    placeholder="/path/to/private/key"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                    Key Passphrase (if encrypted)
                  </label>
                  <PasswordInput
                    value={config.sshKeyPassphrase || ""}
                    onChange={(e) =>
                      updateConfig({
                        sshKeyPassphrase: e.target.value || undefined,
                      })
                    }
                    placeholder="••••••••"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                  />
                </div>
              </div>
            )}

            {/* WebSocket specific */}
            {config.type === "websocket" && (
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  WebSocket Path
                </label>
                <input
                  type="text"
                  value={config.websocketPath || ""}
                  onChange={(e) =>
                    updateConfig({ websocketPath: e.target.value || undefined })
                  }
                  placeholder="/ws"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-1">
              <Tag className="w-4 h-4" />
              Tags
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs flex items-center gap-1"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
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
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Add tag..."
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
              <button
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] text-sm"
              >
                Add
              </button>
            </div>
          </div>

          {/* Default Profile */}
          <label className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            <div>
              <div className="text-sm font-medium text-[var(--color-text)] flex items-center gap-1">
                <Shield className="w-4 h-4 text-yellow-400" />
                Set as Default for {selectedProxyType?.label || config.type}
              </div>
              <div className="text-xs text-[var(--color-textSecondary)]">
                This profile will be pre-selected when creating new connections
                using this proxy type
              </div>
            </div>
          </label>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--color-border)] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !config.host.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] text-sm flex items-center gap-2 transition-colors"
          >
            <Save size={14} />
            {editingProfile ? "Update Profile" : "Create Profile"}
          </button>
        </div>
      </div>
    </Modal>
  );
};
