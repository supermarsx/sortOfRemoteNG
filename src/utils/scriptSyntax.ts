/**
 * Script language detection and syntax tokenisation utilities.
 *
 * Extracted from ScriptManager to be reusable across the app
 * (e.g. in script previews, the WebTerminal macro panel, etc.).
 */

import type { ScriptLanguage } from '../components/ScriptManager';

/* ── Token type ──────────────────────────────────────────────────── */

export interface SyntaxToken {
  type: 'keyword' | 'string' | 'comment' | 'variable' | 'operator' | 'number' | 'function' | 'text';
  value: string;
}

/* ── Language detection ──────────────────────────────────────────── */

const PS_PATTERNS: RegExp[] = [
  /\$[a-z_][a-z0-9_]*\s*=/i,
  /get-|set-|new-|remove-|invoke-/i,
  /\|\s*where-object|\|\s*select-object|\|\s*format-table/i,
  /\[math\]::|@\{|@\(/i,
  /param\s*\(/i,
  /-eq\s|-ne\s|-gt\s|-lt\s|-match\s/i,
];

const BATCH_PATTERNS: RegExp[] = [
  /^@echo\s+off/im,
  /^echo\./im,
  /^set\s+[a-z_][a-z0-9_]*=/im,
  /%[a-z_][a-z0-9_]*%/i,
  /^goto\s+:/im,
  /^if\s+(not\s+)?(exist|defined|errorlevel)/im,
  /^for\s+%%/im,
  /^::[^\n]*/m,
];

const BASH_PATTERNS: RegExp[] = [
  /\$\([^)]+\)/,
  /\$\{[^}]+\}/,
  /\[\[\s+.*\s+\]\]/,
  /\bfunction\s+\w+\s*\(\)/,
  /\|\s*grep\s|\|\s*awk\s|\|\s*sed\s/i,
  /\becho\s+-[ne]/i,
  /\bsudo\s/i,
  /\bchmod\s|\bchown\s/i,
  /\/dev\/null/,
];

function scorePatterns(script: string, patterns: RegExp[]): number {
  let score = 0;
  for (const pattern of patterns) {
    if (pattern.test(script)) score++;
  }
  return score;
}

/** Heuristically detect the scripting language from source content. */
export function detectLanguage(script: string): ScriptLanguage {
  const trimmed = script.trim().toLowerCase();

  // Shebang checks
  if (trimmed.startsWith('#!/bin/bash') || trimmed.startsWith('#!/usr/bin/env bash')) return 'bash';
  if (trimmed.startsWith('#!/bin/sh') || trimmed.startsWith('#!/usr/bin/env sh')) return 'sh';

  const psScore = scorePatterns(script, PS_PATTERNS);
  const batchScore = scorePatterns(script, BATCH_PATTERNS);
  const bashScore = scorePatterns(script, BASH_PATTERNS);

  if (psScore > batchScore && psScore > bashScore) return 'powershell';
  if (batchScore > psScore && batchScore > bashScore) return 'batch';
  if (bashScore > 0) return 'bash';

  return 'bash';
}

/* ── Keyword sets ────────────────────────────────────────────────── */

const KEYWORDS: Record<string, string[]> = {
  bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', 'return', 'exit', 'break', 'continue', 'in', 'select', 'local', 'export', 'readonly', 'declare', 'typeset', 'unset', 'shift', 'source', 'true', 'false'],
  sh: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'return', 'exit', 'break', 'continue', 'in', 'export', 'unset', 'shift', 'true', 'false'],
  powershell: ['if', 'else', 'elseif', 'switch', 'while', 'for', 'foreach', 'do', 'until', 'break', 'continue', 'return', 'exit', 'throw', 'try', 'catch', 'finally', 'function', 'filter', 'param', 'begin', 'process', 'end', 'class', 'enum', 'using', 'workflow', 'parallel', 'sequence', 'inlinescript', 'true', 'false', 'null'],
  batch: ['if', 'else', 'for', 'do', 'in', 'goto', 'call', 'exit', 'echo', 'set', 'setlocal', 'endlocal', 'pushd', 'popd', 'rem', 'pause', 'cls', 'copy', 'move', 'del', 'mkdir', 'rmdir', 'cd', 'dir', 'type', 'find', 'findstr', 'sort', 'more', 'errorlevel', 'exist', 'not', 'defined', 'equ', 'neq', 'lss', 'leq', 'gtr', 'geq', 'nul', 'con', 'prn', 'aux', 'off', 'on'],
};

