import React from 'react';
import { Folder, File, Download, Trash2, RefreshCw, Home, ArrowLeft, HardDrive, Table } from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { useSMBClient, SMBFile } from '../hooks/useSMBClient';

type Mgr = ReturnType<typeof useSMBClient>;

/* ── sub-components ── */

const SMBHeader: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-3">
        <HardDrive size={20} className="text-blue-400" />
        <span className="text-[var(--color-text)] font-medium">SMB Client - {mgr.session.hostname}</span>
      </div>
      <div className="flex items-center space-x-2">
        <select
          value={mgr.currentShare}
          onChange={(e) => mgr.handleShareChange(e.target.value)}
          className="px-3 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
        >
          {mgr.shares.map(share => (
            <option key={share} value={share}>{share}</option>
          ))}
        </select>
        <button
          onClick={mgr.loadShares}
          className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          title="Refresh shares"
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </div>
    <div className="flex items-center space-x-2">
      <button
        onClick={() => mgr.navigateToPath('\\')}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        title="Root"
      >
        <Home size={16} />
      </button>
      <button
        onClick={mgr.navigateUp}
        disabled={mgr.currentPath === '\\'}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-50"
        title="Up"
      >
        <ArrowLeft size={16} />
      </button>
      <button
        onClick={mgr.refreshDirectory}
        className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        title="Refresh"
      >
        <RefreshCw size={16} />
      </button>
      <div className="flex-1 bg-[var(--color-border)] rounded px-3 py-2 text-[var(--color-textSecondary)] font-mono text-sm">
        \\{mgr.session.hostname}\{mgr.currentShare}{mgr.currentPath !== '\\' ? mgr.currentPath : ''}
      </div>
    </div>
  </div>
);

const FileTableHeader: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <thead className="bg-[var(--color-border)] sticky top-0">
    <tr>
      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">
        <input
          type="checkbox"
          checked={mgr.selectedFiles.size === mgr.files.length && mgr.files.length > 0}
          onChange={(e) => {
            if (e.target.checked) mgr.selectAll();
            else mgr.deselectAll();
          }}
          className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
        />
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">Name</th>
      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">Size</th>
      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">Modified</th>
      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">Permissions</th>
    </tr>
  </thead>
);

const FileRow: React.FC<{ file: SMBFile; mgr: Mgr }> = ({ file, mgr }) => (
  <tr
    className={`hover:bg-[var(--color-border)] cursor-pointer ${
      mgr.selectedFiles.has(file.name) ? 'bg-blue-900/20' : ''
    }`}
    onClick={() => mgr.handleFileSelect(file.name)}
    onDoubleClick={() => mgr.handleDoubleClick(file)}
  >
    <td className="px-4 py-3">
      <input
        type="checkbox"
        checked={mgr.selectedFiles.has(file.name)}
        onChange={() => mgr.handleFileSelect(file.name)}
        className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600"
      />
    </td>
    <td className="px-4 py-3 text-sm text-[var(--color-text)]">
      <div className="flex items-center space-x-2">
        {file.type === 'directory' ? (
          <Folder size={16} className="text-blue-400" />
        ) : (
          <File size={16} className="text-[var(--color-textSecondary)]" />
        )}
        <span>{file.name}</span>
      </div>
    </td>
    <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
      {file.type === 'file' ? mgr.formatFileSize(file.size) : '-'}
    </td>
    <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
      {file.modified.toLocaleDateString()}
    </td>
    <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)] font-mono">
      {file.permissions || '-'}
    </td>
  </tr>
);

const ActionBar: React.FC<{ mgr: Mgr }> = ({ mgr }) =>
  mgr.selectedFiles.size > 0 ? (
    <div className="bg-[var(--color-surface)] border-t border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between">
        <span className="text-[var(--color-textSecondary)] text-sm">
          {mgr.selectedFiles.size} item{mgr.selectedFiles.size !== 1 ? 's' : ''} selected
        </span>
        <div className="flex items-center space-x-2">
          <button className="px-3 py-1 bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
            <Download size={14} />
            <span>Download</span>
          </button>
          <button className="px-3 py-1 bg-red-600 hover:bg-red-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2">
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      </div>
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
      <div className="flex-1 overflow-y-auto">
        {mgr.isLoading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw size={24} className="animate-spin text-[var(--color-textSecondary)]" />
          </div>
        ) : (
          <table className="sor-data-table w-full">
            <FileTableHeader mgr={mgr} />
            <tbody className="divide-y divide-[var(--color-border)]">
              {mgr.files.map(file => (
                <FileRow key={file.name} file={file} mgr={mgr} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ActionBar mgr={mgr} />
    </div>
  );
};
