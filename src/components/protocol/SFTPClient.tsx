// SFTPClient — stub component wired to `useSFTPClient`.
//
// e20 owns the final FileTransferManager integration and any deep UX polish.
// This component exists so the protocol registry has a real surface to mount
// once aggregator e19 registers the backend commands.

import React, { useCallback } from 'react';
import {
  Folder,
  File as FileIcon,
  ArrowLeft,
  Home,
  RefreshCw,
  HardDrive,
} from 'lucide-react';
import { ConnectionSession } from '../../types/connection/connection';
import { useSFTPClient } from '../../hooks/protocol/useSFTPClient';
import type { SftpDirEntry } from '../../types/sftp';
import { Checkbox } from '../ui/forms';

type Mgr = ReturnType<typeof useSFTPClient>;

// ─── sub-components ──────────────────────────────────────────────────────────

const SFTPHeader: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-3">
        <HardDrive size={20} className="text-primary" />
        <span className="text-[var(--color-text)] font-medium">
          SFTP Client - {mgr.session.hostname}
          {mgr.connected ? '' : ' (disconnected)'}
        </span>
      </div>
    </div>
    <div className="flex items-center space-x-2">
      <button
        onClick={() => mgr.loadDirectory('/')}
        className="sor-icon-btn-sm"
        title="Home"
        disabled={!mgr.connected}
      >
        <Home size={16} />
      </button>
      <button
        onClick={mgr.navigateUp}
        disabled={!mgr.connected || mgr.currentPath === '/'}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-50"
        title="Up"
      >
        <ArrowLeft size={16} />
      </button>
      <button
        onClick={mgr.refreshDirectory}
        className="sor-icon-btn-sm"
        title="Refresh"
        disabled={!mgr.connected}
      >
        <RefreshCw size={16} />
      </button>
      <div className="flex-1 bg-[var(--color-border)] rounded px-3 py-2 text-[var(--color-textSecondary)] font-mono text-sm">
        {mgr.session.hostname}:{mgr.currentPath}
      </div>
    </div>
  </div>
);

const FileTableHeader: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <thead className="bg-[var(--color-border)] sticky top-0">
    <tr>
      <th className="sor-th">
        <Checkbox
          checked={
            mgr.selected.size === mgr.entries.length && mgr.entries.length > 0
          }
          onChange={(v: boolean) => {
            if (v) mgr.selectAll();
            else mgr.deselectAll();
          }}
          className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
        />
      </th>
      <th className="sor-th">Name</th>
      <th className="sor-th">Size</th>
      <th className="sor-th">Modified</th>
      <th className="sor-th">Permissions</th>
    </tr>
  </thead>
);

const FileRow: React.FC<{ entry: SftpDirEntry; mgr: Mgr }> = ({ entry, mgr }) => {
  const onClick = useCallback(() => mgr.toggleSelect(entry.name), [mgr, entry.name]);
  const onDoubleClick = useCallback(() => mgr.navigateInto(entry), [mgr, entry]);

  return (
    <tr
      className={`hover:bg-[var(--color-border)] cursor-pointer ${
        mgr.selected.has(entry.name) ? 'bg-primary/20' : ''
      }`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <td className="px-4 py-3">
        <Checkbox
          checked={mgr.selected.has(entry.name)}
          onChange={onClick}
          className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
        />
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-text)]">
        <div className="flex items-center space-x-2">
          {entry.entryType === 'directory' ? (
            <Folder size={16} className="text-primary" />
          ) : (
            <FileIcon size={16} className="text-[var(--color-textSecondary)]" />
          )}
          <span>{entry.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
        {entry.entryType === 'file' ? mgr.formatFileSize(entry.size) : '-'}
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
        {entry.modified
          ? new Date(entry.modified * 1000).toLocaleDateString()
          : '-'}
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)] font-mono">
        {entry.permissionsString || '-'}
      </td>
    </tr>
  );
};

// ─── main component ──────────────────────────────────────────────────────────

interface SFTPClientProps {
  session: ConnectionSession;
  /**
   * Optional pre-existing backend session id (e.g. created by the
   * FileTransferManager host). When present, this component does NOT open a
   * fresh SFTP session on mount.
   */
  existingSessionId?: string;
}

export const SFTPClient: React.FC<SFTPClientProps> = ({
  session,
  existingSessionId,
}) => {
  const mgr = useSFTPClient(session, {
    autoConnect: !existingSessionId,
    existingSessionId,
  });

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      <SFTPHeader mgr={mgr} />
      {mgr.error && (
        <div className="bg-error/10 border-b border-error/30 text-error text-sm px-4 py-2">
          {mgr.error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {mgr.isLoading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw
              size={24}
              className="animate-spin text-[var(--color-textSecondary)]"
            />
          </div>
        ) : !mgr.connected ? (
          <div className="flex items-center justify-center h-full text-[var(--color-textSecondary)] text-sm">
            Not connected. (Full connection flow is handled by the File
            Transfer host — see e20.)
          </div>
        ) : (
          <table className="sor-data-table w-full">
            <FileTableHeader mgr={mgr} />
            <tbody className="divide-y divide-[var(--color-border)]">
              {mgr.entries.map(entry => (
                <FileRow key={entry.name} entry={entry} mgr={mgr} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default SFTPClient;
