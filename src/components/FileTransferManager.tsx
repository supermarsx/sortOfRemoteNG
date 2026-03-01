import React from "react";
import {
  Upload,
  Download,
  Folder,
  File,
  Trash2,
  RefreshCw,
  ArrowLeft,
  Home,
  FolderUp,
} from "lucide-react";
import { Modal } from "./ui/overlays/Modal";import { DialogHeader } from './ui/overlays/DialogHeader';import { EmptyState } from './ui/display';import {
  useFileTransfer,
  FileItem,
  formatFileSize,
  getTransferProgress,
} from "../hooks/protocol/useFileTransfer";
import { Checkbox } from './ui/forms';

type Mgr = ReturnType<typeof useFileTransfer>;

// ─── Sub-components ─────────────────────────────────────────────────

const ManagerHeader: React.FC<{ protocol: string }> = ({ protocol }) => (
  <DialogHeader
    icon={FolderUp}
    iconColor="text-cyan-500"
    iconBg="bg-cyan-500/20"
    title={`File Transfer - ${protocol.toUpperCase()}`}
  />
);

const FileToolbar: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="bg-gray-750 border-b border-[var(--color-border)] p-4">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-2">
        <button onClick={() => mgr.navigateToPath("/")} className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]" title="Home"><Home size={16} /></button>
        <button onClick={mgr.navigateUp} disabled={mgr.currentPath === "/"} className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-50" title="Up"><ArrowLeft size={16} /></button>
        <button onClick={() => mgr.loadDirectory(mgr.currentPath)} className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]" title="Refresh"><RefreshCw size={16} /></button>
      </div>
      <div className="flex items-center space-x-2">
        <button onClick={() => mgr.setShowUploadDialog(true)} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"><Upload size={14} /><span>Upload</span></button>
        {mgr.selectedFiles.size > 0 && (
          <>
            <button onClick={mgr.handleDownload} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"><Download size={14} /><span>Download</span></button>
            <button onClick={mgr.handleDelete} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"><Trash2 size={14} /><span>Delete</span></button>
          </>
        )}
      </div>
    </div>
    <div className="bg-[var(--color-border)] rounded px-3 py-2 text-[var(--color-textSecondary)] font-mono text-sm">{mgr.currentPath}</div>
  </div>
);

