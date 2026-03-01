import React from "react";
import { PasswordInput } from "../ui/forms/PasswordInput";
import {
  Database,
  Plus,
  Lock,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Download,
  Upload,
  X,
  Layers,
  Network,
  Link2,
  Copy,
  Search,
} from "lucide-react";
import { ImportExport } from "../ImportExport";
import { ProxyProfileEditor } from "../network/ProxyProfileEditor";
import { ProxyChainEditor } from "../network/ProxyChainEditor";
import { Modal } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import { useCollectionSelector } from "../../hooks/connection/useCollectionSelector";
import { Checkbox } from '../ui/forms';
import CollectionsTab from "./collectionSelector/CollectionsTab";
import ConnectionsTab from "./collectionSelector/ConnectionsTab";
import ProxiesTab from "./collectionSelector/ProxiesTab";

interface CollectionSelectorProps {
  isOpen: boolean;
  onCollectionSelect: (collectionId: string, password?: string) => void;
  onClose: () => void;
}

export const CollectionSelector: React.FC<CollectionSelectorProps> = ({
  isOpen,
  onCollectionSelect,
  onClose,
}) => {
  const mgr = useCollectionSelector(isOpen, onCollectionSelect);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-5xl h-[90vh] rounded-lg overflow-hidden"
      contentClassName="bg-[var(--color-surface)]"
    >
      <div className="flex flex-1 min-h-0 flex-col">
        {/* Header */}
        <DialogHeader
          icon={Database}
          iconColor="text-blue-400"
          iconBg="bg-blue-500/20"
          title="Collection Center"
          subtitle="Manage your connection collections"
          onClose={onClose}
          sticky
          actions={
            <>
              {mgr.activeTab === "collections" && (
                <>
                  <button
                    onClick={() => mgr.setShowImportForm(true)}
                    className="sor-btn-secondary-sm"
                  >
                    <Upload size={14} />
                    <span>Import</span>
                  </button>
                  <button
                    onClick={() => mgr.setShowCreateForm(true)}
                    className="sor-btn-primary-sm"
                  >
                    <Plus size={14} />
                    <span>New</span>
                  </button>
                </>
              )}
              {mgr.activeTab === "proxies" && (
                <>
                  <button
                    onClick={mgr.handleImportProxies}
                    className="sor-btn-secondary-sm"
                  >
                    <Upload size={14} />
                    <span>Import</span>
                  </button>
                  <button
                    onClick={mgr.handleExportProxies}
                    className="sor-btn-secondary-sm"
                  >
                    <Download size={14} />
                    <span>Export</span>
                  </button>
                </>
              )}
            </>
          }
        />

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-60 bg-[var(--color-background)] border-r border-[var(--color-border)] p-4 space-y-2">
            <button
              onClick={() => mgr.setActiveTab("collections")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "collections"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Database size={16} />
              <span>Collections</span>
            </button>
            <button
              onClick={() => mgr.setActiveTab("connections")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "connections"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Layers size={16} />
              <span>Connections</span>
            </button>
            <button
              onClick={() => mgr.setActiveTab("proxies")}
              className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left transition-colors ${
                mgr.activeTab === "proxies"
                  ? "bg-blue-600 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              <Network size={16} />
              <span>Proxy/VPN Profiles</span>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-6">
              {mgr.activeTab === "collections" && (
                <CollectionsTab mgr={mgr} />
              )}
              {mgr.activeTab === "connections" && <ConnectionsTab />}
              {mgr.activeTab === "proxies" && <ProxiesTab mgr={mgr} />}
            </div>
          </div>
        </div>
      </div>

      {/* Sub-dialogs */}
      <ProxyProfileEditor
        isOpen={mgr.showProfileEditor}
        onClose={mgr.closeProfileEditor}
        onSave={mgr.handleSaveProfile}
        editingProfile={mgr.editingProfile}
      />
      <ProxyChainEditor
        isOpen={mgr.showChainEditor}
        onClose={mgr.closeChainEditor}
        onSave={mgr.handleSaveChain}
        editingChain={mgr.editingChain}
      />
    </Modal>
  );
};

// ─── Tab sub-components ──────────────────────────────────────────

type Mgr = ReturnType<typeof useCollectionSelector>;
