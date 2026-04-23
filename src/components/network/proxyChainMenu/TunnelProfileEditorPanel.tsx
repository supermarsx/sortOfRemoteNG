import React, { useState, useCallback, useEffect } from "react";
import { Save, X } from "lucide-react";
import { proxyCollectionManager } from "../../../utils/connection/proxyCollectionManager";
import type { TunnelType, TunnelChainLayer } from "../../../types/connection/connection";
import {
  TUNNEL_TYPE_OPTIONS,
  getTypeLabel,
} from "./tunnelChainShared.helpers";
import { LayerConfigForm } from "./tunnelChainShared";

// Reuse createDefaultLayer from useTunnelChainEditor
function createDefaultLayer(type: TunnelType): TunnelChainLayer {
  const id = crypto.randomUUID();
  const base: TunnelChainLayer = { id, type, enabled: true };

  switch (type) {
    case "proxy":
      return { ...base, name: "Proxy", proxy: { proxyType: "socks5", host: "", port: 1080 } };
    case "ssh-tunnel":
      return { ...base, name: "SSH Tunnel", sshTunnel: { forwardType: "local", host: "", port: 22, username: "" } };
    case "ssh-jump":
      return { ...base, name: "SSH Jump Host", sshChainingMethod: "proxyjump", sshTunnel: { forwardType: "local", host: "", port: 22, username: "" } };
    case "ssh-proxycmd":
      return { ...base, name: "SSH ProxyCommand", sshTunnel: { forwardType: "local", proxyCommand: { template: "nc" } } };
    case "ssh-stdio":
      return { ...base, name: "SSH Stdio", sshTunnel: { forwardType: "local" } };
    case "openvpn":
      return { ...base, name: "OpenVPN", vpn: { protocol: "udp" } };
    case "wireguard":
      return { ...base, name: "WireGuard", vpn: {} };
    case "tailscale":
      return { ...base, name: "Tailscale", mesh: {} };
    case "zerotier":
      return { ...base, name: "ZeroTier", mesh: {} };
    case "shadowsocks":
      return { ...base, name: "Shadowsocks", proxy: { proxyType: "socks5", host: "", port: 8388 } };
    case "tor":
      return { ...base, name: "Tor", proxy: { proxyType: "socks5", host: "127.0.0.1", port: 9050 } };
    default:
      return { ...base, name: type, tunnel: {} };
  }
}

interface TunnelProfileEditorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingProfileId?: string;
}

const TunnelProfileEditorPanel: React.FC<TunnelProfileEditorPanelProps> = ({
  isOpen,
  onClose,
  onSave,
  editingProfileId,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedType, setSelectedType] = useState<TunnelType>("proxy");
  const [layerConfig, setLayerConfig] = useState<TunnelChainLayer>(() => createDefaultLayer("proxy"));

  // Load existing profile if editing
  useEffect(() => {
    if (!isOpen) return;
    if (editingProfileId) {
      const profile = proxyCollectionManager.getTunnelProfile(editingProfileId);
      if (profile) {
        setName(profile.name);
        setDescription(profile.description ?? "");
        setTags(profile.tags ?? []);
        setSelectedType(profile.type);
        setLayerConfig(profile.config);
      }
    }
  }, [isOpen, editingProfileId]);

  const handleTypeChange = useCallback((type: TunnelType) => {
    setSelectedType(type);
    setLayerConfig(createDefaultLayer(type));
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;

    if (editingProfileId) {
      await proxyCollectionManager.updateTunnelProfile(editingProfileId, {
        name: name.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        type: selectedType,
        config: layerConfig,
      });
    } else {
      await proxyCollectionManager.createTunnelProfile(
        name.trim(),
        selectedType,
        layerConfig,
        {
          description: description.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
        }
      );
    }
    onSave();
  }, [name, description, tags, selectedType, layerConfig, editingProfileId, onSave]);

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags(prev => [...prev, tag]);
    }
    setTagInput("");
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  }, []);

  if (!isOpen) return null;

  // Group types by category for the selector
  const groupedTypes = TUNNEL_TYPE_OPTIONS.reduce<Record<string, typeof TUNNEL_TYPE_OPTIONS>>((acc, opt) => {
    (acc[opt.category] ??= []).push(opt);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">
          {editingProfileId ? "Edit Tunnel Profile" : "New Tunnel Profile"}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--color-primary)] hover:bg-[var(--color-primaryHover)] text-white disabled:opacity-40 transition-colors"
          >
            <Save size={12} /> {editingProfileId ? "Update" : "Save"}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Metadata */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Office WireGuard, Bastion SSH"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] resize-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">Tags</label>
            <div className="flex items-center gap-1 flex-wrap">
              {tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                  {tag}
                  <button onClick={() => handleRemoveTag(tag)} className="hover:text-[var(--color-danger)]">
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }}
                placeholder="Add tag..."
                className="px-2 py-0.5 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] w-24"
              />
            </div>
          </div>
        </div>

        {/* Tunnel Type Selector */}
        <div className="border-t border-[var(--color-border)] pt-4">
          <label className="block text-xs text-[var(--color-textSecondary)] mb-2">Tunnel Type</label>
          <div className="space-y-2">
            {Object.entries(groupedTypes).map(([category, types]) => (
              <div key={category}>
                <div className="text-[10px] font-semibold text-[var(--color-textMuted)] uppercase tracking-wider mb-1">
                  {category}
                </div>
                <div className="flex flex-wrap gap-1">
                  {types.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleTypeChange(opt.value)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                        selectedType === opt.value
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
                      }`}
                    >
                      {opt.icon} {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Type-specific config */}
        <div className="border-t border-[var(--color-border)] pt-4">
          <h3 className="text-sm font-medium text-[var(--color-text)] mb-2">
            {getTypeLabel(selectedType)} Configuration
          </h3>
          <LayerConfigForm
            layer={layerConfig}
            onUpdate={updates => setLayerConfig(prev => ({ ...prev, ...updates }))}
          />
        </div>
      </div>
    </div>
  );
};

export default TunnelProfileEditorPanel;
