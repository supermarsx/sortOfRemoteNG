import { useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { RdpConnectionSettings } from '../types/connection';
import {
  classifyRdpError,
  buildRdpDiagnostics,
  RDP_ERROR_CATEGORY_LABELS,
  type RdpErrorCategory,
  type DiagnosticReportResult,
} from '../utils/rdpErrorClassifier';

interface UseRdpErrorScreenParams {
  sessionId: string;
  hostname: string;
  errorMessage: string;
  connectionDetails?: {
    port: number;
    username: string;
    password: string;
    domain?: string;
    rdpSettings?: RdpConnectionSettings;
  };
}

export function useRdpErrorScreen({
  sessionId,
  hostname,
  errorMessage,
  connectionDetails,
}: UseRdpErrorScreenParams) {
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
    () => classifyRdpError(errorMessage),
    [errorMessage],
  );
  const diagnostics = useMemo(() => buildRdpDiagnostics(category), [category]);

  const handleCopy = useCallback(async () => {
    const text = [
      `RDP Connection Error — ${hostname}`,
      `Session: ${sessionId}`,
      `Category: ${RDP_ERROR_CATEGORY_LABELS[category]}`,
      '',
      errorMessage,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, [hostname, sessionId, category, errorMessage]);

  const toggleCause = useCallback((idx: number) => {
    setExpandedCause((prev) => (prev === idx ? null : idx));
  }, []);

  const runDeepDiagnostics = useCallback(async () => {
    if (!connectionDetails) return;
    setIsRunningDiagnostics(true);
    setDiagnosticError(null);
    setDiagnosticReport(null);
    setExpandedStep(null);
    try {
      const report = await invoke<DiagnosticReportResult>(
        'diagnose_rdp_connection',
        {
          host: hostname,
          port: connectionDetails.port,
          username: connectionDetails.username,
          password: connectionDetails.password,
          domain: connectionDetails.domain ?? null,
          rdpSettings: connectionDetails.rdpSettings ?? null,
        },
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
  }, [hostname, connectionDetails]);

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

export { RDP_ERROR_CATEGORY_LABELS };
export type { RdpErrorCategory, DiagnosticReportResult };
