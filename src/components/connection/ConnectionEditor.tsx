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
import { Connection } from "../../types/connection/connection";
import { TagManager } from "./TagManager";
import SSHOptions from "../connectionEditor/SSHOptions";
import HTTPOptions from "../connectionEditor/HTTPOptions";
import CloudProviderOptions from "../connectionEditor/CloudProviderOptions";
import RDPOptions from "../connectionEditor/RDPOptions";
import TOTPOptions from "../connectionEditor/TOTPOptions";
import BackupCodesSection from "../connectionEditor/BackupCodesSection";
import SecurityQuestionsSection from "../connectionEditor/SecurityQuestionsSection";
import RecoveryInfoSection from "../connectionEditor/RecoveryInfoSection";
import { Modal } from "../ui/overlays/Modal";
import {
  useConnectionEditor,
  PROTOCOL_OPTIONS,
  CLOUD_OPTIONS,
  ICON_OPTIONS,
  PROTOCOL_COLOR_MAP,
  type ConnectionEditorMgr,
} from "../../hooks/connection/useConnectionEditor";
import { Checkbox, NumberInput, Select, Textarea} from '../ui/forms';

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
        ? "linear-gradient(to right, rgb(var(--color-success-rgb) / 0.15), var(--color-surface))"
        : "linear-gradient(to right, rgb(var(--color-primary-rgb) / 0.15), var(--color-surface))",
    }}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div
          className={`p-3 rounded-xl ${
            mgr.isNewConnection ? "bg-success/20" : "bg-primary/20"
          }`}
        >
          {mgr.isNewConnection ? (
            <Plus size={22} className="text-success" />
          ) : (
            <Settings2 size={22} className="text-primary" />
          )}
        </div>
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text)] flex items-center gap-2">
            {mgr.isNewConnection ? "New Connection" : "Edit Connection"}
            {mgr.isNewConnection && (
              <Sparkles size={16} className="text-success" />
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
              <span className="text-warning flex items-center gap-1 bg-warning/10 px-2 py-1 rounded-full">
                <span className="w-1.5 h-1.5 bg-warning rounded-full animate-pulse" />
                Saving...
              </span>
            )}
            {mgr.autoSaveStatus === "saved" && (
              <span className="text-success flex items-center gap-1 bg-success/10 px-2 py-1 rounded-full">
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
              ? "bg-success hover:bg-success/80 text-[var(--color-text)] shadow-lg shadow-success/20"
              : "bg-primary hover:bg-primary/80 text-[var(--color-text)] shadow-lg shadow-primary/20"
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
          ? "sor-option-chip-active bg-accent/20 border-accent/50 text-accent"
          : ""
      }`}
    >
      <Checkbox checked={!!mgr.formData.isGroup} onChange={(v: boolean) => mgr.setFormData({ ...mgr.formData, isGroup: v })} className="sr-only" />
      <FolderIcon size={16} />
      <span className="text-sm font-medium">Folder/Group</span>
    </label>
    {!mgr.formData.isGroup && (
      <label
        className={`sor-option-chip ${
          mgr.formData.favorite
            ? "sor-option-chip-active bg-warning/20 border-warning/50 text-warning"
            : ""
        }`}
      >
        <Checkbox checked={!!mgr.formData.favorite} onChange={(v: boolean) => mgr.setFormData({ ...mgr.formData, favorite: v })} className="sr-only" />
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
      <span className="text-error">*</span>
    </label>
    <input
      type="text"
      required
      data-testid="name-input"
      value={mgr.formData.name || ""}
      onChange={(e) =>
        mgr.setFormData({ ...mgr.formData, name: e.target.value })
      }
      className="w-full px-4 py-3 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-lg placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
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
      <Select value={mgr.formData.parentId || ""} onChange={(v: string) =>
          mgr.setFormData({
            ...mgr.formData,
            parentId: v || undefined,
          })} options={[{ value: '', label: 'Root (No parent)' }, ...mgr.selectableGroups.map(({ group, disabled, reason }) => ({ value: group.id, label: `${group.name}
            ${disabled ? ` (${reason})` : ""}`, disabled: disabled, title: reason }))]} className="w-full px-4 py-2.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all" />
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
                ? "sor-option-chip-active bg-info/20 border-info/60 text-info"
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
        Hostname / IP Address <span className="text-error">*</span>
      </label>
      <input
        type="text"
        required
        value={mgr.formData.hostname || ""}
        onChange={(e) =>
          mgr.setFormData({ ...mgr.formData, hostname: e.target.value })
        }
        className="w-full px-4 py-2.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono"
        placeholder="192.168.1.100 or server.example.com"
      />
    </div>
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        Port
      </label>
      <NumberInput value={mgr.formData.port || 0} onChange={(v: number) => mgr.setFormData({
            ...mgr.formData,
            port: v,
          })} className="w-full px-4 py-2.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono" min={1} max={65535} />
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
   BehaviorSection — per-connection focus behaviors
   ═══════════════════════════════════════════════════════════════ */

const FOCUS_OPTIONS = [
  { value: '', label: 'Use global setting' },
  { value: 'true', label: 'Focus tab' },
  { value: 'false', label: 'Open in background' },
] as const;

const parseFocusBool = (v: string): boolean | undefined =>
  v === 'true' ? true : v === 'false' ? false : undefined;

const BehaviorSection: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => {
  const isWindows = mgr.formData.osType === 'windows' || (!mgr.formData.osType && mgr.formData.protocol === 'rdp');
  return (
    <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
      <h3 className="text-sm font-semibold text-[var(--color-textSecondary)] flex items-center gap-2">
        <Zap size={14} /> Focus Behavior
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">On Connect</label>
          <Select
            value={mgr.formData.focusOnConnect === true ? 'true' : mgr.formData.focusOnConnect === false ? 'false' : ''}
            onChange={(v: string) => mgr.setFormData({ ...mgr.formData, focusOnConnect: parseFocusBool(v) })}
            options={FOCUS_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            variant="form"
          />
        </div>
        {isWindows && (
          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">On Windows Management Tool</label>
            <Select
              value={mgr.formData.focusOnWinmgmtTool === true ? 'true' : mgr.formData.focusOnWinmgmtTool === false ? 'false' : ''}
              onChange={(v: string) => mgr.setFormData({ ...mgr.formData, focusOnWinmgmtTool: parseFocusBool(v) })}
              options={FOCUS_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              variant="form"
            />
          </div>
        )}
      </div>
    </div>
  );
};

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
                ? "border-primary/60 bg-primary/20 text-primary"
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
          <span className="text-xs text-[var(--color-textMuted)] ml-2">
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
        <Textarea
          value={mgr.formData.description || ""}
          onChange={(e) =>
            mgr.setFormData({ ...mgr.formData, description: e.target.value })
          }
          rows={4}
          className="w-full px-4 py-3 bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
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
          <kbd className="px-1.5 py-0.5 bg-[var(--color-surfaceHover)] rounded text-[var(--color-textSecondary)]">
            Enter
          </kbd>{" "}
          to save
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-[var(--color-surfaceHover)] rounded text-[var(--color-textSecondary)]">
            Esc
          </kbd>{" "}
          to cancel
        </span>
      </div>
      {mgr.connection && mgr.settings.autoSaveEnabled && (
        <span className="text-[var(--color-textMuted)]">Auto-save enabled</span>
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
            mgr.isNewConnection ? "bg-success/15" : "bg-primary/15"
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

          {!mgr.formData.isGroup && <BehaviorSection mgr={mgr} />}

          <IconPicker mgr={mgr} />
          <TagsSection mgr={mgr} />
          <DescriptionSection mgr={mgr} />
        </div>

        <EditorFooter mgr={mgr} />
      </form>
    </Modal>
  );
};
