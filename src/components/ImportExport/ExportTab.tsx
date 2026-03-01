import React from 'react';
import { Download, FileText, Database, Settings, Lock } from 'lucide-react';
import { PasswordInput } from '../ui/forms/PasswordInput';
import { Checkbox } from '../ui/forms';
import { Connection } from '../../types/connection';

interface ExportTabProps {
  connections: Connection[];
  exportFormat: 'json' | 'xml' | 'csv';
  setExportFormat: (format: 'json' | 'xml' | 'csv') => void;
  includePasswords: boolean;
  setIncludePasswords: (val: boolean) => void;
  exportEncrypted: boolean;
  setExportEncrypted: (val: boolean) => void;
  exportPassword: string;
  setExportPassword: (val: string) => void;
  isProcessing: boolean;
  handleExport: () => void;
}

const ExportTab: React.FC<ExportTabProps> = ({
  connections,
  exportFormat,
  setExportFormat,
  includePasswords,
  setIncludePasswords,
  exportEncrypted,
  setExportEncrypted,
  exportPassword,
  setExportPassword,
  isProcessing,
  handleExport,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">Export Connections</h3>
        <p className="text-[var(--color-textSecondary)] mb-4">
          Export your connections to a file. Configure encryption and password options below.
        </p>
        <div className="bg-[var(--color-border)] rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--color-textSecondary)]">Total Connections:</span>
            <span className="text-[var(--color-text)] font-medium">{connections.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--color-textSecondary)]">Groups:</span>
            <span className="text-[var(--color-text)] font-medium">
              {connections.filter(c => c.isGroup).length}
            </span>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Export Format
        </label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: 'json', label: 'JSON', icon: FileText, desc: 'Structured data format' },
            { value: 'xml', label: 'XML', icon: Database, desc: 'sortOfRemoteNG compatible' },
            { value: 'csv', label: 'CSV', icon: Settings, desc: 'Spreadsheet format' },
          ].map(format => (
            <button
              key={format.value}
              onClick={() => setExportFormat(format.value as any)}
              className={`p-4 rounded-lg border-2 transition-colors ${
                exportFormat === format.value
                  ? 'border-blue-500 bg-blue-500/20'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border)]'
              }`}
            >
              <format.icon size={24} className="mx-auto mb-2 text-[var(--color-textSecondary)]" />
              <div className="text-[var(--color-text)] font-medium">{format.label}</div>
              <div className="text-xs text-[var(--color-textSecondary)] mt-1">{format.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <label className="flex items-center space-x-2">
          <Checkbox checked={includePasswords} onChange={setIncludePasswords} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600" />
          <span className="text-[var(--color-textSecondary)]">Include passwords in export</span>
        </label>

        <label className="flex items-center space-x-2">
          <Checkbox checked={exportEncrypted} onChange={setExportEncrypted} className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600" />
          <span className="text-[var(--color-textSecondary)]">Encrypt export file</span>
          <Lock size={16} className="text-yellow-400" />
        </label>

        {exportEncrypted && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
              Encryption Password
            </label>
            <PasswordInput
              value={exportPassword}
              onChange={e => setExportPassword(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter encryption password"
            />
          </div>
        )}
      </div>

      <button
        onClick={handleExport}
        disabled={isProcessing || connections.length === 0 || (exportEncrypted && !exportPassword)}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center space-x-2"
      >
        {isProcessing ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--color-border)]"></div>
            <span>Exporting...</span>
          </>
        ) : (
          <>
            <Download size={16} />
            <span>Export Connections</span>
          </>
        )}
      </button>
    </div>
  );
};

export default ExportTab;
