import { useMemo } from 'react';

interface PasswordStrength {
  score: number; // 0-4
  label: 'Very Weak' | 'Weak' | 'Fair' | 'Strong' | 'Very Strong';
  suggestions: string[];
  entropy: number;
}

export function usePasswordStrength(password: string): PasswordStrength {
  return useMemo(() => {
    if (!password) return { score: 0, label: 'Very Weak', suggestions: ['Enter a password'], entropy: 0 };

    const suggestions: string[] = [];
    let charsetSize = 0;

    if (/[a-z]/.test(password)) charsetSize += 26;
    else suggestions.push('Add lowercase letters');

    if (/[A-Z]/.test(password)) charsetSize += 26;
    else suggestions.push('Add uppercase letters');

    if (/[0-9]/.test(password)) charsetSize += 10;
    else suggestions.push('Add digits');

    if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32;
    else suggestions.push('Add special characters');

    if (password.length < 8) suggestions.push('Use at least 8 characters');
    if (password.length < 12) suggestions.push('Use 12+ characters for better security');

    const entropy = password.length * Math.log2(Math.max(charsetSize, 1));

    let score: number;
    let label: PasswordStrength['label'];

    if (entropy < 25) { score = 0; label = 'Very Weak'; }
    else if (entropy < 40) { score = 1; label = 'Weak'; }
    else if (entropy < 60) { score = 2; label = 'Fair'; }
    else if (entropy < 80) { score = 3; label = 'Strong'; }
    else { score = 4; label = 'Very Strong'; }

    return { score, label, suggestions: suggestions.slice(0, 3), entropy };
  }, [password]);
}
