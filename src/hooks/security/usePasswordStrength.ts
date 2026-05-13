import { useMemo } from 'react';

export interface PasswordStrengthOptions {
  detectCommonPasswords?: boolean;
  detectRepeatedCharacters?: boolean;
  detectSequentialPatterns?: boolean;
  rewardUncommonSymbols?: boolean;
  customCommonPasswords?: string | string[];
}

export interface PasswordStrength {
  score: number; // 0-4
  label: 'Very Weak' | 'Weak' | 'Fair' | 'Strong' | 'Very Strong';
  suggestions: string[];
  warnings: string[];
  positiveSignals: string[];
  entropy: number;
  commonPassword: boolean;
  hasRepeatedCharacters: boolean;
  hasSequentialPattern: boolean;
  hasUncommonSymbols: boolean;
}

const BUILT_IN_COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'admin',
  'administrator',
  'letmein',
  'welcome',
  'qwerty',
  'qwerty123',
  '123456',
  '12345678',
  '123456789',
  '111111',
  'abc123',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'sortofremoteng',
  'mremoteng',
]);

const COMMON_SYMBOLS = new Set("!@#$%^&*()-_=+[]{};:\\|,.<>/?`~\"'".split(''));

const normalizeCommonPasswords = (
  value: PasswordStrengthOptions['customCommonPasswords'],
): string[] => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const hasSequentialRun = (password: string): boolean => {
  const lowered = password.toLowerCase();
  const sequences = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  return sequences.some((sequence) => {
    for (let length = 4; length <= Math.min(8, sequence.length); length++) {
      for (let index = 0; index <= sequence.length - length; index++) {
        const chunk = sequence.slice(index, index + length);
        const reversed = chunk.split('').reverse().join('');
        if (lowered.includes(chunk) || lowered.includes(reversed)) return true;
      }
    }
    return false;
  });
};

const estimateEntropy = (password: string): number => {
  let charsetSize = 0;
  if (/[a-z]/.test(password)) charsetSize += 26;
  if (/[A-Z]/.test(password)) charsetSize += 26;
  if (/[0-9]/.test(password)) charsetSize += 10;
  if (/[^a-zA-Z0-9\s]/.test(password)) charsetSize += 33;
  if (/\s/.test(password)) charsetSize += 1;
  return password.length * Math.log2(Math.max(charsetSize, 1));
};

export function analyzePasswordStrength(
  password: string,
  options: PasswordStrengthOptions = {},
): PasswordStrength {
  const mergedOptions = {
    detectCommonPasswords: true,
    detectRepeatedCharacters: true,
    detectSequentialPatterns: true,
    rewardUncommonSymbols: true,
    ...options,
  };

  if (!password) {
    return {
      score: 0,
      label: 'Very Weak',
      suggestions: ['Enter a password'],
      warnings: [],
      positiveSignals: [],
      entropy: 0,
      commonPassword: false,
      hasRepeatedCharacters: false,
      hasSequentialPattern: false,
      hasUncommonSymbols: false,
    };
  }

  const suggestions: string[] = [];
  const warnings: string[] = [];
  const positiveSignals: string[] = [];

  if (/[a-z]/.test(password)) positiveSignals.push('Uses lowercase letters');
  else suggestions.push('Add lowercase letters');

  if (/[A-Z]/.test(password)) positiveSignals.push('Uses uppercase letters');
  else suggestions.push('Add uppercase letters');

  if (/[0-9]/.test(password)) positiveSignals.push('Uses digits');
  else suggestions.push('Add digits');

  if (/[^a-zA-Z0-9]/.test(password)) positiveSignals.push('Uses symbols');
  else suggestions.push('Add special characters');

  if (password.length < 8) suggestions.push('Use at least 8 characters');
  if (password.length < 12) suggestions.push('Use 12+ characters for better security');

  const lowerPassword = password.toLowerCase();
  const commonPasswords = new Set([
    ...BUILT_IN_COMMON_PASSWORDS,
    ...normalizeCommonPasswords(mergedOptions.customCommonPasswords).map((entry) =>
      entry.toLowerCase(),
    ),
  ]);
  const commonPassword =
    Boolean(mergedOptions.detectCommonPasswords) && commonPasswords.has(lowerPassword);
  const hasRepeatedCharacters =
    Boolean(mergedOptions.detectRepeatedCharacters) && /(.)\1{2,}/.test(password);
  const hasSequentialPattern =
    Boolean(mergedOptions.detectSequentialPatterns) && hasSequentialRun(password);
  const hasUncommonSymbols = Array.from(password).some(
    (char) => /[^a-zA-Z0-9\s]/.test(char) && !COMMON_SYMBOLS.has(char),
  );

  if (commonPassword) warnings.push('Matches a common password pattern');
  if (hasRepeatedCharacters) warnings.push('Repeated characters are easier to guess');
  if (hasSequentialPattern) warnings.push('Sequential keyboard or numeric patterns reduce strength');
  if (hasUncommonSymbols && mergedOptions.rewardUncommonSymbols) {
    positiveSignals.push('Includes uncommon symbols');
  }

  let entropy = estimateEntropy(password);
  if (commonPassword) entropy = Math.min(entropy, 12);
  if (hasRepeatedCharacters) entropy *= 0.75;
  if (hasSequentialPattern) entropy *= 0.8;
  if (hasUncommonSymbols && mergedOptions.rewardUncommonSymbols) entropy += 8;
  entropy = Math.max(0, Math.round(entropy));

  let score: number;
  let label: PasswordStrength['label'];

  if (entropy < 25) { score = 0; label = 'Very Weak'; }
  else if (entropy < 40) { score = 1; label = 'Weak'; }
  else if (entropy < 60) { score = 2; label = 'Fair'; }
  else if (entropy < 80) { score = 3; label = 'Strong'; }
  else { score = 4; label = 'Very Strong'; }

  if (commonPassword) {
    score = Math.min(score, 1);
    label = score === 0 ? 'Very Weak' : 'Weak';
    suggestions.unshift('Avoid common passwords');
  }
  if (hasRepeatedCharacters) suggestions.unshift('Avoid repeated characters');
  if (hasSequentialPattern) suggestions.unshift('Avoid keyboard or numeric sequences');

  return {
    score,
    label,
    suggestions: Array.from(new Set(suggestions)).slice(0, 4),
    warnings,
    positiveSignals: Array.from(new Set(positiveSignals)).slice(0, 5),
    entropy,
    commonPassword,
    hasRepeatedCharacters,
    hasSequentialPattern,
    hasUncommonSymbols,
  };
}

export function usePasswordStrength(
  password: string,
  options?: PasswordStrengthOptions,
): PasswordStrength {
  return useMemo(
    () => analyzePasswordStrength(password, options),
    [password, options],
  );
}
