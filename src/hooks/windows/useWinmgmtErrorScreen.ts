import { useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  classifyWinmgmtError,
  buildWinmgmtDiagnostics,
  WINMGMT_ERROR_CATEGORY_LABELS,
  type WinmgmtErrorCategory,
} from '../../utils/windows/winmgmtErrorClassifier';

export interface DiagnosticStepResult {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'warn' | 'info';
  message: string;
  durationMs: number;
  detail: string | null;
}

export interface DiagnosticReportResult {
  host: string;
  port: number;
  protocol: string;
  resolvedIp: string | null;
  steps: DiagnosticStepResult[];
  summary: string;
  rootCauseHint: string | null;
  totalDurationMs: number;
}

interface UseWinmgmtErrorScreenParams {
  hostname: string;
  errorMessage: string;
  connectionId?: string;
  connectionConfig?: Record<string, unknown>;
}

export function useWinmgmtErrorScreen({
  hostname,
  errorMessage,
  connectionId,
  connectionConfig,
}: UseWinmgmtErrorScreenParams) {
  const [copied, setCopied] = useState(false);
  const [showRawError, setShowRawError] = useState(false);
  const [expandedCause, setExpandedCause] = useState<number | null>(0);

  // Deep diagnostics state
  const [diagnosticReport, setDiagnosticReport] =
    useState<DiagnosticReportResult | null>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

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

  const runDeepDiagnostics = useCallback(async () => {
    if (!connectionConfig) return;
    setIsRunningDiagnostics(true);
    setDiagnosticError(null);
    setDiagnosticReport(null);
    setExpandedStep(null);
    try {
      const report = await invoke<DiagnosticReportResult>(
        'diagnose_winrm_connection',
        { config: connectionConfig },
      );
      setDiagnosticReport(report);
      const failIdx = report.steps.findIndex(
        (s) => s.status === 'fail' || s.status === 'warn',
      );
      setExpandedStep(failIdx >= 0 ? failIdx : null);
    } catch (err: unknown) {
      setDiagnosticError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningDiagnostics(false);
    }
  }, [connectionConfig]);

  const toggleStep = useCallback((idx: number) => {
    setExpandedStep((p) => (p === idx ? null : idx));
  }, []);

  const toggleRawError = useCallback(() => {
    setShowRawError((p) => !p);
  }, []);

  return {
    copied,
    showRawError,
    expandedCause,
    diagnosticReport,
    isRunningDiagnostics,
    diagnosticError,
    expandedStep,
    category,
    diagnostics,
    handleCopy,
    toggleCause,
    runDeepDiagnostics,
    toggleStep,
    toggleRawError,
  };
}

export { WINMGMT_ERROR_CATEGORY_LABELS };
export type { WinmgmtErrorCategory };
