import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Plus, Edit2, Trash2, Save, Copy, Search,
  FileCode, FolderOpen, Check,
  ChevronDown, CopyPlus
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ScriptManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface ManagedScript {
  id: string;
  name: string;
  description: string;
  script: string;
  language: ScriptLanguage;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export type ScriptLanguage = 'bash' | 'sh' | 'powershell' | 'batch' | 'auto';

const SCRIPTS_STORAGE_KEY = 'managedScripts';

// Default script templates
const defaultScripts: ManagedScript[] = [
  {
    id: 'default-1',
    name: 'System Info (Linux)',
    description: 'Get basic system information on Linux',
    script: '#!/bin/bash\nuname -a\ncat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null\nhostname',
    language: 'bash',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-2',
    name: 'Disk Usage (Linux)',
    description: 'Check disk space usage',
    script: '#!/bin/bash\ndf -h\necho ""\necho "Largest directories:"\ndu -sh /* 2>/dev/null | sort -rh | head -10',
    language: 'bash',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-3',
    name: 'Memory Usage (Linux)',
    description: 'Check memory usage',
    script: '#!/bin/bash\nfree -h\necho ""\necho "Top memory consumers:"\nps aux --sort=-%mem | head -10',
    language: 'bash',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-4',
    name: 'Network Connections (Linux)',
    description: 'Show active network connections',
    script: '#!/bin/bash\nnetstat -tuln 2>/dev/null || ss -tuln\necho ""\necho "IP addresses:"\nip addr show | grep -E "inet |inet6 "',
    language: 'bash',
    category: 'Network',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-5',
    name: 'System Info (Windows)',
    description: 'Get system information on Windows',
    script: 'systeminfo | findstr /B /C:"OS Name" /C:"OS Version" /C:"System Type" /C:"Total Physical Memory"\nhostname\nipconfig /all | findstr /C:"IPv4"',
    language: 'powershell',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-6',
    name: 'Disk Usage (Windows)',
    description: 'Check disk space on Windows',
    script: 'Get-PSDrive -PSProvider FileSystem | Format-Table Name, @{N="Used(GB)";E={[math]::Round($_.Used/1GB,2)}}, @{N="Free(GB)";E={[math]::Round($_.Free/1GB,2)}}, @{N="Total(GB)";E={[math]::Round(($_.Used+$_.Free)/1GB,2)}} -AutoSize',
    language: 'powershell',
    category: 'System',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-7',
    name: 'Service Status (Linux)',
    description: 'Check common service statuses',
    script: '#!/bin/bash\nfor service in nginx apache2 httpd mysql mariadb postgresql docker; do\n  if systemctl is-active --quiet $service 2>/dev/null; then\n    echo "$service: RUNNING"\n  elif systemctl is-enabled --quiet $service 2>/dev/null; then\n    echo "$service: STOPPED (enabled)"\n  fi\ndone',
    language: 'bash',
    category: 'Services',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-8',
    name: 'Service Status (Windows)',
    description: 'Check important Windows services',
    script: 'Get-Service | Where-Object {$_.Status -eq "Running"} | Sort-Object DisplayName | Format-Table DisplayName, Status -AutoSize | Select-Object -First 20',
    language: 'powershell',
    category: 'Services',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Language detection based on script content
const detectLanguage = (script: string): ScriptLanguage => {
  const trimmed = script.trim().toLowerCase();
  
  // Check shebang
  if (trimmed.startsWith('#!/bin/bash') || trimmed.startsWith('#!/usr/bin/env bash')) return 'bash';
  if (trimmed.startsWith('#!/bin/sh') || trimmed.startsWith('#!/usr/bin/env sh')) return 'sh';
  
  // Check for PowerShell specific patterns
  const psPatterns = [
    /\$[a-z_][a-z0-9_]*\s*=/i,        // Variable assignment
    /get-|set-|new-|remove-|invoke-/i, // PowerShell cmdlets
    /\|\s*where-object|\|\s*select-object|\|\s*format-table/i, // Pipeline cmdlets
    /\[math\]::|@\{|@\(/i,             // PowerShell specific syntax
    /param\s*\(/i,                     // PowerShell param block
    /-eq\s|-ne\s|-gt\s|-lt\s|-match\s/i, // PowerShell operators
  ];
  
  // Check for Batch specific patterns
  const batchPatterns = [
    /^@echo\s+off/im,
    /^echo\./im,
    /^set\s+[a-z_][a-z0-9_]*=/im,
    /%[a-z_][a-z0-9_]*%/i,
    /^goto\s+:/im,
    /^if\s+(not\s+)?(exist|defined|errorlevel)/im,
    /^for\s+%%/im,
    /^::[^\n]*/m,  // Batch comments
  ];
  
  // Check for Bash/Shell specific patterns
  const bashPatterns = [
    /\$\([^)]+\)/,                    // Command substitution
    /\$\{[^}]+\}/,                    // Parameter expansion
    /\[\[\s+.*\s+\]\]/,               // Bash test construct
    /\bfunction\s+\w+\s*\(\)/,        // Function definition
    /\|\s*grep\s|\|\s*awk\s|\|\s*sed\s/i, // Unix pipe commands
    /\becho\s+-[ne]/i,                // echo with flags
    /\bsudo\s/i,                      // sudo command
    /\bchmod\s|\bchown\s/i,           // Unix file commands
    /\/dev\/null/,                    // Unix null device
  ];

  let psScore = 0;
  let batchScore = 0;
  let bashScore = 0;

  for (const pattern of psPatterns) {
    if (pattern.test(script)) psScore++;
  }
  for (const pattern of batchPatterns) {
    if (pattern.test(script)) batchScore++;
  }
  for (const pattern of bashPatterns) {
    if (pattern.test(script)) bashScore++;
  }

  // Return the highest scoring language
  if (psScore > batchScore && psScore > bashScore) return 'powershell';
  if (batchScore > psScore && batchScore > bashScore) return 'batch';
  if (bashScore > 0) return 'bash';
  
  // Default to bash for Unix-like systems
  return 'bash';
};

// Syntax highlighting tokens
interface Token {
  type: 'keyword' | 'string' | 'comment' | 'variable' | 'operator' | 'number' | 'function' | 'text';
  value: string;
}

// Simple tokenizer for syntax highlighting
const tokenize = (code: string, language: ScriptLanguage): Token[] => {
  const tokens: Token[] = [];
  const actualLang = language === 'auto' ? detectLanguage(code) : language;
  
  // Language-specific keywords
  const keywords: Record<string, string[]> = {
    bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', 'return', 'exit', 'break', 'continue', 'in', 'select', 'local', 'export', 'readonly', 'declare', 'typeset', 'unset', 'shift', 'source', 'true', 'false'],
    sh: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'return', 'exit', 'break', 'continue', 'in', 'export', 'unset', 'shift', 'true', 'false'],
    powershell: ['if', 'else', 'elseif', 'switch', 'while', 'for', 'foreach', 'do', 'until', 'break', 'continue', 'return', 'exit', 'throw', 'try', 'catch', 'finally', 'function', 'filter', 'param', 'begin', 'process', 'end', 'class', 'enum', 'using', 'workflow', 'parallel', 'sequence', 'inlinescript', 'true', 'false', 'null'],
    batch: ['if', 'else', 'for', 'do', 'in', 'goto', 'call', 'exit', 'echo', 'set', 'setlocal', 'endlocal', 'pushd', 'popd', 'rem', 'pause', 'cls', 'copy', 'move', 'del', 'mkdir', 'rmdir', 'cd', 'dir', 'type', 'find', 'findstr', 'sort', 'more', 'errorlevel', 'exist', 'not', 'defined', 'equ', 'neq', 'lss', 'leq', 'gtr', 'geq', 'nul', 'con', 'prn', 'aux', 'off', 'on'],
  };

  const langKeywords = new Set(keywords[actualLang] || keywords.bash);
  
  // Simple regex-based tokenization
  let remaining = code;
  
  while (remaining.length > 0) {
    let matched = false;
    
    // Comments
    if (actualLang === 'batch' && remaining.match(/^::[^\n]*/)) {
      const match = remaining.match(/^::[^\n]*/)!;
      tokens.push({ type: 'comment', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    } else if (actualLang === 'batch' && remaining.match(/^(?:rem\s)[^\n]*/i)) {
      const match = remaining.match(/^(?:rem\s)[^\n]*/i)!;
      tokens.push({ type: 'comment', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    } else if ((actualLang === 'bash' || actualLang === 'sh' || actualLang === 'powershell') && remaining.match(/^#[^\n]*/)) {
      const match = remaining.match(/^#[^\n]*/)!;
      tokens.push({ type: 'comment', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    }
    
    // Strings (double quotes)
    if (!matched && remaining.match(/^"(?:[^"\\]|\\.)*"/)) {
      const match = remaining.match(/^"(?:[^"\\]|\\.)*"/)!;
      tokens.push({ type: 'string', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    }
    
    // Strings (single quotes)
    if (!matched && remaining.match(/^'(?:[^'\\]|\\.)*'/)) {
      const match = remaining.match(/^'(?:[^'\\]|\\.)*'/)!;
      tokens.push({ type: 'string', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    }
    
    // Variables
    if (!matched) {
      let varMatch = null;
      if (actualLang === 'powershell' && remaining.match(/^\$[a-zA-Z_][a-zA-Z0-9_]*/)) {
        varMatch = remaining.match(/^\$[a-zA-Z_][a-zA-Z0-9_]*/)!;
      } else if ((actualLang === 'bash' || actualLang === 'sh') && remaining.match(/^\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?/)) {
        varMatch = remaining.match(/^\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?/)!;
      } else if (actualLang === 'batch' && remaining.match(/^%[a-zA-Z_][a-zA-Z0-9_]*%/)) {
        varMatch = remaining.match(/^%[a-zA-Z_][a-zA-Z0-9_]*%/)!;
      } else if (actualLang === 'batch' && remaining.match(/^%%[a-zA-Z]/)) {
        varMatch = remaining.match(/^%%[a-zA-Z]/)!;
      }
      if (varMatch) {
        tokens.push({ type: 'variable', value: varMatch[0] });
        remaining = remaining.slice(varMatch[0].length);
        matched = true;
      }
    }
    
    // Numbers
    if (!matched && remaining.match(/^\d+(\.\d+)?/)) {
      const match = remaining.match(/^\d+(\.\d+)?/)!;
      tokens.push({ type: 'number', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    }
    
    // Keywords and identifiers
    if (!matched && remaining.match(/^[a-zA-Z_][a-zA-Z0-9_-]*/)) {
      const match = remaining.match(/^[a-zA-Z_][a-zA-Z0-9_-]*/)!;
      const word = match[0];
      const isKeyword = langKeywords.has(word.toLowerCase());
      
      // Check if it looks like a function/command
      const isFunction = !isKeyword && (
        (actualLang === 'powershell' && /^[A-Z][a-z]+-[A-Z][a-z]+/.test(word)) || // PowerShell cmdlets
        ((actualLang === 'bash' || actualLang === 'sh') && /^[a-z]+$/.test(word) && ['ls', 'cd', 'cat', 'grep', 'awk', 'sed', 'find', 'sort', 'uniq', 'head', 'tail', 'cut', 'tr', 'wc', 'xargs', 'tee', 'chmod', 'chown', 'sudo', 'apt', 'yum', 'dnf', 'systemctl', 'docker', 'git', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'ps', 'top', 'htop', 'kill', 'pkill', 'pgrep', 'df', 'du', 'free', 'mount', 'umount', 'fdisk', 'lsblk', 'ip', 'ifconfig', 'netstat', 'ss', 'ping', 'traceroute', 'nslookup', 'dig', 'hostname', 'uname', 'uptime', 'date', 'cal', 'who', 'whoami', 'id', 'passwd', 'useradd', 'userdel', 'groupadd', 'groupdel', 'su', 'env', 'printenv', 'alias', 'history', 'man', 'info', 'help', 'which', 'whereis', 'locate', 'touch', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'ln', 'file', 'stat', 'basename', 'dirname', 'realpath', 'read', 'printf', 'test', 'expr'].includes(word))
      );
      
      tokens.push({ type: isKeyword ? 'keyword' : isFunction ? 'function' : 'text', value: word });
      remaining = remaining.slice(word.length);
      matched = true;
    }
    
    // Operators
    if (!matched && remaining.match(/^[|&;<>=!+\-*/%\\(){}\[\]@^]/)) {
      const match = remaining.match(/^[|&;<>=!+\-*/%\\(){}\[\]@^]+/)!;
      tokens.push({ type: 'operator', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    }
    
    // Whitespace and other characters
    if (!matched) {
      tokens.push({ type: 'text', value: remaining[0] });
      remaining = remaining.slice(1);
    }
  }
  
  return tokens;
};

// Render highlighted code
const HighlightedCode: React.FC<{ code: string; language: ScriptLanguage }> = ({ code, language }) => {
  const tokens = useMemo(() => tokenize(code, language), [code, language]);
  
  const colorMap: Record<Token['type'], string> = {
    keyword: 'text-purple-400',
    string: 'text-green-400',
    comment: 'text-gray-500 italic',
    variable: 'text-cyan-400',
    operator: 'text-yellow-400',
    number: 'text-orange-400',
    function: 'text-blue-400',
    text: 'text-[var(--color-text)]',
  };
  
  return (
    <code className="font-mono text-sm whitespace-pre-wrap break-all">
      {tokens.map((token, index) => (
        <span key={index} className={colorMap[token.type]}>
          {token.value}
        </span>
      ))}
    </code>
  );
};

const languageLabels: Record<ScriptLanguage, string> = {
  auto: 'Auto Detect',
  bash: 'Bash',
  sh: 'Shell (sh)',
  powershell: 'PowerShell',
  batch: 'Batch (cmd)',
};

const languageIcons: Record<ScriptLanguage, string> = {
  auto: '🔍',
  bash: '🐚',
  sh: '📜',
  powershell: '⚡',
  batch: '🪟',
};

export const ScriptManager: React.FC<ScriptManagerProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  
  const [scripts, setScripts] = useState<ManagedScript[]>([]);
  const [selectedScript, setSelectedScript] = useState<ManagedScript | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<ScriptLanguage | ''>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editScript, setEditScript] = useState('');
  const [editLanguage, setEditLanguage] = useState<ScriptLanguage>('auto');
  const [editCategory, setEditCategory] = useState('Custom');
  
  // Load scripts from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCRIPTS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setScripts([...defaultScripts, ...parsed]);
      } else {
        setScripts(defaultScripts);
      }
    } catch {
      setScripts(defaultScripts);
    }
  }, []);
  
  // Save scripts to localStorage
  const saveScripts = useCallback((newScripts: ManagedScript[]) => {
    const customScripts = newScripts.filter(s => !s.id.startsWith('default-'));
    localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify(customScripts));
    setScripts([...defaultScripts, ...customScripts]);
  }, []);
  
  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(scripts.map(s => s.category));
    return Array.from(cats).sort();
  }, [scripts]);
  
  // Filter scripts
  const filteredScripts = useMemo(() => {
    return scripts.filter(script => {
      const matchesSearch = !searchFilter || 
        script.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        script.description.toLowerCase().includes(searchFilter.toLowerCase()) ||
        script.script.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesCategory = !categoryFilter || script.category === categoryFilter;
      const matchesLanguage = !languageFilter || script.language === languageFilter;
      return matchesSearch && matchesCategory && matchesLanguage;
    });
  }, [scripts, searchFilter, categoryFilter, languageFilter]);
  
  // Start creating new script
  const handleNewScript = useCallback(() => {
    setSelectedScript(null);
    setEditName('');
    setEditDescription('');
    setEditScript('');
    setEditLanguage('auto');
    setEditCategory('Custom');
    setIsEditing(true);
  }, []);
  
  // Start editing existing script
  const handleEditScript = useCallback((script: ManagedScript) => {
    setSelectedScript(script);
    setEditName(script.name);
    setEditDescription(script.description);
    setEditScript(script.script);
    setEditLanguage(script.language);
    setEditCategory(script.category);
    setIsEditing(true);
  }, []);
  
  // Save script (create or update)
  const handleSaveScript = useCallback(() => {
    if (!editName.trim() || !editScript.trim()) return;
    
    const finalLanguage = editLanguage === 'auto' ? detectLanguage(editScript) : editLanguage;
    
    if (selectedScript && !selectedScript.id.startsWith('default-')) {
      // Update existing
      const updated = scripts.map(s => 
        s.id === selectedScript.id
          ? {
              ...s,
              name: editName.trim(),
              description: editDescription.trim(),
              script: editScript,
              language: finalLanguage,
              category: editCategory,
              updatedAt: new Date().toISOString(),
            }
          : s
      );
      saveScripts(updated);
    } else {
      // Create new
      const newScript: ManagedScript = {
        id: Date.now().toString(),
        name: editName.trim(),
        description: editDescription.trim(),
        script: editScript,
        language: finalLanguage,
        category: editCategory,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      saveScripts([...scripts, newScript]);
    }
    
    setIsEditing(false);
    setSelectedScript(null);
  }, [editName, editDescription, editScript, editLanguage, editCategory, selectedScript, scripts, saveScripts]);
  
  // Delete script
  const handleDeleteScript = useCallback((scriptId: string) => {
    if (scriptId.startsWith('default-')) return;
    saveScripts(scripts.filter(s => s.id !== scriptId));
    if (selectedScript?.id === scriptId) {
      setSelectedScript(null);
      setIsEditing(false);
    }
  }, [scripts, selectedScript, saveScripts]);
  
  // Copy script to clipboard
  const handleCopyScript = useCallback(async (script: ManagedScript) => {
    try {
      await navigator.clipboard.writeText(script.script);
      setCopiedId(script.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy script:', error);
    }
  }, []);
  
  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setSelectedScript(null);
  }, []);

  // Duplicate script
  const handleDuplicateScript = useCallback((script: ManagedScript) => {
    setSelectedScript(null);
    setEditName(script.name + ' (Copy)');
    setEditDescription(script.description);
    setEditScript(script.script);
    setEditLanguage(script.language);
    setEditCategory(script.category);
    setIsEditing(true);
  }, []);
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      {/* Background glow effects - only show in dark mode */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:opacity-100 opacity-0">
        <div className="absolute top-[20%] left-[15%] w-80 h-80 bg-purple-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-[25%] right-[10%] w-72 h-72 bg-blue-500/6 rounded-full blur-3xl" />
        <div className="absolute top-[60%] left-[40%] w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl" />
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-5xl mx-4 h-[85vh] overflow-hidden flex flex-col border border-[var(--color-border)] relative z-10">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <FileCode size={16} className="text-purple-600 dark:text-purple-400" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {t('scriptManager.title', 'Script Manager')}
            </h2>
            <span className="text-sm text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] px-2 py-0.5 rounded">
              {filteredScripts.length} {t('scriptManager.scripts', 'scripts')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              aria-label={t('common.close', 'Close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Secondary toolbar */}
        <div className="border-b border-[var(--color-border)] px-5 py-3 flex items-center gap-4 bg-[var(--color-surfaceHover)]/30">
          {/* Search */}
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder={t('scriptManager.searchPlaceholder', 'Search scripts...')}
              className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
          
          {/* Category filter */}
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
            >
              <option value="">{t('scriptManager.allCategories', 'All Categories')}</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] pointer-events-none" />
          </div>
          
          {/* Language filter */}
          <div className="relative">
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value as ScriptLanguage | '')}
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
          
          {/* New script button */}
          <button
            onClick={handleNewScript}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
          >
            <Plus size={14} />
            {t('scriptManager.newScript', 'New Script')}
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Script list */}
          <div className="w-80 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]">
            <div className="flex-1 overflow-y-auto">
              {filteredScripts.length === 0 ? (
                <div className="p-8 text-center text-[var(--color-textSecondary)]">
                  <FileCode size={32} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm">{t('scriptManager.noScripts', 'No scripts found')}</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {filteredScripts.map(script => (
                    <div
                      key={script.id}
                      onClick={() => { setSelectedScript(script); setIsEditing(false); }}
                      className={`p-3 rounded-lg cursor-pointer transition-colors group ${
                        selectedScript?.id === script.id
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
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)] rounded">
                              {script.category}
                            </span>
                            <span className="text-[10px] text-[var(--color-textMuted)]">
                              {languageLabels[script.language]}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Script detail / editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {isEditing ? (
              /* Edit form */
              <div className="flex-1 overflow-y-auto p-5">
                <div className="space-y-4 max-w-3xl">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                      {t('scriptManager.name', 'Script Name')} *
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder={t('scriptManager.namePlaceholder', 'Enter script name')}
                      className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                        {t('scriptManager.language', 'Language')}
                      </label>
                      <select
                        value={editLanguage}
                        onChange={(e) => setEditLanguage(e.target.value as ScriptLanguage)}
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
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        placeholder="Custom"
                        list="script-categories"
                        className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                      <datalist id="script-categories">
                        {categories.map(cat => (
                          <option key={cat} value={cat} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                      {t('scriptManager.description', 'Description')}
                    </label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder={t('scriptManager.descriptionPlaceholder', 'Brief description of what this script does')}
                      className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                      {t('scriptManager.script', 'Script')} *
                    </label>
                    <div className="relative">
                      <textarea
                        value={editScript}
                        onChange={(e) => setEditScript(e.target.value)}
                        placeholder={t('scriptManager.scriptPlaceholder', 'Enter your script here...')}
                        className="w-full h-64 px-4 py-3 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono resize-y"
                        spellCheck={false}
                      />
                    </div>
                    {editScript && editLanguage === 'auto' && (
                      <p className="mt-1.5 text-xs text-[var(--color-textSecondary)]">
                        {t('scriptManager.detectedLanguage', 'Detected language')}: {languageLabels[detectLanguage(editScript)]}
                      </p>
                    )}
                  </div>
                  
                  {/* Preview */}
                  {editScript && (
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                        {t('scriptManager.preview', 'Syntax Preview')}
                      </label>
                      <div className="p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg overflow-x-auto max-h-48 overflow-y-auto">
                        <HighlightedCode code={editScript} language={editLanguage} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : selectedScript ? (
              /* View script details */
              <div className="flex-1 overflow-y-auto p-5">
                <div className="max-w-3xl">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{languageIcons[selectedScript.language]}</span>
                        <h3 className="text-xl font-semibold text-[var(--color-text)]">
                          {selectedScript.name}
                        </h3>
                      </div>
                      {selectedScript.description && (
                        <p className="text-sm text-[var(--color-textSecondary)] mt-1">
                          {selectedScript.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs px-2 py-1 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)] rounded">
                          {selectedScript.category}
                        </span>
                        <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded">
                          {languageLabels[selectedScript.language]}
                        </span>
                        {selectedScript.id.startsWith('default-') && (
                          <span className="text-xs px-2 py-1 bg-gray-500/20 text-[var(--color-textSecondary)] rounded">
                            Default
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Copy to clipboard */}
                      <button
                        onClick={() => handleCopyScript(selectedScript)}
                        className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                        title={t('scriptManager.copyToClipboard', 'Copy to Clipboard')}
                      >
                        {copiedId === selectedScript.id ? (
                          <Check size={16} className="text-green-500" />
                        ) : (
                          <Copy size={16} />
                        )}
                      </button>
                      {/* Duplicate script (create copy) */}
                      <button
                        onClick={() => handleDuplicateScript(selectedScript)}
                        className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                        title={t('scriptManager.duplicate', 'Duplicate Script')}
                      >
                        <CopyPlus size={16} />
                      </button>
                      {!selectedScript.id.startsWith('default-') && (
                        <>
                          <button
                            onClick={() => handleEditScript(selectedScript)}
                            className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                            title={t('common.edit', 'Edit')}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteScript(selectedScript.id)}
                            className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-red-500"
                            title={t('common.delete', 'Delete')}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg overflow-x-auto">
                    <HighlightedCode code={selectedScript.script} language={selectedScript.language} />
                  </div>
                  
                  <div className="mt-4 text-xs text-[var(--color-textMuted)]">
                    {t('scriptManager.lastUpdated', 'Last updated')}: {new Date(selectedScript.updatedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ) : (
              /* Empty state */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-[var(--color-textSecondary)]">
                  <FolderOpen size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium">{t('scriptManager.selectScript', 'Select a script')}</p>
                  <p className="text-sm mt-1">{t('scriptManager.selectScriptHint', 'Choose a script from the list to view or edit')}</p>
                  <button
                    onClick={handleNewScript}
                    className="inline-flex items-center gap-2 px-4 py-2 mt-4 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                  >
                    <Plus size={14} />
                    {t('scriptManager.createNew', 'Create New Script')}
                  </button>
                </div>
              </div>
            )}

            {/* Footer actions when editing */}
            {isEditing && (
              <div className="border-t border-[var(--color-border)] px-5 py-3 flex items-center justify-end gap-3 bg-[var(--color-surface)]">
                <button
                  onClick={handleCancelEdit}
                  className="px-4 py-2 text-sm bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg transition-colors"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  onClick={handleSaveScript}
                  disabled={!editName.trim() || !editScript.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  <Save size={14} />
                  {t('common.save', 'Save')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
