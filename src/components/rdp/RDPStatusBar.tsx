import React from 'react';
import { MousePointer, Keyboard, Volume2, Copy, Search } from 'lucide-react';
import { formatBytes } from '../../utils/rdpFormatters';
import { StatusBar } from '../ui/display';
import type { RDPStatsEvent } from '../../types/rdpEvents';

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
}

export const RDPStatusBar: React.FC<RDPStatusBarProps> = ({
  rdpSessionId, sessionId, isConnected, desktopSize, stats,
  certFingerprint, audioEnabled, clipboardEnabled, magnifierActive,
}) => (
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
                <span className="text-green-400">{stats.fps.toFixed(0)} FPS</span>
                <span>{'\u2193'}{formatBytes(stats.bytes_received)}</span>
                <span>{'\u2191'}{formatBytes(stats.bytes_sent)}</span>
              </>
            )}
            {certFingerprint && (
              <span className="text-cyan-400" title={`SHA256:${certFingerprint}`}>
                Cert: {certFingerprint.slice(0, 11)}{'\u2026'}
              </span>
            )}
          </>
        )}
      </div>
    }
    right={
      <div className="flex items-center space-x-2">
        <MousePointer size={12} />
        <Keyboard size={12} />
        {audioEnabled && <Volume2 size={12} />}
        {clipboardEnabled && <Copy size={12} />}
        {magnifierActive && <Search size={12} className="text-blue-400" />}
      </div>
    }
  />
);

export default RDPStatusBar;
