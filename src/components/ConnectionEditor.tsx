import React from "react";
import {
  X,
  Save,
  Check,
  Plus,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Cloud,
  Folder as FolderIcon,
  Star,
  Zap,
  Settings2,
  FileText,
  Tag,
} from "lucide-react";
import { Connection } from "../types/connection";
import { TagManager } from "./TagManager";
import SSHOptions from "./connectionEditor/SSHOptions";
import HTTPOptions from "./connectionEditor/HTTPOptions";
import CloudProviderOptions from "./connectionEditor/CloudProviderOptions";
import RDPOptions from "./connectionEditor/RDPOptions";
import TOTPOptions from "./connectionEditor/TOTPOptions";
import BackupCodesSection from "./connectionEditor/BackupCodesSection";
import SecurityQuestionsSection from "./connectionEditor/SecurityQuestionsSection";
import RecoveryInfoSection from "./connectionEditor/RecoveryInfoSection";
import { Modal } from "./ui/Modal";
import {
  useConnectionEditor,
  PROTOCOL_OPTIONS,
  CLOUD_OPTIONS,
  ICON_OPTIONS,
  PROTOCOL_COLOR_MAP,
  type ConnectionEditorMgr,
} from "../hooks/connection/useConnectionEditor";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface ConnectionEditorProps {
  connection?: Connection;
  isOpen: boolean;
  onClose: () => void;
}

/* ═══════════════════════════════════════════════════════════════
   EditorHeader
   ═══════════════════════════════════════════════════════════════ */

const EditorHeader: React.FC<{
  mgr: ConnectionEditorMgr;
  onClose: () => void;
}> = ({ mgr, onClose }) => (
  <div
    className="relative border-b border-[var(--color-border)] px-6 py-5"
    style={{
      background: mgr.isNewConnection
        ? "linear-gradient(to right, rgba(16, 185, 129, 0.15), var(--color-surface))"
        : "linear-gradient(to right, rgba(59, 130, 246, 0.15), var(--color-surface))",
    }}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div
          className={`p-3 rounded-xl ${
            mgr.isNewConnection ? "bg-green-500/20" : "bg-blue-500/20"
          }`}
        >
          {mgr.isNewConnection ? (
            <Plus size={22} className="text-green-400" />
          ) : (
            <Settings2 size={22} className="text-blue-400" />
          )}
        </div>
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text)] flex items-center gap-2">
            {mgr.isNewConnection ? "New Connection" : "Edit Connection"}
            {mgr.isNewConnection && (
              <Sparkles size={16} className="text-green-400" />
            )}
          </h2>
          <p className="text-sm text-[var(--color-textSecondary)] mt-0.5">
            {mgr.isNewConnection
              ? "Add a new server or service to your collection"
              : `Editing "${mgr.formData.name || "connection"}"`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {mgr.connection && mgr.settings.autoSaveEnabled && (
          <div className="flex items-center gap-1.5 text-xs mr-2">
            {mgr.autoSaveStatus === "pending" && (
              <span className="text-yellow-400 flex items-center gap-1 bg-yellow-400/10 px-2 py-1 rounded-full">
                <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                Saving...
              </span>
            )}
            {mgr.autoSaveStatus === "saved" && (
              <span className="text-green-400 flex items-center gap-1 bg-green-400/10 px-2 py-1 rounded-full">
                <Check size={12} />
                Saved
              </span>
            )}
          </div>
        )}
        <button
          type="submit"
          className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
            mgr.isNewConnection
              ? "bg-emerald-600 hover:bg-emerald-500 text-[var(--color-text)] shadow-lg shadow-emerald-500/20"
              : "bg-blue-600 hover:bg-blue-500 text-[var(--color-text)] shadow-lg shadow-blue-500/20"
          }`}
        >
          <Save size={16} />
          {mgr.isNewConnection ? "Create" : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   QuickToggles — Group / Favorite toggle chips
   ═══════════════════════════════════════════════════════════════ */

const QuickToggles: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div className="flex flex-wrap gap-3">
    <label
      className={`sor-option-chip ${
        mgr.formData.isGroup
          ? "sor-option-chip-active bg-purple-500/20 border-purple-500/50 text-purple-400"
          : ""
      }`}
    >
      <input
        type="checkbox"
        checked={!!mgr.formData.isGroup}
        onChange={(e) =>
          mgr.setFormData({ ...mgr.formData, isGroup: e.target.checked })
        }
        className="sr-only"
      />
      <FolderIcon size={16} />
      <span className="text-sm font-medium">Folder/Group</span>
    </label>
    {!mgr.formData.isGroup && (
      <label
        className={`sor-option-chip ${
          mgr.formData.favorite
            ? "sor-option-chip-active bg-yellow-500/20 border-yellow-500/50 text-yellow-400"
            : ""
        }`}
      >
        <input
          type="checkbox"
          checked={!!mgr.formData.favorite}
          onChange={(e) =>
            mgr.setFormData({ ...mgr.formData, favorite: e.target.checked })
          }
          className="sr-only"
        />
        <Star
          size={16}
          className={mgr.formData.favorite ? "fill-yellow-400" : ""}
        />
        <span className="text-sm font-medium">Favorite</span>
      </label>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   NameInput
   ═══════════════════════════════════════════════════════════════ */

const NameInput: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
      {mgr.formData.isGroup ? "Folder Name" : "Connection Name"}{" "}
      <span className="text-red-400">*</span>
    </label>
    <input
      type="text"
      required
      data-testid="name-input"
      value={mgr.formData.name || ""}
      onChange={(e) =>
        mgr.setFormData({ ...mgr.formData, name: e.target.value })
      }
      className="w-full px-4 py-3 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-lg placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
      placeholder={mgr.formData.isGroup ? "My Servers" : "Production Server"}
      autoFocus
    />
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   ParentSelector
   ═══════════════════════════════════════════════════════════════ */

const ParentSelector: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => {
  if (mgr.availableGroups.length === 0) return null;
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        Parent Folder
      </label>
      <select
        value={mgr.formData.parentId || ""}
        onChange={(e) =>
          mgr.setFormData({
            ...mgr.formData,
            parentId: e.target.value || undefined,
          })
        }
        className="w-full px-4 py-2.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
      >
        <option value="">Root (No parent)</option>
        {mgr.selectableGroups.map(({ group, disabled, reason }) => (
          <option
            key={group.id}
            value={group.id}
            disabled={disabled}
            title={reason}
          >
            {group.name}
            {disabled ? ` (${reason})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   ProtocolGrid — protocol selection + cloud providers
   ═══════════════════════════════════════════════════════════════ */

const ProtocolGrid: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-3">
      Protocol
    </label>
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {PROTOCOL_OPTIONS.map(({ value, label, desc, icon: Icon, color }) => {
        const isActive = mgr.formData.protocol === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => mgr.handleProtocolChange(value)}
            className={`sor-option-card ${
              isActive ? PROTOCOL_COLOR_MAP[color] || "" : ""
            }`}
          >
            <Icon size={20} />
            <span className="text-xs font-semibold">{label}</span>
            <span className="text-[10px] opacity-70">{desc}</span>
          </button>
        );
      })}
    </div>

    <div className="mt-2 flex gap-2">
      {CLOUD_OPTIONS.map(({ value, label, desc }) => {
        const isActive = mgr.formData.protocol === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => mgr.handleProtocolChange(value)}
            className={`sor-option-chip text-xs ${
              isActive
                ? "sor-option-chip-active bg-cyan-500/20 border-cyan-500/60 text-cyan-400"
                : ""
            }`}
          >
            <Cloud size={14} />
            <span className="font-medium">{label}</span>
            <span className="opacity-60">{desc}</span>
          </button>
        );
      })}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   ConnectionFields — hostname / port inputs
   ═══════════════════════════════════════════════════════════════ */

const ConnectionFields: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    <div className="sm:col-span-2">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        Hostname / IP Address <span className="text-red-400">*</span>
      </label>
      <input
        type="text"
        required
        value={mgr.formData.hostname || ""}
        onChange={(e) =>
          mgr.setFormData({ ...mgr.formData, hostname: e.target.value })
        }
        className="w-full px-4 py-2.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono"
        placeholder="192.168.1.100 or server.example.com"
      />
    </div>
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        Port
      </label>
      <input
        type="number"
        value={mgr.formData.port || 0}
        onChange={(e) =>
          mgr.setFormData({
            ...mgr.formData,
            port: parseInt(e.target.value) || 0,
          })
        }
        className="w-full px-4 py-2.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono"
        min={1}
        max={65535}
      />
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   ProtocolSections — renders all protocol-specific sub-editors
   ═══════════════════════════════════════════════════════════════ */

const ProtocolSections: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <>
    <SSHOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <HTTPOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <CloudProviderOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <RDPOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <TOTPOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <BackupCodesSection formData={mgr.formData} setFormData={mgr.setFormData} />
    <SecurityQuestionsSection formData={mgr.formData} setFormData={mgr.setFormData} />
    <RecoveryInfoSection formData={mgr.formData} setFormData={mgr.setFormData} />
  </>
);

/* ═══════════════════════════════════════════════════════════════
   IconPicker
   ═══════════════════════════════════════════════════════════════ */

