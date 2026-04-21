import React, { useMemo } from 'react';
import {
  Folder,
  File as FileIcon,
  Download,
  Trash2,
  RefreshCw,
  Home,
  ArrowLeft,
  HardDrive,
  AlertCircle,
} from 'lucide-react';
import { ConnectionSession } from '../../types/connection/connection';
import {
  useSMBClient,
  SmbDirEntry,
} from '../../hooks/protocol/useSMBClient';
import { Checkbox, Select } from '../ui/forms';

type Mgr = ReturnType<typeof useSMBClient>;

// Build a human-readable UNC-style path string for the breadcrumb.
function buildDisplayPath(host: string, share: string, path: string): string {
  const pathPart = path === '/' || path === '' ? '' : path.replace(/\//g, '\\');
  return `\\\\${host}\\${share}${pathPart ? `\\${pathPart.replace(/^\\/, '')}` : ''}`;
}

function formatModified(millis?: number | null): string {
  if (!millis || millis <= 0) return '-';
  try {
    return new Date(millis).toLocaleDateString();
  } catch {
    return '-';
  }
}

/* ── sub-components ── */

const SMBHeader: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const shareOptions = useMemo(
    () => mgr.shares.map(s => ({ value: s.name, label: s.comment ? `${s.name} — ${s.comment}` : s.name })),
    [mgr.shares],
  );
  return (
    <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <HardDrive size={20} className="text-primary" />
          <span className="text-[var(--color-text)] font-medium">
            SMB Client - {mgr.session.hostname}
          </span>
          {mgr.sessionId && (
            <span className="text-[var(--color-textSecondary)] text-xs font-mono">
              session: {mgr.sessionId.slice(0, 8)}…
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <Select
            value={mgr.currentShare}
            onChange={(v: string) => mgr.handleShareChange(v)}
            options={shareOptions}
            className="px-3 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
          />
          <button
            onClick={mgr.loadShares}
            className="sor-icon-btn-sm"
            title="Refresh shares"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <button
          onClick={() => mgr.navigateToPath('/')}
          className="sor-icon-btn-sm"
          title="Root"
        >
          <Home size={16} />
        </button>
        <button
          onClick={mgr.navigateUp}
          disabled={mgr.currentPath === '/' || mgr.currentPath === ''}
          className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-50"
          title="Up"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          onClick={mgr.refreshDirectory}
          className="sor-icon-btn-sm"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
        <div className="flex-1 bg-[var(--color-border)] rounded px-3 py-2 text-[var(--color-textSecondary)] font-mono text-sm overflow-x-auto">
          {buildDisplayPath(mgr.session.hostname, mgr.currentShare, mgr.currentPath)}
        </div>
      </div>
    </div>
  );
};

const FileTableHeader: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <thead className="bg-[var(--color-border)] sticky top-0">
    <tr>
      <th className="sor-th">
        <Checkbox
          checked={mgr.selectedFiles.size === mgr.files.length && mgr.files.length > 0}
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
      <th className="sor-th">Attrs</th>
    </tr>
  </thead>
);

const FileRow: React.FC<{ file: SmbDirEntry; mgr: Mgr }> = ({ file, mgr }) => {
  const attrs = [
    file.isHidden ? 'H' : '',
    file.isReadonly ? 'R' : '',
    file.isSystem ? 'S' : '',
    file.entryType === 'directory' ? 'D' : '',
  ]
    .filter(Boolean)
    .join('');
  return (
    <tr
      className={`hover:bg-[var(--color-border)] cursor-pointer ${
        mgr.selectedFiles.has(file.name) ? 'bg-primary/20' : ''
      }`}
      onClick={() => mgr.handleFileSelect(file.name)}
      onDoubleClick={() => mgr.handleDoubleClick(file)}
    >
      <td className="px-4 py-3">
        <Checkbox
          checked={mgr.selectedFiles.has(file.name)}
          onChange={() => mgr.handleFileSelect(file.name)}
          className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
        />
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-text)]">
        <div className="flex items-center space-x-2">
          {file.entryType === 'directory' ? (
            <Folder size={16} className="text-primary" />
          ) : (
            <FileIcon size={16} className="text-[var(--color-textSecondary)]" />
          )}
          <span>{file.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
        {file.entryType === 'file' ? mgr.formatFileSize(file.size) : '-'}
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
        {formatModified(file.modified)}
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)] font-mono">
        {attrs || '-'}
      </td>
    </tr>
  );
};

const ActionBar: React.FC<{ mgr: Mgr }> = ({ mgr }) =>
  mgr.selectedFiles.size > 0 ? (
    <div className="bg-[var(--color-surface)] border-t border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between">
        <span className="text-[var(--color-textSecondary)] text-sm">
          {mgr.selectedFiles.size} item{mgr.selectedFiles.size !== 1 ? 's' : ''} selected
        </span>
        <div className="flex items-center space-x-2">
          <button
            className="px-3 py-1 bg-success hover:bg-success/90 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
            onClick={() => {
              // Download is multi-step (needs local path prompt). Leave the
              // actual dialog to the parent / FileTransferManager — here we
              // just surface the intent.
              console.info('[SMBClient] download requested', [...mgr.selectedFiles]);
            }}
          >
            <Download size={14} />
            <span>Download</span>
          </button>
          <button
            className="px-3 py-1 bg-error hover:bg-error/90 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
            onClick={() => {
              void mgr.deleteSelected();
            }}
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      </div>
    </div>
  ) : null;

const ErrorBar: React.FC<{ mgr: Mgr }> = ({ mgr }) =>
  mgr.error ? (
    <div className="bg-error/10 border-b border-error/40 px-4 py-2 flex items-center space-x-2">
      <AlertCircle size={16} className="text-error" />
      <span className="text-error text-sm">{mgr.error}</span>
    </div>
  ) : null;

/* ── main component ── */

interface SMBClientProps {
  session: ConnectionSession;
}

export const SMBClient: React.FC<SMBClientProps> = ({ session }) => {
  const mgr = useSMBClient(session);

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      <SMBHeader mgr={mgr} />
      <ErrorBar mgr={mgr} />
      <div className="flex-1 overflow-y-auto">
        {mgr.isLoading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw size={24} className="animate-spin text-[var(--color-textSecondary)]" />
          </div>
        ) : mgr.files.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--color-textSecondary)] text-sm">
            {mgr.currentShare
              ? 'Directory is empty.'
              : mgr.shares.length === 0
                ? 'No shares visible on server.'
                : 'Select a share to browse.'}
          </div>
        ) : (
          <table className="sor-data-table w-full">
            <FileTableHeader mgr={mgr} />
            <tbody className="divide-y divide-[var(--color-border)]">
              {mgr.files.map(file => (
                <FileRow key={file.path} file={file} mgr={mgr} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ActionBar mgr={mgr} />
    </div>
  );
};
