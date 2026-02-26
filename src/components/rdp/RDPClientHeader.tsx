import React, { useState, useRef, useEffect } from 'react';
import {
  Monitor,
  Activity,
  Settings,
  Camera,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Circle,
  Play,
  Pause,
  Square,
  Search,
  Maximize2,
  Minimize2,
  RefreshCw,
  Unplug,
  Keyboard,
  Shield,
  Fingerprint,
  Info,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { TOTPConfig } from '../../types/settings';
import RDPTotpPanel from './RDPTotpPanel';

interface RDPClientHeaderProps {
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
  connectionId: string;
  certFingerprint: string;
  connectionName: string;
  onRenameConnection: (name: string) => void;
  totpConfigs?: TOTPConfig[];
  onUpdateTotpConfigs: (configs: TOTPConfig[]) => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const btnBase = 'p-1 hover:bg-gray-700 rounded transition-colors';
const btnDefault = `${btnBase} text-gray-400 hover:text-white`;
const btnActive = `${btnBase} text-white bg-gray-700`;
const btnDisabled = `${btnBase} text-gray-600 cursor-not-allowed`;

export default function RDPClientHeader({
  sessionName,
  sessionHostname,
  connectionStatus,
  statusMessage,
  desktopSize,
  colorDepth,
  perfLabel,
  magnifierEnabled,
  magnifierActive,
  showInternals,
  showSettings,
  isFullscreen,
  recState,
  getStatusColor,
  getStatusIcon,
  setMagnifierActive,
  setShowInternals,
  setShowSettings,
  handleScreenshot,
  handleScreenshotToClipboard,
  handleStopRecording,
  toggleFullscreen,
  startRecording,
  pauseRecording,
  resumeRecording,
  handleReconnect,
  handleDisconnect,
  handleCopyToClipboard,
  handlePasteFromClipboard,
  handleSendKeys,
  certFingerprint,
  connectionName,
  onRenameConnection,
  totpConfigs,
  onUpdateTotpConfigs,
}: RDPClientHeaderProps) {
  const [showSendKeys, setShowSendKeys] = useState(false);
  const [showHostInfo, setShowHostInfo] = useState(false);
  const [showTotpPanel, setShowTotpPanel] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(connectionName);
  const sendKeysRef = useRef<HTMLDivElement>(null);
  const hostInfoRef = useRef<HTMLDivElement>(null);
  const totpBtnRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isConnected = connectionStatus === 'connected';
  const canReconnect = connectionStatus === 'disconnected' || connectionStatus === 'error';
  const canDisconnect = connectionStatus === 'connected' || connectionStatus === 'connecting';
  const configs = totpConfigs ?? [];

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sendKeysRef.current && !sendKeysRef.current.contains(e.target as Node)) {
        setShowSendKeys(false);
      }
      if (hostInfoRef.current && !hostInfoRef.current.contains(e.target as Node)) {
        setShowHostInfo(false);
      }
      if (totpBtnRef.current && !totpBtnRef.current.contains(e.target as Node)) {
        setShowTotpPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus name input when entering edit mode
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const startEditing = () => {
    setEditName(connectionName);
    setIsEditingName(true);
  };

  const confirmRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== connectionName) {
      onRenameConnection(trimmed);
    }
    setIsEditingName(false);
  };

  const cancelRename = () => {
    setEditName(connectionName);
    setIsEditingName(false);
  };

  return (
    <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <Monitor size={16} className="text-gray-400" />
        <span className="text-sm text-gray-300">
          RDP - {sessionName !== sessionHostname ? `${sessionName} (${sessionHostname})` : sessionHostname}
        </span>
        <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
          {getStatusIcon()}
          <span className="text-xs capitalize">{connectionStatus}</span>
        </div>
        {statusMessage && (
          <span className="text-xs text-gray-500 ml-2 truncate max-w-xs">{statusMessage}</span>
        )}
      </div>

      <div className="flex items-center space-x-1">
        <div className="flex items-center space-x-1 text-xs text-gray-400 mr-2">
          <span>{desktopSize.width}x{desktopSize.height}</span>
          <span>·</span>
          <span>{colorDepth}-bit</span>
          <span>·</span>
          <span className="capitalize">{perfLabel}</span>
        </div>

        {/* ── Connection controls ─────────────────────────────── */}
        <button
          onClick={handleReconnect}
          className={canReconnect ? btnDefault : btnDisabled}
          disabled={!canReconnect}
          title="Reconnect"
        >
          <RefreshCw size={14} />
        </button>

        <button
          onClick={handleDisconnect}
          className={canDisconnect ? btnDefault : btnDisabled}
          disabled={!canDisconnect}
          title="Disconnect"
        >
          <Unplug size={14} />
        </button>

        <div className="w-px h-4 bg-gray-600 mx-1" />

        {/* ── Clipboard ──────────────────────────────────────── */}
        <button
          onClick={handleCopyToClipboard}
          className={isConnected ? btnDefault : btnDisabled}
          disabled={!isConnected}
          title="Copy to clipboard"
        >
          <Copy size={14} />
        </button>

        <button
          onClick={handlePasteFromClipboard}
          className={isConnected ? btnDefault : btnDisabled}
          disabled={!isConnected}
          title="Paste from clipboard"
        >
          <ClipboardPaste size={14} />
        </button>

        <div className="w-px h-4 bg-gray-600 mx-1" />

        {/* ── Send Keys (separate button) ────────────────────── */}
        <div ref={sendKeysRef} className="relative">
          <button
            onClick={() => setShowSendKeys(!showSendKeys)}
            className={showSendKeys ? btnActive : btnDefault}
            title="Send key combination"
          >
            <Keyboard size={14} />
          </button>

          {showSendKeys && (
            <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden">
              {[
                { id: 'ctrl-alt-del', label: 'Ctrl + Alt + Del' },
                { id: 'alt-tab', label: 'Alt + Tab' },
                { id: 'win', label: 'Windows Key' },
                { id: 'alt-f4', label: 'Alt + F4' },
                { id: 'print-screen', label: 'Print Screen' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    handleSendKeys(item.id);
                    setShowSendKeys(false);
                  }}
                  disabled={!isConnected}
                  className={`w-full text-left px-3 py-1.5 text-xs ${
                    isConnected
                      ? 'text-gray-300 hover:bg-gray-700 hover:text-white'
                      : 'text-gray-600 cursor-not-allowed'
                  } transition-colors`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Host Info (separate button) ────────────────────── */}
        <div ref={hostInfoRef} className="relative">
          <button
            onClick={() => setShowHostInfo(!showHostInfo)}
            className={showHostInfo ? btnActive : btnDefault}
            title="Host info &amp; certificate"
          >
            <Info size={14} />
          </button>

          {showHostInfo && (
            <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden">
              {/* Friendly Name */}
              <div className="px-3 py-2 border-b border-gray-700">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Friendly Name
                </div>
                {isEditingName ? (
                  <div className="flex items-center space-x-1">
                    <input
                      ref={nameInputRef}
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename();
                        if (e.key === 'Escape') cancelRename();
                      }}
                      className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"
                    />
                    <button
                      onClick={confirmRename}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={cancelRename}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-300">{connectionName}</span>
                    <button
                      onClick={startEditing}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                      title="Edit name"
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                )}
              </div>

              {/* Host Details */}
              <div className="px-3 py-2 border-b border-gray-700 space-y-1">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Host
                </div>
                <div className="text-xs text-gray-300">{sessionHostname}</div>
                <div className="text-[10px] text-gray-500">
                  Status: <span className="capitalize">{connectionStatus}</span>
                </div>
                <div className="text-[10px] text-gray-500">
                  Resolution: {desktopSize.width}x{desktopSize.height} · {colorDepth}-bit
                </div>
              </div>

              {/* Certificate Info */}
              <div className="px-3 py-2 space-y-1">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Certificate
                </div>
                <div className="flex items-start space-x-2">
                  <Fingerprint size={12} className="text-gray-500 flex-shrink-0 mt-0.5" />
                  <div className="text-[10px] text-gray-400 min-w-0">
                    {certFingerprint ? (
                      <span className="font-mono break-all">{certFingerprint}</span>
                    ) : (
                      <span className="italic">No certificate available</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 2FA / TOTP ─────────────────────────────────────── */}
        <div ref={totpBtnRef} className="relative">
          <button
            onClick={() => setShowTotpPanel(!showTotpPanel)}
            className={`${showTotpPanel ? btnActive : btnDefault} relative`}
            title="2FA Codes"
          >
            <Shield size={14} />
            {configs.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-gray-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {configs.length}
              </span>
            )}
          </button>

          {showTotpPanel && (
            <RDPTotpPanel
              configs={configs}
              onUpdate={onUpdateTotpConfigs}
              onClose={() => setShowTotpPanel(false)}
            />
          )}
        </div>

        <div className="w-px h-4 bg-gray-600 mx-1" />

        {/* ── Existing buttons ───────────────────────────────── */}
        {magnifierEnabled && (
          <button
            onClick={() => setMagnifierActive(!magnifierActive)}
            className={magnifierActive ? btnActive : btnDefault}
            title="Magnifier Glass"
          >
            <Search size={14} />
          </button>
        )}

        <button
          onClick={() => setShowInternals(!showInternals)}
          className={showInternals ? btnActive : btnDefault}
          title="RDP Internals"
        >
          <Activity size={14} />
        </button>

        <button
          onClick={() => setShowSettings(!showSettings)}
          className={btnDefault}
          title="RDP Settings"
        >
          <Settings size={14} />
        </button>

        {/* Screenshot to file */}
        <button
          onClick={handleScreenshot}
          className={btnDefault}
          title="Save screenshot to file"
        >
          <Camera size={14} />
        </button>
        {/* Screenshot to clipboard */}
        <button
          onClick={handleScreenshotToClipboard}
          className={btnDefault}
          title="Copy screenshot to clipboard"
        >
          <ClipboardCopy size={14} />
        </button>

        {/* Recording */}
        {!recState.isRecording ? (
          <button
            onClick={() => startRecording('webm')}
            className={btnDefault}
            title="Start recording"
          >
            <Circle size={14} className="fill-current" />
          </button>
        ) : (
          <div className="flex items-center space-x-1">
            <span className="text-[10px] text-gray-400 animate-pulse font-mono">
              REC {formatDuration(recState.duration)}
            </span>
            {recState.isPaused ? (
              <button
                onClick={resumeRecording}
                className={btnDefault}
                title="Resume recording"
              >
                <Play size={12} />
              </button>
            ) : (
              <button
                onClick={pauseRecording}
                className={btnDefault}
                title="Pause recording"
              >
                <Pause size={12} />
              </button>
            )}
            <button
              onClick={handleStopRecording}
              className={btnDefault}
              title="Stop and save recording"
            >
              <Square size={12} className="fill-current" />
            </button>
          </div>
        )}

        <button
          onClick={toggleFullscreen}
          className={btnDefault}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
}
