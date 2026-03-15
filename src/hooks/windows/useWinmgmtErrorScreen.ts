import { useState, useMemo, useCallback } from 'react';
import {
  classifyWinmgmtError,
  buildWinmgmtDiagnostics,
  WINMGMT_ERROR_CATEGORY_LABELS,
  type WinmgmtErrorCategory,
} from '../../utils/windows/winmgmtErrorClassifier';

interface UseWinmgmtErrorScreenParams {
  hostname: string;
  errorMessage: string;
  connectionId?: string;
}

export function useWinmgmtErrorScreen({
  hostname,
  errorMessage,
  connectionId,
}: UseWinmgmtErrorScreenParams) {
  const [copied, setCopied] = useState(false);
  const [showRawError, setShowRawError] = useState(false);
  const [expandedCause, setExpandedCause] = useState<number | null>(0);

  const category = useMemo(
    () => classifyWinmgmtError(errorMessage),
    [errorMessage],
  );
  const diagnostics = useMemo(() => buildWinmgmtDiagnostics(category), [category]);

  const handleCopy = useCallback(async () => {
    const text = [
      `WinRM Connection Error — ${hostname}`,
      connectionId ? `Connection: ${connectionId}` : '',
      `Category: ${WINMGMT_ERROR_CATEGORY_LABELS[category]}`,
      '',
      errorMessage,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, [hostname, connectionId, category, errorMessage]);

  const toggleCause = useCallback((idx: number) => {
    setExpandedCause((prev) => (prev === idx ? null : idx));
  }, []);

  const toggleRawError = useCallback(() => {
    setShowRawError((p) => !p);
  }, []);

  return {
    copied,
    showRawError,
    expandedCause,
    category,
    diagnostics,
    handleCopy,
    toggleCause,
    toggleRawError,
  };
}

export { WINMGMT_ERROR_CATEGORY_LABELS };
export type { WinmgmtErrorCategory };
