import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { RdpConnectionSettings } from '../../types/connection';

interface RDPSettingsPanelProps {
  rdpSettings: RdpConnectionSettings;
  colorDepth: number;
  audioEnabled: boolean;
  clipboardEnabled: boolean;
  perfLabel: string;
  certFingerprint: string | null;
}

export function RDPSettingsPanel({
  rdpSettings,
  colorDepth,
  audioEnabled,
  clipboardEnabled,
  perfLabel,
  certFingerprint,
}: RDPSettingsPanelProps) {
  return (
    <div className="bg-gray-800 border-b border-gray-700 p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Resolution</div>
          <div className="text-white text-xs font-mono">{rdpSettings.display?.width ?? 1920}x{rdpSettings.display?.height ?? 1080}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Color Depth</div>
          <div className="text-white text-xs font-mono">{colorDepth}-bit</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Audio</div>
          <div className="text-white text-xs font-mono flex items-center gap-1">
            {audioEnabled ? <Volume2 size={12} className="text-green-400" /> : <VolumeX size={12} className="text-gray-600" />}
            {rdpSettings.audio?.playbackMode ?? 'local'}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Clipboard</div>
          <div className={`text-xs font-mono ${clipboardEnabled ? 'text-green-400' : 'text-gray-600'}`}>
            {clipboardEnabled ? 'Enabled' : 'Disabled'}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Speed Preset</div>
          <div className="text-white text-xs font-mono capitalize">{perfLabel}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Frame Batching</div>
          <div className={`text-xs font-mono ${rdpSettings.performance?.frameBatching ? 'text-green-400' : 'text-yellow-400'}`}>
            {rdpSettings.performance?.frameBatching ? `On (${rdpSettings.performance?.frameBatchIntervalMs ?? 33}ms)` : 'Off'}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Security</div>
          <div className="text-white text-xs font-mono">
            {rdpSettings.security?.enableNla ? 'NLA' : ''}{rdpSettings.security?.enableTls ? '+TLS' : ''}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Keyboard</div>
          <div className="text-white text-xs font-mono">
            0x{(rdpSettings.input?.keyboardLayout ?? 0x0409).toString(16).padStart(4, '0')}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Mouse Mode</div>
          <div className="text-white text-xs font-mono capitalize">{rdpSettings.input?.mouseMode ?? 'absolute'}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-xs mb-1">Perf Flags</div>
          <div className="text-white text-xs font-mono">
            {[
              rdpSettings.performance?.disableWallpaper && 'noWP',
              rdpSettings.performance?.disableFullWindowDrag && 'noDrag',
              rdpSettings.performance?.disableMenuAnimations && 'noAnim',
              rdpSettings.performance?.disableTheming && 'noTheme',
              rdpSettings.performance?.enableFontSmoothing && 'CT',
              rdpSettings.performance?.enableDesktopComposition && 'Aero',
            ].filter(Boolean).join(' ')}
          </div>
        </div>
        {certFingerprint && (
          <div className="bg-gray-900 rounded p-2 col-span-2">
            <div className="text-gray-500 text-xs mb-1">Server Certificate</div>
            <div className="text-cyan-400 text-xs font-mono truncate" title={certFingerprint}>
              SHA256:{certFingerprint.slice(0, 23)}…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
