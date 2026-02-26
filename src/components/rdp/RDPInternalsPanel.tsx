import React from 'react';
import { Activity, X } from 'lucide-react';
import { formatBytes, formatUptime } from '../../utils/rdpFormatters';
import type { RdpStatsEvent, RdpTimingEvent } from '../../types/rdpEvents';
import type { RdpConnectionSettings } from '../../types/connection';

interface RDPInternalsPanelProps {
  stats: RdpStatsEvent | null;
  connectTiming: RdpTimingEvent | null;
  rdpSettings: RdpConnectionSettings;
  activeRenderBackend: string;
  activeFrontendRenderer: string;
  onClose: () => void;
}

export const RDPInternalsPanel: React.FC<RDPInternalsPanelProps> = ({
  stats, connectTiming, rdpSettings, activeRenderBackend, activeFrontendRenderer, onClose,
}) => (
  <div className="bg-gray-800 border-b border-gray-700 p-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
        <Activity size={14} className="text-green-400" />
        RDP Session Internals
      </h3>
      <button onClick={onClose} className="text-gray-400 hover:text-white">
        <X size={14} />
      </button>
    </div>
    {stats ? (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Phase</div>
          <div className="text-white font-mono capitalize">{stats.phase}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Uptime</div>
          <div className="text-white font-mono">{formatUptime(stats.uptime_secs)}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">FPS</div>
          <div className={`font-mono font-bold ${stats.fps >= 20 ? 'text-green-400' : stats.fps >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>
            {stats.fps.toFixed(1)}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Frames</div>
          <div className="text-white font-mono">{stats.frame_count.toLocaleString()}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Received</div>
          <div className="text-cyan-400 font-mono">{formatBytes(stats.bytes_received)}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Sent</div>
          <div className="text-orange-400 font-mono">{formatBytes(stats.bytes_sent)}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">PDUs In</div>
          <div className="text-white font-mono">{stats.pdus_received.toLocaleString()}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">PDUs Out</div>
          <div className="text-white font-mono">{stats.pdus_sent.toLocaleString()}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Input Events</div>
          <div className="text-white font-mono">{stats.input_events.toLocaleString()}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Reactivations</div>
          <div className="text-white font-mono">{stats.reactivations}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Errors (Recovered)</div>
          <div className={`font-mono ${stats.errors_recovered > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
            {stats.errors_recovered}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Bandwidth</div>
          <div className="text-white font-mono">
            {stats.uptime_secs > 0 ? formatBytes(Math.round(stats.bytes_received / stats.uptime_secs)) : '0 B'}/s
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Avg Frame Size</div>
          <div className="text-white font-mono">
            {stats.frame_count > 0 ? formatBytes(Math.round(stats.bytes_received / stats.frame_count)) : '\u2013'}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">PDU Rate</div>
          <div className="text-white font-mono">
            {stats.uptime_secs > 0 ? `${(stats.pdus_received / stats.uptime_secs).toFixed(0)}/s` : '\u2013'}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Frame Batching</div>
          <div className={`font-mono ${rdpSettings.performance?.frameBatching ? 'text-green-400' : 'text-yellow-400'}`}>
            {rdpSettings.performance?.frameBatching ? `On @ ${rdpSettings.performance?.frameBatchIntervalMs ?? 33}ms` : 'Off'}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Read Timeout</div>
          <div className="text-white font-mono">{rdpSettings.advanced?.readTimeoutMs ?? 16}ms</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Target FPS</div>
          <div className="text-white font-mono">{rdpSettings.performance?.targetFps ?? 30}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Sync Interval</div>
          <div className="text-white font-mono">every {rdpSettings.advanced?.fullFrameSyncInterval ?? 300} frames</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Render Backend</div>
          <div className={`font-mono font-bold ${
            activeRenderBackend === 'wgpu' ? 'text-purple-400' :
            activeRenderBackend === 'softbuffer' ? 'text-blue-400' : 'text-gray-300'
          }`}>
            {activeRenderBackend}
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 mb-1">Frontend Renderer</div>
          <div className={`font-mono font-bold ${
            activeFrontendRenderer.includes('WebGPU') ? 'text-purple-400' :
            activeFrontendRenderer.includes('WebGL') ? 'text-green-400' :
            activeFrontendRenderer.includes('Worker') ? 'text-cyan-400' : 'text-blue-400'
          }`}>
            {activeFrontendRenderer}
          </div>
        </div>
        {stats.last_error && (
          <div className="bg-gray-900 rounded p-2 col-span-2 md:col-span-4 lg:col-span-6">
            <div className="text-gray-500 mb-1">Last Error</div>
            <div className="text-red-400 font-mono truncate" title={stats.last_error}>{stats.last_error}</div>
          </div>
        )}
      </div>
    ) : (
      <p className="text-gray-500 text-xs">Waiting for session statistics...</p>
    )}

    {connectTiming && (
      <div className="mt-3 border-t border-gray-700 pt-3">
        <h4 className="text-xs font-semibold text-gray-300 mb-2">Connection Timing</h4>
        <div className="flex items-center gap-1 text-xs h-6">
          {[
            { label: 'DNS', ms: connectTiming.dns_ms, color: 'bg-purple-500' },
            { label: 'TCP', ms: connectTiming.tcp_ms, color: 'bg-blue-500' },
            { label: 'Negotiate', ms: connectTiming.negotiate_ms, color: 'bg-cyan-500' },
            { label: 'TLS', ms: connectTiming.tls_ms, color: 'bg-green-500' },
            { label: 'Auth', ms: connectTiming.auth_ms, color: 'bg-orange-500' },
          ].map((phase) => {
            const pct = connectTiming.total_ms > 0 ? Math.max((phase.ms / connectTiming.total_ms) * 100, 4) : 20;
            return (
              <div
                key={phase.label}
                className={`${phase.color} rounded h-full flex items-center justify-center text-white font-mono`}
                style={{ width: `${pct}%`, minWidth: '40px' }}
                title={`${phase.label}: ${phase.ms}ms`}
              >
                {phase.ms}ms
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          {[
            { label: 'DNS', color: 'bg-purple-500' },
            { label: 'TCP', color: 'bg-blue-500' },
            { label: 'Negotiate', color: 'bg-cyan-500' },
            { label: 'TLS', color: 'bg-green-500' },
            { label: 'Auth', color: 'bg-orange-500' },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1">
              <span className={`inline-block w-2 h-2 rounded-sm ${l.color}`} />
              {l.label}
            </span>
          ))}
          <span className="ml-auto font-mono text-gray-400">Total: {connectTiming.total_ms}ms</span>
        </div>
      </div>
    )}
  </div>
);

export default RDPInternalsPanel;
