
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
