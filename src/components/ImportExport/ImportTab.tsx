import React from 'react';
import { Upload, File, FolderOpen, CheckCircle, AlertCircle, FileText, FileCode, Download } from 'lucide-react';
import { ImportResult } from './types';
import { useToastContext } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';

interface ImportTabProps {
  isProcessing: boolean;
  handleImport: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  importResult: ImportResult | null;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  confirmImport: () => void;
  cancelImport: () => void;
  detectedFormat?: string;
}

// Template data for CSV
const CSV_TEMPLATE = `Name,Protocol,Hostname,Port,Username,Domain,Description,ParentId,IsGroup,Tags
"Web Server 1",SSH,192.168.1.10,22,admin,,Web server in datacenter,,false,"production;linux"
"Database Server",RDP,192.168.1.20,3389,administrator,DOMAIN,SQL Server,,false,"production;database"
"Dev Folder",SSH,,,,,Development servers,,true,""
"Dev Server 1",SSH,10.0.0.5,22,devuser,,Dev environment,Dev Folder,false,"development;test"
"Router Admin",HTTP,192.168.1.1,80,admin,,Network router,,false,"network;router"
"VNC Desktop",VNC,192.168.1.30,5900,,,Remote desktop access,,false,"desktop;vnc"`;

// Template data for JSON
const JSON_TEMPLATE = {
  version: "1.0",
  exportDate: new Date().toISOString(),
  connections: [
    {
      name: "Web Server 1",
      protocol: "SSH",
      hostname: "192.168.1.10",
      port: 22,
      username: "admin",
      domain: "",
      description: "Web server in datacenter",
      parentId: null,
      isGroup: false,
      tags: ["production", "linux"]
    },
    {
      name: "Database Server",
      protocol: "RDP",
      hostname: "192.168.1.20",
      port: 3389,
      username: "administrator",
      domain: "DOMAIN",
      description: "SQL Server",
      parentId: null,
      isGroup: false,
      tags: ["production", "database"]
    },
    {
      name: "Dev Folder",
      protocol: "SSH",
      hostname: "",
      port: 22,
      username: "",
      domain: "",
      description: "Development servers",
      parentId: null,
      isGroup: true,
      tags: []
    },
    {
      name: "Dev Server 1",
      protocol: "SSH",
      hostname: "10.0.0.5",
      port: 22,
      username: "devuser",
      domain: "",
      description: "Dev environment",
      parentId: "Dev Folder",
      isGroup: false,
      tags: ["development", "test"]
    },
    {
      name: "Router Admin",
      protocol: "HTTP",
      hostname: "192.168.1.1",
      port: 80,
      username: "admin",
      domain: "",
      description: "Network router",
      parentId: null,
      isGroup: false,
      tags: ["network", "router"]
    },
    {
      name: "VNC Desktop",
      protocol: "VNC",
      hostname: "192.168.1.30",
      port: 5900,
      username: "",
      domain: "",
      description: "Remote desktop access",
      parentId: null,
      isGroup: false,
      tags: ["desktop", "vnc"]
    }
  ]
};