const UNIX_BUILTINS = new Set([
  'ls', 'cd', 'cat', 'grep', 'awk', 'sed', 'find', 'sort', 'uniq', 'head', 'tail',
  'cut', 'tr', 'wc', 'xargs', 'tee', 'chmod', 'chown', 'sudo', 'apt', 'yum', 'dnf',
  'systemctl', 'docker', 'git', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'tar', 'gzip',
  'gunzip', 'zip', 'unzip', 'ps', 'top', 'htop', 'kill', 'pkill', 'pgrep', 'df', 'du',
  'free', 'mount', 'umount', 'fdisk', 'lsblk', 'ip', 'ifconfig', 'netstat', 'ss',
  'ping', 'traceroute', 'nslookup', 'dig', 'hostname', 'uname', 'uptime', 'date',
  'cal', 'who', 'whoami', 'id', 'passwd', 'useradd', 'userdel', 'groupadd', 'groupdel',
  'su', 'env', 'printenv', 'alias', 'history', 'man', 'info', 'help', 'which', 'whereis',
  'locate', 'touch', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'ln', 'file', 'stat',
  'basename', 'dirname', 'realpath', 'read', 'printf', 'test', 'expr',
]);

/* ── Tokeniser ───────────────────────────────────────────────────── */

/** Simple regex-based tokeniser for shell/batch/PowerShell syntax highlighting. */
export function tokenize(code: string, language: ScriptLanguage): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const actualLang = language === 'auto' ? detectLanguage(code) : language;
  const langKeywords = new Set(KEYWORDS[actualLang] || KEYWORDS.bash);

  let remaining = code;

  while (remaining.length > 0) {
    let matched = false;

    // ── Comments ──
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

    // ── Strings (double-quoted) ──
    if (!matched && remaining.match(/^"(?:[^"\\]|\\.)*"/)) {
      const match = remaining.match(/^"(?:[^"\\]|\\.)*"/)!;
      tokens.push({ type: 'string', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    }

    // ── Strings (single-quoted) ──
    if (!matched && remaining.match(/^'(?:[^'\\]|\\.)*'/)) {
      const match = remaining.match(/^'(?:[^'\\]|\\.)*'/)!;
      tokens.push({ type: 'string', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    }

    // ── Variables ──
    if (!matched) {
      let varMatch: RegExpMatchArray | null = null;
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

    // ── Numbers ──
    if (!matched && remaining.match(/^\d+(\.\d+)?/)) {
      const match = remaining.match(/^\d+(\.\d+)?/)!;
      tokens.push({ type: 'number', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    }

    // ── Keywords & identifiers ──
    if (!matched && remaining.match(/^[a-zA-Z_][a-zA-Z0-9_-]*/)) {
      const match = remaining.match(/^[a-zA-Z_][a-zA-Z0-9_-]*/)!;
      const word = match[0];
      const isKeyword = langKeywords.has(word.toLowerCase());

      const isFunction = !isKeyword && (
        (actualLang === 'powershell' && /^[A-Z][a-z]+-[A-Z][a-z]+/.test(word)) ||
        ((actualLang === 'bash' || actualLang === 'sh') && /^[a-z]+$/.test(word) && UNIX_BUILTINS.has(word))
      );

      tokens.push({ type: isKeyword ? 'keyword' : isFunction ? 'function' : 'text', value: word });
      remaining = remaining.slice(word.length);
      matched = true;
    }

    // ── Operators ──
    if (!matched && remaining.match(/^[|&;<>=!+\-*/%\\(){}\[\]@^]/)) {
      const match = remaining.match(/^[|&;<>=!+\-*/%\\(){}\[\]@^]+/)!;
      tokens.push({ type: 'operator', value: match[0] });
      remaining = remaining.slice(match[0].length);
      matched = true;
    }

    // ── Fallback ──
    if (!matched) {
      tokens.push({ type: 'text', value: remaining[0] });
      remaining = remaining.slice(1);
    }
  }

  return tokens;
}

/* ── Colour mapping ──────────────────────────────────────────────── */

export const SYNTAX_COLORS: Record<SyntaxToken['type'], string> = {
  keyword: 'text-purple-400',
  string: 'text-green-400',
  comment: 'text-gray-500 italic',
  variable: 'text-cyan-400',
  operator: 'text-yellow-400',
  number: 'text-orange-400',
  function: 'text-blue-400',
  text: 'text-[var(--color-text)]',
};
