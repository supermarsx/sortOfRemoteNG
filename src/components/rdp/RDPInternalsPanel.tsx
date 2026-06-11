import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, X } from 'lucide-react';
import { formatUptime } from '../../utils/rdp/rdpFormatters';
import { formatBytes } from '../../utils/core/formatters';
import type {
  RDPLifecycleEvent,
  RDPStatsEvent,
  RDPTimingEvent,
  RdpFramePressureState,
  RdpFrameBackpressureUpdate,
} from '../../types/rdp/rdpEvents';
import type { RDPConnectionSettings } from '../../types/connection/connection';

interface RDPInternalsPanelProps {
  stats: RDPStatsEvent | null;
  lifecycle: RDPLifecycleEvent | null;
  connectTiming: RDPTimingEvent | null;
  rdpSettings: RDPConnectionSettings;
  activeRenderBackend: string;
  activeFrontendRenderer: string;
  framePressureState?: RdpFramePressureState;
  frameBackpressureTelemetry?: RdpFrameBackpressureUpdate | null;
  onClose: () => void;
}

export const RDPInternalsPanel: React.FC<RDPInternalsPanelProps> = ({
  stats, lifecycle, connectTiming, rdpSettings, activeRenderBackend, activeFrontendRenderer,
  framePressureState, frameBackpressureTelemetry, onClose,
}) => {
  const { t } = useTranslation();
  const isWebCodecsFrontend = activeFrontendRenderer.toLowerCase().includes('webcodecs');
  const lifecycleSnapshot = lifecycle ?? stats?.lifecycle ?? null;
  const channelSummary = lifecycleSnapshot?.channelSummary ?? null;
  const frameFlow = lifecycleSnapshot?.frameFlowSummary ?? null;
  const noValue = '\u2013';
  return (
  <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-[var(--color-textSecondary)] flex items-center gap-2">
        <Activity size={14} className="text-success" />
        {t('rdpInternals.title', 'RDP Session Internals')}
      </h3>
      <button
        onClick={onClose}
        className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        aria-label={t('common.close', 'Close')}
      >
        <X size={14} />
      </button>
    </div>
    {stats ? (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.phase', 'Phase')}</div>
          <div className="text-[var(--color-text)] font-mono capitalize">{stats.phase}</div>
        </div>
        {lifecycleSnapshot && (
          <>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.lifecycle', 'Lifecycle')}</div>
              <div className="text-[var(--color-text)] font-mono">
                {lifecycleSnapshot.activeSubstate ?? lifecycleSnapshot.state}
              </div>
            </div>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.transitions', 'Transitions')}</div>
              <div className="text-[var(--color-text)] font-mono">{lifecycleSnapshot.transitionCount}</div>
            </div>
            {lifecycleSnapshot.reconnectAttempt > 0 && (
              <div className="bg-[var(--color-background)] rounded p-2">
                <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.reconnectAttempt', 'Reconnect Attempt')}</div>
                <div className="text-warning font-mono">{lifecycleSnapshot.reconnectAttempt}</div>
              </div>
            )}
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.failureClass', 'Failure Class')}</div>
              <div
                className={`font-mono truncate ${lifecycleSnapshot.lastFailureClass ? 'text-error' : 'text-[var(--color-textSecondary)]'}`}
                title={lifecycleSnapshot.lastFailureClass ?? undefined}
              >
                {lifecycleSnapshot.lastFailureClass ?? noValue}
              </div>
            </div>
          </>
        )}
        {channelSummary && (
          <>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.channelsEnabled', 'Channels Enabled')}</div>
              <div className="text-[var(--color-text)] font-mono">{channelSummary.enabledCount ?? 0}</div>
            </div>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.channelsReady', 'Channels Ready')}</div>
              <div className={`font-mono ${(channelSummary.readyCount ?? 0) >= (channelSummary.enabledCount ?? 0) ? 'text-success' : 'text-warning'}`}>
                {channelSummary.readyCount ?? 0}/{channelSummary.enabledCount ?? 0}
              </div>
            </div>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.channelFaults', 'Channel Faults')}</div>
              <div className={`font-mono ${(channelSummary.failedCount ?? 0) > 0 ? 'text-error' : 'text-success'}`}>
                {channelSummary.failedCount ?? 0}
              </div>
            </div>
          </>
        )}
        {frameFlow && (
          <>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.framesQueued', 'Frames Queued')}</div>
              <div className="text-[var(--color-text)] font-mono">{(frameFlow.queuedFrames ?? 0).toLocaleString()}</div>
            </div>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.framesDelivered', 'Frames Delivered')}</div>
              <div className="text-info font-mono">{(frameFlow.deliveredFrames ?? 0).toLocaleString()}</div>
            </div>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.framesDropped', 'Frames Dropped')}</div>
              <div className={`font-mono ${(frameFlow.droppedFrames ?? 0) > 0 ? 'text-warning' : 'text-success'}`}>
                {(frameFlow.droppedFrames ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.framesCoalesced', 'Frames Coalesced')}</div>
              <div className="text-[var(--color-text)] font-mono">
                {typeof frameFlow.coalescedFrames === 'number' ? frameFlow.coalescedFrames.toLocaleString() : noValue}
              </div>
            </div>
            <div className="bg-[var(--color-background)] rounded p-2">
              <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.avgRender', 'Avg Render')}</div>
              <div className="text-[var(--color-text)] font-mono">
                {typeof frameFlow.averageRenderMs === 'number' ? t('rdpInternals.value.ms', { ms: frameFlow.averageRenderMs.toFixed(1), defaultValue: '{{ms}}ms' }) : noValue}
              </div>
            </div>
          </>
        )}
        {framePressureState && (
          <div className="bg-[var(--color-background)] rounded p-2">
            <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.backpressure', 'Backpressure')}</div>
            <div className={`font-mono font-bold ${framePressureState === 'backpressured' ? 'text-error' : 'text-success'}`}>
              {framePressureState === 'backpressured'
                ? t('rdpInternals.backpressured', 'Backpressured')
                : t('rdpInternals.healthy', 'Healthy')}
            </div>
          </div>
        )}
        {frameBackpressureTelemetry && (
          <div className="bg-[var(--color-background)] rounded p-2">
            <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.queueDepth', 'Queue Depth')}</div>
            <div className={`font-mono ${frameBackpressureTelemetry.queueDepth > 0 ? 'text-warning' : 'text-[var(--color-text)]'}`}>
              {frameBackpressureTelemetry.queueDepth.toLocaleString()}
              {typeof frameBackpressureTelemetry.p95RenderMs === 'number'
                ? ` ${t('rdpInternals.value.p95Ms', { ms: frameBackpressureTelemetry.p95RenderMs.toFixed(1), defaultValue: '· p95 {{ms}}ms' })}`
                : ''}
            </div>
          </div>
        )}
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.uptime', 'Uptime')}</div>
          <div className="text-[var(--color-text)] font-mono">{formatUptime(stats.uptime_secs)}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.fps', 'FPS')}</div>
          <div className={`font-mono font-bold ${stats.fps >= 20 ? 'text-success' : stats.fps >= 10 ? 'text-warning' : 'text-error'}`}>
            {stats.fps.toFixed(1)}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.frames', 'Frames')}</div>
          <div className="text-[var(--color-text)] font-mono">{stats.frame_count.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.received', 'Received')}</div>
          <div className="text-info font-mono">{formatBytes(stats.bytes_received)}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.sent', 'Sent')}</div>
          <div className="text-warning font-mono">{formatBytes(stats.bytes_sent)}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.pdusIn', 'PDUs In')}</div>
          <div className="text-[var(--color-text)] font-mono">{stats.pdus_received.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.pdusOut', 'PDUs Out')}</div>
          <div className="text-[var(--color-text)] font-mono">{stats.pdus_sent.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.inputEvents', 'Input Events')}</div>
          <div className="text-[var(--color-text)] font-mono">{stats.input_events.toLocaleString()}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.reactivations', 'Reactivations')}</div>
          <div className="text-[var(--color-text)] font-mono">{stats.reactivations}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.errorsRecovered', 'Errors (Recovered)')}</div>
          <div className={`font-mono ${stats.errors_recovered > 0 ? 'text-warning' : 'text-success'}`}>
            {stats.errors_recovered}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.bandwidth', 'Bandwidth')}</div>
          <div className="text-[var(--color-text)] font-mono">
            {stats.uptime_secs > 0 ? formatBytes(Math.round(stats.bytes_received / stats.uptime_secs)) : '0 B'}/s
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.avgFrameSize', 'Avg Frame Size')}</div>
          <div className="text-[var(--color-text)] font-mono">
            {stats.frame_count > 0 ? formatBytes(Math.round(stats.bytes_received / stats.frame_count)) : noValue}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.pduRate', 'PDU Rate')}</div>
          <div className="text-[var(--color-text)] font-mono">
            {stats.uptime_secs > 0 ? `${(stats.pdus_received / stats.uptime_secs).toFixed(0)}/s` : noValue}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.frameBatching', 'Frame Batching')}</div>
          <div className={`font-mono ${rdpSettings.performance?.frameBatching ? 'text-success' : 'text-warning'}`}>
            {rdpSettings.performance?.frameBatching
              ? t('rdpInternals.value.onAtMs', { ms: rdpSettings.performance?.frameBatchIntervalMs ?? 33, defaultValue: 'On @ {{ms}}ms' })
              : t('rdpInternals.value.off', 'Off')}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.readTimeout', 'Read Timeout')}</div>
          <div className="text-[var(--color-text)] font-mono">{rdpSettings.advanced?.readTimeoutMs ?? 16}ms</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.targetFps', 'Target FPS')}</div>
          <div className="text-[var(--color-text)] font-mono">{rdpSettings.performance?.targetFps ?? 30}</div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.syncInterval', 'Sync Interval')}</div>
          <div className="text-[var(--color-text)] font-mono">
            {t('rdpInternals.value.everyFrames', {
              count: rdpSettings.advanced?.fullFrameSyncInterval ?? 300,
              defaultValue: 'every {{count}} frames',
            })}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.renderBackend', 'Render Backend')}</div>
          <div className={`font-mono font-bold ${
            isWebCodecsFrontend ? 'text-[var(--color-warning)]' :
            activeRenderBackend === 'wgpu' ? 'text-primary' :
            activeRenderBackend === 'softbuffer' ? 'text-primary' : 'text-[var(--color-textSecondary)]'
          }`}>
            {isWebCodecsFrontend ? 'passthrough' : activeRenderBackend}
          </div>
        </div>
        <div className="bg-[var(--color-background)] rounded p-2">
          <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.frontendRenderer', 'Frontend Renderer')}</div>
          <div className={`font-mono font-bold ${
            activeFrontendRenderer.includes('WebGPU') ? 'text-primary' :
            activeFrontendRenderer.includes('WebGL') ? 'text-success' :
            activeFrontendRenderer.includes('Worker') ? 'text-info' : 'text-primary'
          }`}>
            {activeFrontendRenderer}
          </div>
        </div>
        {stats.last_error && (
          <div className="bg-[var(--color-background)] rounded p-2 col-span-2 md:col-span-4 lg:col-span-6">
            <div className="text-[var(--color-textMuted)] mb-1">{t('rdpInternals.lastError', 'Last Error')}</div>
            <div className="text-error font-mono truncate" title={stats.last_error}>{stats.last_error}</div>
          </div>
        )}
      </div>
    ) : (
      <p className="text-[var(--color-textMuted)] text-xs">
        {t('rdpInternals.waitingForStats', 'Waiting for session statistics...')}
      </p>
    )}

    {connectTiming && (
      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <h4 className="text-xs font-semibold text-[var(--color-textSecondary)] mb-2">{t('rdpInternals.connectionTiming', 'Connection Timing')}</h4>
        <div className="flex items-center gap-1 text-xs h-6">
          {[
            { label: t('rdpInternals.timing.dns', 'DNS'), ms: connectTiming.dns_ms, color: 'bg-primary' },
            { label: t('rdpInternals.timing.tcp', 'TCP'), ms: connectTiming.tcp_ms, color: 'bg-primary' },
            { label: t('rdpInternals.timing.negotiate', 'Negotiate'), ms: connectTiming.negotiate_ms, color: 'bg-info' },
            { label: t('rdpInternals.timing.tls', 'TLS'), ms: connectTiming.tls_ms, color: 'bg-success' },
            { label: t('rdpInternals.timing.auth', 'Auth'), ms: connectTiming.auth_ms, color: 'bg-warning' },
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
            { label: t('rdpInternals.timing.dns', 'DNS'), color: 'bg-primary' },
            { label: t('rdpInternals.timing.tcp', 'TCP'), color: 'bg-primary' },
            { label: t('rdpInternals.timing.negotiate', 'Negotiate'), color: 'bg-info' },
            { label: t('rdpInternals.timing.tls', 'TLS'), color: 'bg-success' },
            { label: t('rdpInternals.timing.auth', 'Auth'), color: 'bg-warning' },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1">
              <span className={`inline-block w-2 h-2 rounded-sm ${l.color}`} />
              {l.label}
            </span>
          ))}
          <span className="ml-auto font-mono text-[var(--color-textSecondary)]">
            {t('rdpInternals.value.totalMs', { ms: connectTiming.total_ms, defaultValue: 'Total: {{ms}}ms' })}
          </span>
        </div>
      </div>
    )}
  </div>
  );
};

export default RDPInternalsPanel;