const ImportTab: React.FC<ImportTabProps> = ({
  isProcessing,
  handleImport,
  fileInputRef,
  importResult,
  handleFileSelect,
  confirmImport,
  cancelImport,
  detectedFormat,
}) => {
  const { toast } = useToastContext();
  const { t } = useTranslation();

  const downloadTemplate = (format: 'csv' | 'json') => {
    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'csv') {
      content = CSV_TEMPLATE;
      filename = 'sortofremoteng-import-template.csv';
      mimeType = 'text/csv';
    } else {
      content = JSON.stringify(JSON_TEMPLATE, null, 2);
      filename = 'sortofremoteng-import-template.json';
      mimeType = 'application/json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Show toast with download location info
    toast.success(t('import.templateDownloaded', { 
      filename,
      defaultValue: `Template "${filename}" downloaded to your Downloads folder`
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">Import Connections</h3>
        <p className="text-[var(--color-textSecondary)] mb-4">
          Import connections from various applications and formats.
        </p>
        
        {/* Supported Formats Info */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
          <div className="flex items-center gap-2 p-2 bg-[var(--color-surface)]/50 rounded text-xs text-[var(--color-textSecondary)]">
            <FileCode className="w-4 h-4 text-blue-400" />
            mRemoteNG
          </div>
          <div className="flex items-center gap-2 p-2 bg-[var(--color-surface)]/50 rounded text-xs text-[var(--color-textSecondary)]">
            <FileCode className="w-4 h-4 text-green-400" />
            RDCMan
          </div>
          <div className="flex items-center gap-2 p-2 bg-[var(--color-surface)]/50 rounded text-xs text-[var(--color-textSecondary)]">
            <FileCode className="w-4 h-4 text-purple-400" />
            MobaXterm
          </div>
          <div className="flex items-center gap-2 p-2 bg-[var(--color-surface)]/50 rounded text-xs text-[var(--color-textSecondary)]">
            <FileCode className="w-4 h-4 text-yellow-400" />
            PuTTY
          </div>
          <div className="flex items-center gap-2 p-2 bg-[var(--color-surface)]/50 rounded text-xs text-[var(--color-textSecondary)]">
            <FileCode className="w-4 h-4 text-cyan-400" />
            Termius
          </div>
          <div className="flex items-center gap-2 p-2 bg-[var(--color-surface)]/50 rounded text-xs text-[var(--color-textSecondary)]">
            <FileText className="w-4 h-4 text-orange-400" />
            CSV / JSON
          </div>
        </div>
      </div>

      {!importResult && (
        <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-8 text-center">
          <FolderOpen size={48} className="mx-auto mb-4 text-[var(--color-textSecondary)]" />
          <p className="text-[var(--color-textSecondary)] mb-4">Select a file to import connections</p>
          <button
            onClick={handleImport}
            disabled={isProcessing}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-[var(--color-text)] rounded-lg transition-colors flex items-center space-x-2 mx-auto"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--color-border)]"></div>
                <span>Processing...</span>
              </>
            ) : (
              <>
                <File size={16} />
                <span>Choose File</span>
              </>
            )}
          </button>
          <p className="text-xs text-gray-500 mt-2">
            Formats auto-detected: .json, .xml, .csv, .ini, .reg
          </p>
          
          {/* Download Templates Section */}
          <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
            <p className="text-sm text-[var(--color-textSecondary)] mb-3">Download import templates:</p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => downloadTemplate('csv')}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-lg transition-colors text-sm"
              >
                <Download size={14} />
                <span>CSV Template</span>
              </button>
              <button
                onClick={() => downloadTemplate('json')}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-lg transition-colors text-sm"
              >
                <Download size={14} />
                <span>JSON Template</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {importResult && (
        <div className="space-y-4">
          <div className={`p-4 rounded-lg border ${
            importResult.success ? 'border-green-500 bg-green-500/20' : 'border-red-500 bg-red-500/20'
          }`}>
            <div className="flex items-center space-x-2 mb-2">
              {importResult.success ? (
                <CheckCircle size={20} className="text-green-400" />
              ) : (
                <AlertCircle size={20} className="text-red-400" />
              )}
              <span className={`font-medium ${importResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {importResult.success ? 'Import Successful' : 'Import Failed'}
              </span>
              {detectedFormat && importResult.success && (
                <span className="text-xs px-2 py-0.5 bg-blue-600/30 text-blue-300 rounded">
                  {detectedFormat}
                </span>
              )}
            </div>

            {importResult.success && (
              <p className="text-[var(--color-textSecondary)]">Found {importResult.imported} connections ready to import.</p>
            )}

            {importResult.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-red-400 text-sm font-medium">Errors:</p>
                <ul className="text-red-300 text-sm mt-1">
                  {importResult.errors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {importResult.success && (
            <div className="flex space-x-3">
              <button
                onClick={confirmImport}
                className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-lg transition-colors"
              >
                Import {importResult.imported} Connections
              </button>
              <button
                onClick={cancelImport}
                className="px-4 py-2 bg-gray-600 hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {!importResult.success && (
            <button
              onClick={cancelImport}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg transition-colors"
            >
              Try Again
            </button>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.xml,.csv,.ini,.reg,.encrypted"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
};

export default ImportTab;