const FileTable: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="flex-1 overflow-y-auto">
    {mgr.isLoading ? (
      <div className="flex items-center justify-center h-full"><RefreshCw size={24} className="animate-spin text-[var(--color-textSecondary)]" /></div>
    ) : (
      <table className="sor-data-table w-full">
        <thead className="bg-[var(--color-border)] sticky top-0">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">
              <Checkbox checked={mgr.selectedFiles.size === mgr.files.length && mgr.files.length > 0} onChange={(v: boolean) => mgr.handleSelectAll(v)} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600" />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">Name</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">Size</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">Modified</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase">Permissions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {mgr.files.map((file) => (
            <tr key={file.name} className={`hover:bg-[var(--color-border)] cursor-pointer ${mgr.selectedFiles.has(file.name) ? "bg-blue-900/20" : ""}`} onClick={() => mgr.handleFileSelect(file.name)} onDoubleClick={() => mgr.handleDoubleClick(file)}>
              <td className="px-4 py-3"><Checkbox checked={mgr.selectedFiles.has(file.name)} onChange={() => mgr.handleFileSelect(file.name)} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600" /></td>
              <td className="px-4 py-3 text-sm text-[var(--color-text)]">
                <div className="flex items-center space-x-2">
                  {file.type === "directory" ? <Folder size={16} className="text-blue-400" /> : <File size={16} className="text-[var(--color-textSecondary)]" />}
                  <span>{file.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">{file.type === "file" ? formatFileSize(file.size) : "-"}</td>
              <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">{file.modified.toLocaleDateString()}</td>
              <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)] font-mono">{file.permissions || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const TransferQueue: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="w-80 flex flex-col">
    <div className="bg-gray-750 border-b border-[var(--color-border)] p-4">
      <h3 className="text-[var(--color-text)] font-medium">Active Transfers</h3>
    </div>
    <div className="sor-selection-list flex-1 overflow-y-auto p-4">
      {mgr.transfers.length === 0 ? (
        <EmptyState icon={Upload} iconSize={24} message="No active transfers" className="py-8" />
      ) : (
        mgr.transfers.map((transfer) => (
          <div key={transfer.id} className="sor-selection-row cursor-default bg-[var(--color-border)] p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                {transfer.type === "upload" ? <Upload size={14} className="text-blue-400" /> : <Download size={14} className="text-green-400" />}
                <span className="text-[var(--color-text)] text-sm font-medium">{transfer.type === "upload" ? "Uploading" : "Downloading"}</span>
              </div>
              <span className="text-xs text-[var(--color-textSecondary)]">{getTransferProgress(transfer).toFixed(0)}%</span>
            </div>
            <p className="text-[var(--color-textSecondary)] text-sm truncate mb-2">{transfer.remotePath.split("/").pop()}</p>
            <div className="w-full bg-gray-600 rounded-full h-2 mb-2">
              <div className={`h-2 rounded-full transition-all duration-300 ${transfer.status === "error" ? "bg-red-500" : transfer.status === "completed" ? "bg-green-500" : "bg-blue-500"}`} style={{ width: `${getTransferProgress(transfer)}%` }} />
            </div>
            <div className="flex justify-between text-xs text-[var(--color-textSecondary)]">
              <span>{formatFileSize(transfer.transferredSize)} / {formatFileSize(transfer.totalSize)}</span>
              <span className="capitalize">{transfer.status}</span>
            </div>
            {transfer.error && <p className="text-red-400 text-xs mt-1">{transfer.error}</p>}
            {transfer.status !== "active" && transfer.status !== "completed" && transfer.type === "download" && (
              <button onClick={() => mgr.handleResumeTransfer(transfer.id)} className="mt-2 text-blue-400 text-xs hover:underline">Resume</button>
            )}
          </div>
        ))
      )}
    </div>
  </div>
);

const UploadDialog: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <Modal isOpen={mgr.showUploadDialog} onClose={() => mgr.setShowUploadDialog(false)} closeOnBackdrop={false} closeOnEscape={false} backdropClassName="z-[60] bg-black/60 p-4" panelClassName="max-w-md mx-4" dataTestId="file-transfer-upload-modal">
    <div className="p-6">
      <h3 className="text-[var(--color-text)] font-medium mb-4">Upload Files</h3>
      <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-8 text-center">
        <Upload size={48} className="mx-auto text-[var(--color-textSecondary)] mb-4" />
        <p className="text-[var(--color-textSecondary)] mb-4">Drop files here or click to browse</p>
        <input type="file" multiple onChange={(e) => e.target.files && mgr.handleUpload(e.target.files)} className="hidden" id="file-upload" />
        <label htmlFor="file-upload" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors cursor-pointer">Select Files</label>
      </div>
      <div className="flex justify-end space-x-3 mt-6">
        <button onClick={() => mgr.setShowUploadDialog(false)} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors">Cancel</button>
      </div>
    </div>
  </Modal>
);

// ─── Root component ─────────────────────────────────────────────────

interface FileTransferManagerProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  protocol: "ftp" | "sftp" | "scp";
}

export const FileTransferManager: React.FC<FileTransferManagerProps> = ({
  isOpen, onClose, connectionId, protocol,
}) => {
  const mgr = useFileTransfer(isOpen, connectionId);

  return (
    <Modal isOpen={isOpen} onClose={onClose} closeOnEscape={false} panelClassName="max-w-6xl mx-4 max-h-[90vh]" contentClassName="overflow-hidden" dataTestId="file-transfer-manager-modal">
      <div className="flex flex-col flex-1 min-h-0">
        <ManagerHeader protocol={protocol} />
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col border-r border-[var(--color-border)]">
            <FileToolbar mgr={mgr} />
            <FileTable mgr={mgr} />
          </div>
          <TransferQueue mgr={mgr} />
        </div>
        <UploadDialog mgr={mgr} />
      </div>
    </Modal>
  );
};
