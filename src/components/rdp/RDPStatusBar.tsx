import React from 'react';
import {
  MousePointer,
  Keyboard,
  Volume2,
  VolumeX,
  Copy,
  Search,
  Printer,
  Usb,
  CreditCard,
  Video,
  Mic,
  MicOff,
  Cable,
  ShieldCheck,
  FolderInput,
  HardDrive,
  type LucideIcon,
} from 'lucide-react';
import { formatBytes } from '../../utils/rdp/rdpFormatters';
import { StatusBar } from '../ui/display';
import type { RDPStatsEvent } from '../../types/rdp/rdpEvents';
import type { RDPConnectionSettings } from '../../types/connection/connection';

type RedirectionKey = keyof NonNullable<RDPConnectionSettings['deviceRedirection']>;

interface RDPStatusBarProps {
  rdpSessionId: string | null;
  sessionId: string;
  isConnected: boolean;
  desktopSize: { width: number; height: number };
  stats: RDPStatsEvent | null;
  certFingerprint: string | null;
  audioEnabled: boolean;
  clipboardEnabled: boolean;
  magnifierActive: boolean;
  mouseEnabled: boolean;
  keyboardEnabled: boolean;
  rdpSettings?: RDPConnectionSettings;
  onToggleInput: (key: 'mouseEnabled' | 'keyboardEnabled', value: boolean) => void;
  onToggleRedirection: (key: RedirectionKey, value: boolean) => void;
  onToggleAudio: (enabled: boolean) => void;
}

interface RedirectionItem {
  key: RedirectionKey;
  label: string;
  icon: LucideIcon;
}

const REDIRECTIONS: RedirectionItem[] = [
  { key: 'clipboard', label: 'Clipboard', icon: Copy },
  { key: 'audioInput', label: 'Microphone', icon: Mic },
  { key: 'printers', label: 'Printers', icon: Printer },
  { key: 'ports', label: 'Ports', icon: Cable },
  { key: 'smartCards', label: 'Smart Cards', icon: CreditCard },
  { key: 'usbDevices', label: 'USB Devices', icon: Usb },
  { key: 'videoCapture', label: 'Video Capture', icon: Video },
  { key: 'webAuthn', label: 'WebAuthn', icon: ShieldCheck },
  { key: 'fileDragDrop', label: 'File Drag & Drop', icon: FolderInput },
  { key: 'driveRedirection', label: 'Drive Redirection', icon: HardDrive },
];

const ToggleButton: React.FC<{
  enabled: boolean;
  label: string;
  icon: LucideIcon;
  onToggle: () => void;
}> = ({ enabled, label, icon: Icon, onToggle }) => (
  <button
    onClick={onToggle}
    className={`p-0.5 rounded transition-colors ${
      enabled
        ? 'text-[var(--color-text)] hover:text-[var(--color-textSecondary)]'
        : 'text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] opacity-40'
    }`}
    data-tooltip={`${label}: ${enabled ? 'On' : 'Off'} (click to toggle)`}
  >
    <Icon size={12} />
  </button>
);

export const RDPStatusBar: React.FC<RDPStatusBarProps> = ({
  rdpSessionId, sessionId, isConnected, desktopSize, stats,
  certFingerprint, audioEnabled, magnifierActive,
  mouseEnabled, keyboardEnabled,
  rdpSettings, onToggleInput, onToggleRedirection, onToggleAudio,
}) => {
  const deviceRedirection = rdpSettings?.deviceRedirection;

  return (
    <StatusBar
      left={
        <div className="flex items-center space-x-4">
          <span>Session: {(rdpSessionId || sessionId).slice(0, 8)}</span>
          <span>Protocol: RDP</span>
          {isConnected && (
            <>
              <span>Desktop: {desktopSize.width}x{desktopSize.height}</span>
              <span>Encryption: TLS/NLA</span>
              {stats && (
                <>
                  <span className="text-success">{stats.fps.toFixed(0)} FPS</span>
                  <span>{'\u2193'}{formatBytes(stats.bytes_received)}</span>
                  <span>{'\u2191'}{formatBytes(stats.bytes_sent)}</span>
                </>
              )}
              {certFingerprint && (
                <span className="text-info" data-tooltip={`SHA256:${certFingerprint}`}>
                  Cert: {certFingerprint.slice(0, 11)}{'\u2026'}
                </span>
              )}
            </>
          )}
        </div>
      }
      right={
        <div className="flex items-center space-x-1">
          {/* Input devices */}
          <ToggleButton
            enabled={mouseEnabled}
            label="Mouse"
            icon={MousePointer}
            onToggle={() => onToggleInput('mouseEnabled', !mouseEnabled)}
          />
          <ToggleButton
            enabled={keyboardEnabled}
            label="Keyboard"
            icon={Keyboard}
            onToggle={() => onToggleInput('keyboardEnabled', !keyboardEnabled)}
          />

          <span className="mx-0.5 w-px h-3 bg-[var(--color-border)]" />

          {/* Audio playback */}
          <ToggleButton
            enabled={audioEnabled}
            label="Audio"
            icon={audioEnabled ? Volume2 : VolumeX}
            onToggle={() => onToggleAudio(!audioEnabled)}
          />

          {/* Device redirections */}
          {REDIRECTIONS.map(({ key, label, icon }) => {
            const enabled = deviceRedirection?.[key] ?? false;
            return (
              <ToggleButton
                key={key}
                enabled={!!enabled}
                label={label}
                icon={key === 'audioInput' ? (enabled ? Mic : MicOff) : icon}
                onToggle={() => onToggleRedirection(key, !enabled)}
              />
            );
          })}

          {magnifierActive && (
            <>
              <span className="mx-0.5 w-px h-3 bg-[var(--color-border)]" />
              <Search size={12} className="text-primary" />
            </>
          )}
        </div>
      }
    />
  );
};

export default RDPStatusBar;
