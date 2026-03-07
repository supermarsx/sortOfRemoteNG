import React from 'react';
import { Activity, X } from 'lucide-react';
import { formatBytes, formatUptime } from '../../utils/rdp/rdpFormatters';
import type { RDPStatsEvent, RDPTimingEvent } from '../../types/rdp/rdpEvents';
import type { RDPConnectionSettings } from '../../types/connection/connection';

interface RDPInternalsPanelProps {
  stats: RDPStatsEvent | null;
  connectTiming: RDPTimingEvent | null;
  rdpSettings: RDPConnectionSettings;
  activeRenderBackend: string;
  activeFrontendRenderer: string;
  onClose: () => void;
}

export const RDPInternalsPanel: React.FC<RDPInternalsPanelProps> = ({
  stats, connectTiming, rdpSettings, activeRenderBackend, activeFrontendRenderer, onClose,
}) => (
  <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-[var(--color-textSecondary)] flex items-center gap-2">
        <Activity size={14} className="text-success" />
        RDP Session Internals
      </h3>
      <button onClick={onClose} className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
        <X size={14} />
      </button>
    </div>
    {stats ? (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Phase</div>
          <div className="text-[var(--color-text)] font-mono capitalize">{stats.phase}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Uptime</div>
          <div className="text-[var(--color-text)] font-mono">{formatUptime(stats.uptime_secs)}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">FPS</div>
          <div className={`font-mono font-bold ${stats.fps >= 20 ? 'text-success' : stats.fps >= 10 ? 'text-warning' : 'text-error'}`}>
            {stats.fps.toFixed(1)}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Frames</div>
          <div className="text-[var(--color-text)] font-mono">{stats.frame_count.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Received</div>
          <div className="text-info font-mono">{formatBytes(stats.bytes_received)}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Sent</div>
          <div className="text-warning font-mono">{formatBytes(stats.bytes_sent)}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">PDUs In</div>
          <div className="text-[var(--color-text)] font-mono">{stats.pdus_received.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">PDUs Out</div>
          <div className="text-[var(--color-text)] font-mono">{stats.pdus_sent.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Input Events</div>
          <div className="text-[var(--color-text)] font-mono">{stats.input_events.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Reactivations</div>
          <div className="text-[var(--color-text)] font-mono">{stats.reactivations}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Errors (Recovered)</div>
          <div className={`font-mono ${stats.errors_recovered > 0 ? 'text-warning' : 'text-success'}`}>
            {stats.errors_recovered}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Bandwidth</div>
          <div className="text-[var(--color-text)] font-mono">
            {stats.uptime_secs > 0 ? formatBytes(Math.round(stats.bytes_received / stats.uptime_secs)) : '0 B'}/s
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Avg Frame Size</div>
          <div className="text-[var(--color-text)] font-mono">
            {stats.frame_count > 0 ? formatBytes(Math.round(stats.bytes_received / stats.frame_count)) : '\u2013'}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">PDU Rate</div>
          <div className="text-[var(--color-text)] font-mono">
            {stats.uptime_secs > 0 ? `${(stats.pdus_received / stats.uptime_secs).toFixed(0)}/s` : '\u2013'}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Frame Batching</div>
          <div className={`font-mono ${rdpSettings.performance?.frameBatching ? 'text-success' : 'text-warning'}`}>
            {rdpSettings.performance?.frameBatching ? `On @ ${rdpSettings.performance?.frameBatchIntervalMs ?? 33}ms` : 'Off'}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Read Timeout</div>
          <div className="text-[var(--color-text)] font-mono">{rdpSettings.advanced?.readTimeoutMs ?? 16}ms</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Target FPS</div>
          <div className="text-[var(--color-text)] font-mono">{rdpSettings.performance?.targetFps ?? 30}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Sync Interval</div>
          <div className="text-[var(--color-text)] font-mono">every {rdpSettings.advanced?.fullFrameSyncInterval ?? 300} frames</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Render Backend</div>
          <div className={`font-mono font-bold ${
            activeRenderBackend === 'wgpu' ? 'text-accent' :
            activeRenderBackend === 'softbuffer' ? 'text-primary' : 'text-[var(--color-textSecondary)]'
          }`}>
            {activeRenderBackend}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">Frontend Renderer</div>
          <div className={`font-mono font-bold ${
            activeFrontendRenderer.includes('WebGPU') ? 'text-accent' :
            activeFrontendRenderer.includes('WebGL') ? 'text-success' :
            activeFrontendRenderer.includes('Worker') ? 'text-info' : 'text-primary'
          }`}>
            {activeFrontendRenderer}
          </div>
        </div>
        {stats.last_error && (
          <div className="bg-[var(--color-background)] rounded p-2 col-span-2 md:col-span-4 lg:col-span-6">
            <div className="text-[var(--color-textMuted)] mb-1">Last Error</div>
            <div className="text-error font-mono truncate" title={stats.last_error}>{stats.last_error}</div>
          </div>
        )}
      </div>
    ) : (
      <p className="text-[var(--color-textMuted)] text-xs">Waiting for session statistics...</p>
    )}

    {connectTiming && (
      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <h4 className="text-xs font-semibold text-[var(--color-textSecondary)] mb-2">Connection Timing</h4>
        <div className="flex items-center gap-1 text-xs h-6">
          {[
            { label: 'DNS', ms: connectTiming.dns_ms, color: 'bg-accent' },
            { label: 'TCP', ms: connectTiming.tcp_ms, color: 'bg-primary' },
            { label: 'Negotiate', ms: connectTiming.negotiate_ms, color: 'bg-info' },
            { label: 'TLS', ms: connectTiming.tls_ms, color: 'bg-success' },
            { label: 'Auth', ms: connectTiming.auth_ms, color: 'bg-warning' },
          ].map((phase) => {
            const pct = connectTiming.total_ms > 0 ? Math.max((phase.ms / connectTiming.total_ms) * 100, 4) : 20;
            return (
              <div
                key={phase.label}
                className={`${phase.color} rounded h-full flex items-center justify-center text-[var(--color-text)] font-mono`}
                style={{ width: `${pct}%`, minWidth: '40px' }}
                title={`${phase.label}: ${phase.ms}ms`}
              >
                {phase.ms}ms
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-textMuted)]">
          {[
            { label: 'DNS', color: 'bg-accent' },
            { label: 'TCP', color: 'bg-primary' },
            { label: 'Negotiate', color: 'bg-info' },
            { label: 'TLS', color: 'bg-success' },
            { label: 'Auth', color: 'bg-warning' },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1">
              <span className={`inline-block w-2 h-2 rounded-sm ${l.color}`} />
              {l.label}
            </span>
          ))}
          <span className="ml-auto font-mono text-[var(--color-textSecondary)]">Total: {connectTiming.total_ms}ms</span>
        </div>
      </div>
    )}
  </div>
);

export default RDPInternalsPanel;
