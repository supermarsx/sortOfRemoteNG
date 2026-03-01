import React from "react";
import {
  X,
  Plus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import {
  SavedProxyChain,
  SavedChainLayer,
} from "../types/settings";
import { useProxyChainEditor, LAYER_TYPES } from "../hooks/useProxyChainEditor";
import { Modal, ModalHeader } from "./ui/Modal";

type Mgr = ReturnType<typeof useProxyChainEditor>;

interface ProxyChainEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    chain: Omit<SavedProxyChain, "id" | "createdAt" | "updatedAt">,
  ) => void;
  editingChain: SavedProxyChain | null;
}

/* ── Sub-components ──────────────────────────────────────────────── */

const NameField: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
      Chain Name <span className="text-red-400">*</span>
    </label>
    <input
      type="text"
      value={mgr.name}
      onChange={(e) => mgr.setName(e.target.value)}
      placeholder="My Proxy Chain"
      className={`w-full px-3 py-2 bg-[var(--color-bg)] border rounded-lg text-[var(--color-text)] text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${mgr.errors.name ? "border-red-500" : "border-[var(--color-border)]"}`}
    />
    {mgr.errors.name && <p className="text-xs text-red-400 mt-1">{mgr.errors.name}</p>}
  </div>
);

const DescriptionField: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Description</label>
    <textarea
      value={mgr.description}
      onChange={(e) => mgr.setDescription(e.target.value)}
      placeholder="Optional description for this chain"
      rows={2}
      className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:ring-2 focus:ring-blue-500 resize-none"
    />
  </div>
);

const LayerCard: React.FC<{ mgr: Mgr; layer: SavedChainLayer; index: number; total: number }> = ({ mgr, layer, index, total }) => (
  <div className={`border rounded-lg bg-[var(--color-bg)] ${mgr.errors[`layer-${index}`] ? "border-red-500" : "border-[var(--color-border)]"}`}>
    <div className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <GripVertical size={14} className="text-[var(--color-textSecondary)]" />
        <span className="text-xs font-mono text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] px-2 py-0.5 rounded">Layer {index + 1}</span>
        <div className="flex-1" />
        <button onClick={() => mgr.handleMoveLayer(index, "up")} disabled={index === 0} className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] rounded disabled:opacity-30" title="Move up"><ChevronUp size={14} /></button>
        <button onClick={() => mgr.handleMoveLayer(index, "down")} disabled={index === total - 1} className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] rounded disabled:opacity-30" title="Move down"><ChevronDown size={14} /></button>
        <button onClick={() => mgr.handleRemoveLayer(index)} className="p-1 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-red-500/10 rounded" title="Remove layer"><Trash2 size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">Layer Type</label>
          <select value={layer.type} onChange={(e) => mgr.handleLayerTypeChange(index, e.target.value as SavedChainLayer["type"])} className="w-full px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm">
            {LAYER_TYPES.map((lt) => (<option key={lt.value} value={lt.value}>{lt.label}</option>))}
          </select>
        </div>
        {layer.type === "proxy" && (
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">Proxy Profile</label>
            <select value={layer.proxyProfileId || ""} onChange={(e) => mgr.handleLayerProfileChange(index, e.target.value)} className="w-full px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm">
              <option value="">Select profile...</option>
              {mgr.getProfilesForType(layer.type).map((profile) => (<option key={profile.id} value={profile.id}>{profile.name} ({profile.config.type})</option>))}
            </select>
          </div>
        )}
        {(layer.type === "openvpn" || layer.type === "wireguard") && (
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">VPN Profile</label>
            <select value={layer.vpnProfileId || ""} onChange={(e) => mgr.handleVpnProfileChange(index, e.target.value)} className="w-full px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm">
              <option value="">Select VPN profile...</option>
            </select>
            <p className="text-xs text-[var(--color-textSecondary)] mt-1">VPN profiles coming soon</p>
          </div>
        )}
        {layer.type === "ssh-tunnel" && (
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">SSH Tunnel</label>
            <p className="text-xs text-[var(--color-textSecondary)] px-2 py-1.5">Configure SSH tunnels in the Tunnels tab</p>
          </div>
        )}
      </div>
      {layer.proxyProfileId && layer.type === "proxy" && (
        <div className="mt-2 text-xs text-[var(--color-textSecondary)]">
          {(() => {
            const profile = mgr.savedProfiles.find((p) => p.id === layer.proxyProfileId);
            if (!profile) return "Profile not found";
            return <span className="font-mono">{profile.config.host}:{profile.config.port}</span>;
          })()}
        </div>
      )}
    </div>
    {mgr.errors[`layer-${index}`] && (
      <div className="px-3 pb-2 text-xs text-red-400">{mgr.errors[`layer-${index}`]}</div>
    )}
  </div>
);

const LayersSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <label className="block text-sm font-medium text-[var(--color-text)]">Chain Layers <span className="text-red-400">*</span></label>
      <button onClick={mgr.handleAddLayer} className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"><Plus size={12} />Add Layer</button>
    </div>
    {mgr.errors.layers && (
      <div className="flex items-center gap-2 p-2 mb-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400"><AlertTriangle size={14} />{mgr.errors.layers}</div>
    )}
    <div className="text-xs text-[var(--color-textSecondary)] mb-3">Chain layers are executed in order. Traffic flows through each layer sequentially.</div>
    <div className="space-y-2">
      {mgr.layers.length === 0 ? (
        <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center border border-dashed border-[var(--color-border)] rounded-lg">No layers added. Click "Add Layer" to start building your chain.</div>
      ) : (
        mgr.layers.map((layer, index) => (
          <LayerCard key={index} mgr={mgr} layer={layer} index={index} total={mgr.layers.length} />
        ))
      )}
    </div>
  </div>
);

const TagsSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Tags</label>
    <div className="flex flex-wrap gap-2 mb-2">
      {mgr.tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs">
          {tag}
          <button onClick={() => mgr.handleRemoveTag(tag)} className="hover:text-red-400"><X size={12} /></button>
        </span>
      ))}
    </div>
    <div className="flex gap-2">
      <input type="text" value={mgr.tagInput} onChange={(e) => mgr.setTagInput(e.target.value)} onKeyDown={mgr.handleTagKeyDown} placeholder="Add tag..." className="flex-1 px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm" />
      <button onClick={mgr.handleAddTag} disabled={!mgr.tagInput.trim()} className="px-3 py-1.5 text-xs rounded-md bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] disabled:opacity-50">Add</button>
    </div>
  </div>
);

/* ── Root component ──────────────────────────────────────────────── */

export const ProxyChainEditor: React.FC<ProxyChainEditorProps> = ({
  isOpen,
  onClose,
  onSave,
  editingChain,
}) => {
  const mgr = useProxyChainEditor({ isOpen, editingChain });

  const handleSave = () => {
    if (!mgr.validate()) return;
    onSave(mgr.buildChainData());
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      backdropClassName="z-[60] bg-black/60 p-4"
      panelClassName="max-w-2xl mx-4 max-h-[85vh]"
      dataTestId="proxy-chain-editor-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-h-[85vh] overflow-hidden flex flex-col border border-[var(--color-border)]">
        <ModalHeader
          onClose={onClose}
          className="px-5 py-4 border-b border-[var(--color-border)]"
          title={
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {editingChain ? "Edit Proxy Chain" : "New Proxy Chain"}
            </h2>
          }
        />
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <NameField mgr={mgr} />
          <DescriptionField mgr={mgr} />
          <LayersSection mgr={mgr} />
          <TagsSection mgr={mgr} />
        </div>
        <div className="px-5 py-4 border-t border-[var(--color-border)] flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]">{editingChain ? "Update Chain" : "Create Chain"}</button>
        </div>
      </div>
    </Modal>
  );
};
