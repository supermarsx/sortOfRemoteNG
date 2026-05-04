import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Ban,
  RotateCw,
} from 'lucide-react';
import type { Connection } from '@/types/connection/connection';
import type { CheckRow, PerResult, ProbeStatus } from '@/types/probes';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/overlays/Modal';
import { useBulkConnectionCheck, type UseBulkConnectionCheck } from '@/hooks/connection/useBulkConnectionCheck';

export interface CheckConnectionsModalProps {
  check: UseBulkConnectionCheck;
}

function statusKind(status: ProbeStatus): 'reachable' | 'refused' | 'timeout' | 'error' {
  switch (status.status) {
    case 'reachable':
      return 'reachable';
    case 'refused':
      return 'refused';
    case 'timeout':
      return 'timeout';
    case 'dns_failed':
    case 'other_error':
      return 'error';
  }
}

function RowIcon({ row }: { row: CheckRow }) {
  if (row.state === 'pending') {
    return <Circle size={16} className="text-[var(--color-textSecondary)] opacity-60" aria-hidden />;
  }
  if (row.state === 'probing' || !row.result) {
    return <Loader2 size={16} className="animate-spin text-[var(--color-primary)]" aria-hidden />;
  }
  const kind = statusKind(row.result.status);
  switch (kind) {
    case 'reachable':
      return <CheckCircle2 size={16} className="text-success" aria-hidden />;
    case 'refused':
      return <Ban size={16} className="text-warning" aria-hidden />;
    case 'timeout':
      return <Clock size={16} className="text-warning" aria-hidden />;
    case 'error':
      return <XCircle size={16} className="text-danger" aria-hidden />;
  }
}

function statusLabel(row: CheckRow, t: (key: string) => string): string {
  if (row.state === 'pending') return t('connections.checkStatus.pending');
  if (row.state === 'probing' || !row.result) return t('connections.checkStatus.probing');
  const kind = statusKind(row.result.status);
  switch (kind) {
    case 'reachable':
      return t('connections.checkStatus.reachable');
    case 'refused':
      return t('connections.checkStatus.refused');
    case 'timeout':
      return t('connections.checkStatus.timeout');
    case 'error':
      return t('connections.checkStatus.error');
  }
}

function extractBanner(result: PerResult | undefined): string | null {
  if (!result) return null;
  if (result.kind === 'ssh') return result.banner;
  return null;
}

function extractNla(result: PerResult | undefined): boolean | null {
  if (!result) return null;
  if (result.kind === 'rdp') return result.nla_required;
  return null;
}

function extractErrorDetail(result: PerResult | undefined): string | null {
  if (!result) return null;
  if (result.status.status === 'other_error') return result.status.detail;
  return null;
}

interface SummaryChipProps {
  kind: 'reachable' | 'refused' | 'timeout' | 'error';
  count: number;
  label: string;
  active: boolean;
  clickable: boolean;
  onClick?: () => void;
}

const SummaryChip: React.FC<SummaryChipProps> = ({ kind, count, label, active, clickable, onClick }) => {
  // Each status gets its own theme-tinted palette; bg/text use the matching
  // semantic CSS variables so dark and light themes both stay legible.
  const palette = {
    reachable: 'border-success/40 text-success bg-success/10 hover:bg-success/20',
    refused: 'border-warning/40 text-warning bg-warning/10',
    timeout: 'border-warning/40 text-warning bg-warning/10',
    error: 'border-error/40 text-error bg-error/10',
  }[kind];
  const dim = count === 0 ? 'opacity-50' : '';
  const ringed = active ? 'ring-2 ring-success/40' : '';
  const className = `inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full border transition-colors ${palette} ${dim} ${ringed}`;
  // Strip the count from the localized label so we can render it separately
  // with tabular-nums alignment. Translations are formatted as "{{count}} reachable"
  // (or equivalent in other locales); we leave the localized count form intact
  // when the simple replace doesn't match.
  const labelText = label.replace(new RegExp(`^\\s*${count}\\s*`), '');
  if (clickable) {
    return (
      <button type="button" onClick={onClick} className={className}>
        <span className="tabular-nums font-medium">{count}</span>
        <span className="opacity-90">{labelText}</span>
      </button>
    );
  }
  return (
    <span className={className}>
      <span className="tabular-nums font-medium">{count}</span>
      <span className="opacity-90">{labelText}</span>
    </span>
  );
};

type FilterKind = 'all' | 'reachable' | 'failed';

export const CheckConnectionsModal: React.FC<CheckConnectionsModalProps> = ({ check }) => {
  const { t } = useTranslation();
  const { isOpen, rows, total, completed, cancelled, error, cancel, close, open } = check;

  const titleId = 'check-connections-modal-title';
  const active = completed < total && !cancelled && !error;
  const canClose = !active;

  const progressPct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  // Reset filter when a new run opens.
  const [filter, setFilter] = useState<FilterKind>('all');
  useEffect(() => {
    if (isOpen) setFilter('all');
  }, [isOpen]);

  // Tally each status from the rows so the chip strip and footer stay in sync.
  const counts = useMemo(() => {
    const c = { reachable: 0, refused: 0, timeout: 0, error: 0, pending: 0 };
    for (const r of rows) {
      if (r.state !== 'done' || !r.result) {
        c.pending += 1;
        continue;
      }
      c[statusKind(r.result.status)] += 1;
    }
    return c;
  }, [rows]);

  const failedTotal = counts.refused + counts.timeout + counts.error;
  const isComplete = completed === total && total > 0 && !active;

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => {
      if (r.state !== 'done' || !r.result) return false;
      const kind = statusKind(r.result.status);
      return filter === 'reachable' ? kind === 'reachable' : kind !== 'reachable';
    });
  }, [rows, filter]);

  // aria-live announcement: last completed row.
  const lastAnnouncedRef = useRef<number>(0);
  const liveMessage = useMemo(() => {
    if (!isOpen) return '';
    if (error) return String(error);
    if (cancelled) return t('connections.checkCancel');
    const done = rows.filter((r) => r.state === 'done');
    if (done.length === 0) return '';
    const last = done[done.length - 1];
    return `${last.name}: ${statusLabel(last, t)}`;
  }, [isOpen, rows, cancelled, error, t]);

  useEffect(() => {
    lastAnnouncedRef.current = completed;
  }, [completed]);

  const handleClose = () => {
    if (!canClose) return;
    close();
  };

  const handleEscape = () => {
    if (active) {
      void cancel();
      return;
    }
    close();
  };

  // Reconstruct minimal Connection objects from rows so we can re-run.
  // The hook only needs id/name/hostname/port/protocol from the input list.
  const synthesizeConnections = (subset: CheckRow[]): Connection[] =>
    subset.map(
      (r) =>
        ({
          id: r.connectionId,
          name: r.name,
          hostname: r.host,
          port: r.port,
          protocol: r.protocol,
        }) as unknown as Connection,
    );

  const handleRerunAll = () => {
    if (!canClose || rows.length === 0) return;
    void open(synthesizeConnections(rows));
  };

  const handleRecheckFailed = () => {
    if (!canClose) return;
    const failed = rows.filter(
      (r) => r.state === 'done' && r.result && statusKind(r.result.status) !== 'reachable',
    );
    if (failed.length === 0) return;
    void open(synthesizeConnections(failed));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleEscape}
      closeOnEscape
      closeOnBackdrop={false}
      backdropClassName="bg-black/60 backdrop-blur-sm"
      panelClassName="relative max-w-2xl rounded-xl border border-[var(--color-border)] shadow-2xl shadow-primary/10 max-h-[85vh] overflow-hidden flex flex-col"
      contentClassName="relative bg-[var(--color-surface)] flex flex-col min-h-0"
      dataTestId="check-connections-modal"
    >
      <ModalHeader
        title={<span id={titleId}>{t('connections.checkAllTitle')}</span>}
        onClose={canClose ? close : undefined}
        showCloseButton={canClose}
      />

      <ModalBody className="flex flex-col gap-3 min-h-0">
        <div aria-labelledby={titleId} role="group">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-[var(--color-textSecondary)] tabular-nums">
              {completed}/{total}
              {isComplete && (
                <span className="ml-2 text-success">
                  · {t('connections.checkComplete')}
                </span>
              )}
            </span>
            <span className="text-[var(--color-textSecondary)] tabular-nums">{progressPct}%</span>
          </div>
          <div
            className="h-2 w-full rounded-full bg-[var(--color-border)] overflow-hidden"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('connections.checkAllTitle')}
          >
            <div
              className={`h-full transition-all ${
                isComplete && counts.reachable === total
                  ? 'bg-success'
                  : isComplete && counts.reachable === 0
                    ? 'bg-error'
                    : 'bg-[var(--color-primary)]'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Summary chip strip — clickable filters once the run completes. */}
        {(active || isComplete) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <SummaryChip
              kind="reachable"
              count={counts.reachable}
              label={t('connections.checkSummaryReachable', { count: counts.reachable })}
              active={filter === 'reachable'}
              clickable={isComplete && counts.reachable > 0}
              onClick={() => setFilter(filter === 'reachable' ? 'all' : 'reachable')}
            />
            {(counts.refused > 0 || isComplete) && (
              <SummaryChip
                kind="refused"
                count={counts.refused}
                label={t('connections.checkSummaryRefused', { count: counts.refused })}
                active={false}
                clickable={false}
              />
            )}
            {(counts.timeout > 0 || isComplete) && (
              <SummaryChip
                kind="timeout"
                count={counts.timeout}
                label={t('connections.checkSummaryTimeout', { count: counts.timeout })}
                active={false}
                clickable={false}
              />
            )}
            {(counts.error > 0 || isComplete) && (
              <SummaryChip
                kind="error"
                count={counts.error}
                label={t('connections.checkSummaryError', { count: counts.error })}
                active={false}
                clickable={false}
              />
            )}
            {isComplete && failedTotal > 0 && (
              <button
                type="button"
                className={`ml-auto px-2 py-0.5 text-xs rounded-full border transition-colors ${
                  filter === 'failed'
                    ? 'bg-warning/20 border-warning/50 text-warning'
                    : 'border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]'
                }`}
                onClick={() => setFilter(filter === 'failed' ? 'all' : 'failed')}
              >
                {filter === 'failed'
                  ? t('connections.checkAllTitle')
                  : t('connections.checkRecheckFailed')}
              </button>
            )}
          </div>
        )}

        {error && (
          <div
            className="flex items-center gap-2 rounded-md border border-danger/50 bg-danger/10 p-2 text-sm text-danger"
            role="alert"
          >
            <AlertTriangle size={16} aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div
          className="overflow-y-auto flex-1 min-h-0 rounded-md border border-[var(--color-border)] divide-y divide-[var(--color-border)]"
          data-testid="check-connections-rows"
        >
          {rows.length === 0 && (
            <div className="flex items-center gap-2 p-3 text-sm text-[var(--color-textSecondary)]">
              <Loader2 size={14} className="animate-spin text-[var(--color-primary)]" />
              {t('connections.checkInitial')}
            </div>
          )}
          {rows.length > 0 && filteredRows.length === 0 && (
            <div className="p-3 text-sm text-[var(--color-textSecondary)]">
              {filter === 'reachable'
                ? t('connections.checkNoneReachable')
                : t('connections.checkAllReachable')}
            </div>
          )}
          {filteredRows.map((row) => {
            const banner = extractBanner(row.result);
            const nla = extractNla(row.result);
            const detail = extractErrorDetail(row.result);
            return (
              <div
                key={row.connectionId}
                className="flex items-start gap-2 p-2 text-sm"
                data-testid="check-connections-row"
                data-connection-id={row.connectionId}
                data-state={row.state}
              >
                <div className="mt-0.5 shrink-0">
                  <RowIcon row={row} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{row.name}</span>
                    <span className="text-xs text-[var(--color-textSecondary)] truncate">
                      {row.host}:{row.port}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-textSecondary)] mt-0.5">
                    <span>{statusLabel(row, t)}</span>
                    {typeof row.elapsedMs === 'number' && (
                      <span>{t('connections.checkElapsedMs', { ms: row.elapsedMs })}</span>
                    )}
                    {nla === true && (
                      <span className="inline-flex items-center rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                        {t('connections.checkNlaRequired')}
                      </span>
                    )}
                    {banner && (
                      <span className="truncate" title={banner}>
                        {t('connections.checkBanner')}: {banner}
                      </span>
                    )}
                    {detail && (
                      <span className="truncate text-danger" title={detail}>
                        {detail}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {liveMessage}
        </div>
      </ModalBody>

      <ModalFooter className="flex justify-end gap-2">
        {active ? (
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            onClick={() => void cancel()}
            data-testid="check-connections-cancel"
          >
            {t('connections.checkCancel')}
          </button>
        ) : (
          <>
            {failedTotal > 0 && (
              <button
                type="button"
                className="sor-btn sor-btn-secondary inline-flex items-center gap-1.5"
                onClick={handleRecheckFailed}
                data-testid="check-connections-recheck-failed"
              >
                <RotateCw size={14} />
                {t('connections.checkRecheckFailed')}
              </button>
            )}
            <button
              type="button"
              className="sor-btn sor-btn-secondary inline-flex items-center gap-1.5"
              onClick={handleRerunAll}
              disabled={rows.length === 0}
              data-testid="check-connections-rerun"
            >
              <RotateCw size={14} />
              {t('connections.checkRerun')}
            </button>
          </>
        )}
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          onClick={handleClose}
          disabled={!canClose}
          data-testid="check-connections-close"
        >
          {t('common.close')}
        </button>
      </ModalFooter>
    </Modal>
  );
};

/**
 * Top-level mount: owns the hook instance, listens for the
 * `bulk-check-connections` CustomEvent dispatched by t5-e3's tree menus,
 * and opens the modal with the connections from `detail.connections`.
 *
 * Render exactly ONCE (see `App.tsx`).
 */
export const CheckConnectionsModalMount: React.FC = () => {
  const check = useBulkConnectionCheck();

  useEffect(() => {
    const onEvent = (e: Event) => {
      const ce = e as CustomEvent<{ connections?: Connection[] }>;
      const list = ce.detail?.connections;
      if (list && list.length > 0) {
        void check.open(list);
      }
    };
    window.addEventListener('bulk-check-connections', onEvent);
    return () => window.removeEventListener('bulk-check-connections', onEvent);
  }, [check]);

  return <CheckConnectionsModal check={check} />;
};

export default CheckConnectionsModal;
