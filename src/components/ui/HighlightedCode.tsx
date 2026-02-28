import React, { useMemo } from 'react';
import type { ScriptLanguage } from '../ScriptManager';
import { tokenize, SYNTAX_COLORS } from '../../utils/scriptSyntax';

/**
 * Renders a code block with simple syntax highlighting
 * for shell / PowerShell / batch languages.
 */
export const HighlightedCode: React.FC<{ code: string; language: ScriptLanguage }> = ({
  code,
  language,
}) => {
  const tokens = useMemo(() => tokenize(code, language), [code, language]);

  return (
    <code className="font-mono text-sm whitespace-pre-wrap break-all">
      {tokens.map((token, index) => (
        <span key={index} className={SYNTAX_COLORS[token.type]}>
          {token.value}
        </span>
      ))}
    </code>
  );
};