const IconPicker: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div>
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
      Custom Icon
    </label>
    <div className="flex flex-wrap gap-2">
      {ICON_OPTIONS.map(({ value, label, icon: Icon }) => {
        const isActive = (mgr.formData.icon || "") === value;
        return (
          <button
            key={value || "default"}
            type="button"
            onClick={() =>
              mgr.setFormData({ ...mgr.formData, icon: value || undefined })
            }
            className={`p-2.5 rounded-lg border transition-all ${
              isActive
                ? "border-blue-500/60 bg-blue-500/20 text-blue-400"
                : "border-[var(--color-border)] bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:border-[var(--color-border)]"
            }`}
            title={label}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   TagsSection
   ═══════════════════════════════════════════════════════════════ */

const TagsSection: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div>
    <div className="flex items-center gap-2 mb-2">
      <Tag size={14} className="text-[var(--color-textSecondary)]" />
      <label className="text-sm font-medium text-[var(--color-textSecondary)]">
        Tags
      </label>
    </div>
    <TagManager
      tags={mgr.formData.tags || []}
      availableTags={mgr.allTags}
      onChange={mgr.handleTagsChange}
      onCreateTag={() => {}}
    />
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   DescriptionSection — collapsible
   ═══════════════════════════════════════════════════════════════ */

const DescriptionSection: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => (
  <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
    <button
      type="button"
      onClick={() => mgr.toggleSection("description")}
      className="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-border)] hover:bg-[var(--color-border)] transition-colors"
    >
      <div className="flex items-center gap-2 text-[var(--color-textSecondary)]">
        <FileText size={16} />
        <span className="text-sm font-medium">Description & Notes</span>
        {mgr.formData.description && (
          <span className="text-xs text-gray-500 ml-2">
            ({mgr.formData.description.length} chars)
          </span>
        )}
      </div>
      {mgr.expandedSections.description ? (
        <ChevronUp size={16} className="text-[var(--color-textSecondary)]" />
      ) : (
        <ChevronDown size={16} className="text-[var(--color-textSecondary)]" />
      )}
    </button>
    {mgr.expandedSections.description && (
      <div className="p-4 border-t border-[var(--color-border)]">
        <textarea
          value={mgr.formData.description || ""}
          onChange={(e) =>
            mgr.setFormData({ ...mgr.formData, description: e.target.value })
          }
          rows={4}
          className="w-full px-4 py-3 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none"
          placeholder="Add notes about this connection..."
        />
      </div>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   EditorFooter
   ═══════════════════════════════════════════════════════════════ */

const EditorFooter: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div className="border-t border-[var(--color-border)] px-6 py-3 bg-[var(--color-surface)]">
    <div className="flex items-center justify-between text-xs text-[var(--color-textSecondary)]">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <Zap size={12} />
          Press{" "}
          <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-[var(--color-textSecondary)]">
            Enter
          </kbd>{" "}
          to save
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-[var(--color-textSecondary)]">
            Esc
          </kbd>{" "}
          to cancel
        </span>
      </div>
      {mgr.connection && mgr.settings.autoSaveEnabled && (
        <span className="text-gray-500">Auto-save enabled</span>
      )}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════ */

export const ConnectionEditor: React.FC<ConnectionEditorProps> = ({
  connection,
  isOpen,
  onClose,
}) => {
  const mgr = useConnectionEditor(connection, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      dataTestId="connection-editor-modal"
      backdropClassName="bg-black/60 backdrop-blur-sm"
      panelClassName="relative max-w-2xl rounded-2xl border border-[var(--color-border)] shadow-2xl overflow-hidden"
      contentClassName="relative bg-[var(--color-surface)] backdrop-blur-xl"
    >
      {/* Subtle glow effect */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden z-0">
        <div
          className={`w-[500px] h-[400px] rounded-full blur-[100px] animate-pulse ${
            mgr.isNewConnection ? "bg-emerald-500/15" : "bg-blue-500/15"
          }`}
        />
      </div>

      <form
        onSubmit={mgr.handleSubmit}
        className="relative z-10 flex flex-col flex-1 min-h-0"
      >
        <EditorHeader mgr={mgr} onClose={onClose} />

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <QuickToggles mgr={mgr} />
          <NameInput mgr={mgr} />
          <ParentSelector mgr={mgr} />

          {!mgr.formData.isGroup && (
            <>
              <ProtocolGrid mgr={mgr} />
              <ConnectionFields mgr={mgr} />
              <ProtocolSections mgr={mgr} />
            </>
          )}

          <IconPicker mgr={mgr} />
          <TagsSection mgr={mgr} />
          <DescriptionSection mgr={mgr} />
        </div>

        <EditorFooter mgr={mgr} />
      </form>
    </Modal>
  );
};
