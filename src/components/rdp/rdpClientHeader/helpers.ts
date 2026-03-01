import React from "react";

export interface RDPClientHeaderProps {
  sessionName: string;
  sessionHostname: string;
  connectionStatus: string;
  statusMessage: string;
  desktopSize: { width: number; height: number };
  colorDepth: number;
  perfLabel: string;
  magnifierEnabled: boolean;
  magnifierActive: boolean;
  showInternals: boolean;
  showSettings: boolean;
  isFullscreen: boolean;
  recState: { isRecording: boolean; isPaused: boolean; duration: number };
  getStatusColor: () => string;
  getStatusIcon: () => React.ReactNode;
  setMagnifierActive: (v: boolean) => void;
  setShowInternals: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  handleScreenshot: () => void;
  handleScreenshotToClipboard: () => void;
  handleStopRecording: () => void;
  toggleFullscreen: () => void;
  startRecording: (format: string) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  handleReconnect: () => void;
  handleDisconnect: () => void;
  handleCopyToClipboard: () => void;
  handlePasteFromClipboard: () => void;
  handleSendKeys: (combo: string) => void;
  handleSignOut: () => void;
  handleForceReboot: () => void;
  connectionId: string;
  certFingerprint: string;
  connectionName: string;
  onRenameConnection: (name: string) => void;
  totpConfigs?: TOTPConfig[];
  onUpdateTotpConfigs: (configs: TOTPConfig[]) => void;
  handleAutoTypeTOTP?: (code: string) => void;
  totpDefaultIssuer?: string;
  totpDefaultDigits?: number;
  totpDefaultPeriod?: number;
  totpDefaultAlgorithm?: string;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const btnBase = "p-1 hover:bg-[var(--color-border)] rounded transition-colors";
export const btnDefault = `${btnBase} text-[var(--color-textSecondary)] hover:text-[var(--color-text)]`;
export const btnActive = `${btnBase} text-[var(--color-text)] bg-[var(--color-border)]`;
export const btnDisabled = `${btnBase} text-[var(--color-textSecondary)] cursor-not-allowed`;
export const SEND_KEY_OPTIONS = [
  { id: "ctrl-alt-del", label: "Ctrl + Alt + Del" },
  { id: "alt-tab", label: "Alt + Tab" },
  { id: "win", label: "Windows Key" },
  { id: "win-l", label: "Win + L (Lock)" },
  { id: "win-r", label: "Win + R (Run)" },
  { id: "alt-f4", label: "Alt + F4" },
  { id: "print-screen", label: "Print Screen" },
] as const;

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */
