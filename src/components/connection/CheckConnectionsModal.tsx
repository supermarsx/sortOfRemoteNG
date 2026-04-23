import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Ban,
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
    return <Circle size={16} className="text-[var(--color-text-secondary)] opacity-60" aria-hidden />;
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

export const CheckConnectionsModal: React.FC<CheckConnectionsModalProps> = ({ check }) => {
  const { t } = useTranslation();
  const { isOpen, rows, total, completed, cancelled, error, cancel, close } = check;

  const titleId = 'check-connections-modal-title';
  const active = completed < total && !cancelled && !error;
  const canClose = !active;

  const progressPct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

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
            <span className="text-[var(--color-text-secondary)]">
              {completed}/{total}
            </span>
            <span className="text-[var(--color-text-secondary)]">{progressPct}%</span>
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
              className="h-full bg-[var(--color-primary)] transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

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
            <div className="p-3 text-sm text-[var(--color-text-secondary)]">
              {t('connections.checkStatus.pending')}
            </div>
          )}
          {rows.map((row) => {
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
                    <span className="text-xs text-[var(--color-text-secondary)] truncate">
                      {row.host}:{row.port}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)] mt-0.5">
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
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={() => void cancel()}
          disabled={!active}
          data-testid="check-connections-cancel"
        >
          {t('connections.checkCancel')}
        </button>
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
