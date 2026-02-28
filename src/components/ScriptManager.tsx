/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import {
  X, Plus, Edit2, Trash2, Save, Copy, Search,
  FileCode, FolderOpen, Check,
  ChevronDown, CopyPlus
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui/Modal';
import { HighlightedCode } from './ui/HighlightedCode';
import { detectLanguage } from '../utils/scriptSyntax';
import { defaultScripts } from '../data/defaultScripts';
import { useScriptManager, type ScriptManagerMgr } from '../hooks/useScriptManager';

interface ScriptManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Exported types & constants (used by other components) ──────────

export type OSTag = 'windows' | 'linux' | 'macos' | 'agnostic' | 'multiplatform' | 'cisco-ios';

export interface ManagedScript {
  id: string;
  name: string;
  description: string;
  script: string;
  language: ScriptLanguage;
  category: string;
  osTags: OSTag[];
  createdAt: string;
  updatedAt: string;
}

export type ScriptLanguage = 'bash' | 'sh' | 'powershell' | 'batch' | 'auto';

export const OS_TAG_LABELS: Record<OSTag, string> = {
  'windows': 'Windows',
  'linux': 'Linux',
  'macos': 'macOS',
  'agnostic': 'Agnostic',
  'multiplatform': 'Multi-Platform',
  'cisco-ios': 'Cisco IOS',
};

export const OS_TAG_ICONS: Record<OSTag, string> = {
  'windows': '🪟',
  'linux': '🐧',
  'macos': '🍎',
  'agnostic': '🌐',
  'multiplatform': '🔀',
  'cisco-ios': '🔌',
};

export const SCRIPTS_STORAGE_KEY = 'managedScripts';

export const getDefaultScripts = (): ManagedScript[] => [...defaultScripts];

export const languageLabels: Record<ScriptLanguage, string> = {
  auto: 'Auto Detect',
  bash: 'Bash',
  sh: 'Shell (sh)',
  powershell: 'PowerShell',
  batch: 'Batch (cmd)',
};

export const languageIcons: Record<ScriptLanguage, string> = {
  auto: '🔍',
  bash: '🐚',
  sh: '📜',
  powershell: '⚡',
  batch: '🪟',
};

// ── Sub-components ─────────────────────────────────────────────────

function ScriptManagerHeader({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-purple-500/20 rounded-lg">
          <FileCode size={16} className="text-purple-600 dark:text-purple-400" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          {t('scriptManager.title', 'Script Manager')}
        </h2>
        <span className="text-sm text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] px-2 py-0.5 rounded">
          {mgr.filteredScripts.length} {t('scriptManager.scripts', 'scripts')}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={mgr.onClose}
          className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          aria-label={t('common.close', 'Close')}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function FilterToolbar({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-[var(--color-border)] px-5 py-3 flex items-center gap-4 bg-[var(--color-surfaceHover)]/30">
      {/* Search */}
      <div className="flex-1 relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]" />
        <input
          type="text"
          value={mgr.searchFilter}
          onChange={(e) => mgr.setSearchFilter(e.target.value)}
          placeholder={t('scriptManager.searchPlaceholder', 'Search scripts...')}
          className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
      </div>

      {/* Category filter */}
      <div className="relative">
        <select
          value={mgr.categoryFilter}
          onChange={(e) => mgr.setCategoryFilter(e.target.value)}
          className="appearance-none pl-3 pr-8 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
        >
          <option value="">{t('scriptManager.allCategories', 'All Categories')}</option>
          {mgr.categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] pointer-events-none" />
      </div>

      {/* Language filter */}
      <div className="relative">
        <select
          value={mgr.languageFilter}
          onChange={(e) => mgr.setLanguageFilter(e.target.value as ScriptLanguage | '')}
          className="appearance-none pl-3 pr-8 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
        >
          <option value="">{t('scriptManager.allLanguages', 'All Languages')}</option>
          <option value="bash">Bash</option>
          <option value="sh">Shell (sh)</option>
          <option value="powershell">PowerShell</option>
          <option value="batch">Batch (cmd)</option>
        </select>
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] pointer-events-none" />
      </div>

      {/* OS Tag filter */}
      <div className="relative">
        <select
          value={mgr.osTagFilter}
          onChange={(e) => mgr.setOsTagFilter(e.target.value as OSTag | '')}
          className="appearance-none pl-3 pr-8 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
        >
          <option value="">{t('scriptManager.allPlatforms', 'All Platforms')}</option>
          <option value="windows">🪟 Windows</option>
          <option value="linux">🐧 Linux</option>
          <option value="macos">🍎 macOS</option>
          <option value="agnostic">🌐 Agnostic</option>
          <option value="multiplatform">🔀 Multi-Platform</option>
          <option value="cisco-ios">🔌 Cisco IOS</option>
        </select>
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] pointer-events-none" />
      </div>

      {/* New script button */}
      <button
        onClick={mgr.handleNewScript}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-[var(--color-text)] rounded-lg transition-colors"
      >
        <Plus size={14} />
        {t('scriptManager.newScript', 'New Script')}
      </button>
    </div>
  );
}

function ScriptListItem({ script, mgr }: { script: ManagedScript; mgr: ScriptManagerMgr }) {
  return (
    <div
      onClick={() => mgr.handleSelectScript(script)}
      className={`p-3 rounded-lg cursor-pointer transition-colors group ${
        mgr.selectedScript?.id === script.id
          ? 'bg-purple-500/20 border border-purple-500/40'
          : 'hover:bg-[var(--color-surfaceHover)] border border-transparent'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg flex-shrink-0">{languageIcons[script.language]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[var(--color-text)] truncate">
              {script.name}
            </span>
            {script.id.startsWith('default-') && (
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-500/20 text-[var(--color-textSecondary)] rounded uppercase tracking-wide flex-shrink-0">
                Default
              </span>
            )}
          </div>
          {script.description && (
            <p className="text-xs text-[var(--color-textSecondary)] truncate mt-0.5">
              {script.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)] rounded">
              {script.category}
            </span>
            <span className="text-[10px] text-[var(--color-textMuted)]">
              {languageLabels[script.language]}
            </span>
            {script.osTags && script.osTags.length > 0 && (
              <div className="flex items-center gap-0.5">
                {script.osTags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px]" title={OS_TAG_LABELS[tag]}>
                    {OS_TAG_ICONS[tag]}
                  </span>
                ))}
                {script.osTags.length > 3 && (
                  <span className="text-[10px] text-[var(--color-textMuted)]">+{script.osTags.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScriptList({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="w-80 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]">
      <div className="flex-1 overflow-y-auto">
        {mgr.filteredScripts.length === 0 ? (
          <div className="p-8 text-center text-[var(--color-textSecondary)]">
            <FileCode size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">{t('scriptManager.noScripts', 'No scripts found')}</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {mgr.filteredScripts.map(script => (
              <ScriptListItem key={script.id} script={script} mgr={mgr} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScriptEditForm({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="space-y-4 max-w-3xl">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t('scriptManager.name', 'Script Name')} *
          </label>
          <input
            type="text"
            value={mgr.editName}
            onChange={(e) => mgr.setEditName(e.target.value)}
            placeholder={t('scriptManager.namePlaceholder', 'Enter script name')}
            className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        {/* Language + Category */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t('scriptManager.language', 'Language')}
            </label>
            <select
              value={mgr.editLanguage}
              onChange={(e) => mgr.setEditLanguage(e.target.value as ScriptLanguage)}
              className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              <option value="auto">🔍 Auto Detect</option>
              <option value="bash">🐚 Bash</option>
              <option value="sh">📜 Shell (sh)</option>
              <option value="powershell">⚡ PowerShell</option>
              <option value="batch">🪟 Batch (cmd)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t('scriptManager.category', 'Category')}
            </label>
            <input
              type="text"
              value={mgr.editCategory}
              onChange={(e) => mgr.setEditCategory(e.target.value)}
              placeholder="Custom"
              list="script-categories"
              className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <datalist id="script-categories">
              {mgr.categories.map(cat => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </div>
        </div>

        {/* OS Tags */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t('scriptManager.osTags', 'Platform Tags')}
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(OS_TAG_LABELS) as OSTag[]).map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => mgr.toggleOsTag(tag)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  mgr.editOsTags.includes(tag)
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-600 dark:text-purple-400'
                    : 'bg-[var(--color-surfaceHover)] border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surface)]'
                }`}
              >
                <span>{OS_TAG_ICONS[tag]}</span>
                <span>{OS_TAG_LABELS[tag]}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-[var(--color-textMuted)]">
            {t('scriptManager.osTagsHint', 'Select the platforms this script is compatible with')}
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t('scriptManager.description', 'Description')}
          </label>
          <input
            type="text"
            value={mgr.editDescription}
            onChange={(e) => mgr.setEditDescription(e.target.value)}
            placeholder={t('scriptManager.descriptionPlaceholder', 'Brief description of what this script does')}
            className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        {/* Script textarea */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t('scriptManager.script', 'Script')} *
          </label>
          <div className="relative">
            <textarea
              value={mgr.editScript}
              onChange={(e) => mgr.setEditScript(e.target.value)}
              placeholder={t('scriptManager.scriptPlaceholder', 'Enter your script here...')}
              className="w-full h-64 px-4 py-3 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono resize-y"
              spellCheck={false}
            />
          </div>
          {mgr.editScript && mgr.editLanguage === 'auto' && (
            <p className="mt-1.5 text-xs text-[var(--color-textSecondary)]">
              {t('scriptManager.detectedLanguage', 'Detected language')}: {languageLabels[detectLanguage(mgr.editScript)]}
            </p>
          )}
        </div>

        {/* Syntax Preview */}
        {mgr.editScript && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t('scriptManager.preview', 'Syntax Preview')}
            </label>
            <div className="p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg overflow-x-auto max-h-48 overflow-y-auto">
              <HighlightedCode code={mgr.editScript} language={mgr.editLanguage} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScriptDetailView({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  const script = mgr.selectedScript!;
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-3xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{languageIcons[script.language]}</span>
              <h3 className="text-xl font-semibold text-[var(--color-text)]">
                {script.name}
              </h3>
            </div>
            {script.description && (
              <p className="text-sm text-[var(--color-textSecondary)] mt-1">
                {script.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-1 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)] rounded">
                {script.category}
              </span>
              <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded">
                {languageLabels[script.language]}
              </span>
              {script.id.startsWith('default-') && (
                <span className="text-xs px-2 py-1 bg-gray-500/20 text-[var(--color-textSecondary)] rounded">
                  Default
                </span>
              )}
            </div>
            {script.osTags && script.osTags.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {script.osTags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full"
                  >
                    <span>{OS_TAG_ICONS[tag]}</span>
                    <span>{OS_TAG_LABELS[tag]}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => mgr.handleCopyScript(script)}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              title={t('scriptManager.copyToClipboard', 'Copy to Clipboard')}
            >
              {mgr.copiedId === script.id ? (
                <Check size={16} className="text-green-500" />
              ) : (
                <Copy size={16} />
              )}
            </button>
            <button
              onClick={() => mgr.handleDuplicateScript(script)}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              title={t('scriptManager.duplicate', 'Duplicate Script')}
            >
              <CopyPlus size={16} />
            </button>
            <button
              onClick={() => mgr.handleEditScript(script)}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              title={t('common.edit', 'Edit')}
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => mgr.handleDeleteScript(script.id)}
              className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-red-500"
              title={t('common.delete', 'Delete')}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg overflow-x-auto">
          <HighlightedCode code={script.script} language={script.language} />
        </div>

        <div className="mt-4 text-xs text-[var(--color-textMuted)]">
          {t('scriptManager.lastUpdated', 'Last updated')}: {new Date(script.updatedAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center text-[var(--color-textSecondary)]">
        <FolderOpen size={48} className="mx-auto mb-4 opacity-30" />
        <p className="text-lg font-medium">{t('scriptManager.selectScript', 'Select a script')}</p>
        <p className="text-sm mt-1">{t('scriptManager.selectScriptHint', 'Choose a script from the list to view or edit')}</p>
        <button
          onClick={mgr.handleNewScript}
          className="inline-flex items-center gap-2 px-4 py-2 mt-4 text-sm bg-purple-600 hover:bg-purple-700 text-[var(--color-text)] rounded-lg transition-colors"
        >
          <Plus size={14} />
          {t('scriptManager.createNew', 'Create New Script')}
        </button>
      </div>
    </div>
  );
}

function EditFooter({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="border-t border-[var(--color-border)] px-5 py-3 flex items-center justify-end gap-3 bg-[var(--color-surface)]">
      <button
        onClick={mgr.handleCancelEdit}
        className="px-4 py-2 text-sm bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg transition-colors"
      >
        {t('common.cancel', 'Cancel')}
      </button>
      <button
        onClick={mgr.handleSaveScript}
        disabled={!mgr.editName.trim() || !mgr.editScript.trim()}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-500 disabled:opacity-50 text-[var(--color-text)] rounded-lg transition-colors"
      >
        <Save size={14} />
        {t('common.save', 'Save')}
      </button>
    </div>
  );
}

function DetailPane({ mgr }: { mgr: ScriptManagerMgr }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {mgr.isEditing ? (
        <ScriptEditForm mgr={mgr} />
      ) : mgr.selectedScript ? (
        <ScriptDetailView mgr={mgr} />
      ) : (
        <EmptyState mgr={mgr} />
      )}
      {mgr.isEditing && <EditFooter mgr={mgr} />}
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────

export const ScriptManager: React.FC<ScriptManagerProps> = ({ isOpen, onClose }) => {
  const mgr = useScriptManager(onClose);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      backdropClassName="bg-black/50"
      panelClassName="sor-manager-panel max-w-5xl mx-4 relative"
    >
      {/* Background glow effects - only show in dark mode */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:opacity-100 opacity-0">
        <div className="absolute top-[20%] left-[15%] w-80 h-80 bg-purple-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-[25%] right-[10%] w-72 h-72 bg-blue-500/6 rounded-full blur-3xl" />
        <div className="absolute top-[60%] left-[40%] w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-surface)]">
        <ScriptManagerHeader mgr={mgr} />
        <FilterToolbar mgr={mgr} />
        <div className="flex-1 flex overflow-hidden">
          <ScriptList mgr={mgr} />
          <DetailPane mgr={mgr} />
        </div>
      </div>
    </Modal>
  );
};
