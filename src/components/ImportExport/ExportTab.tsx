import React from 'react';
import { Download, FileText, Database, Settings, Lock } from 'lucide-react';
import { PasswordInput } from '../ui/PasswordInput';
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
        <h3 className="text-lg font-medium text-white mb-4">Export Connections</h3>
        <p className="text-gray-400 mb-4">
          Export your connections to a file. Configure encryption and password options below.
        </p>
        <div className="bg-gray-700 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-300">Total Connections:</span>
            <span className="text-white font-medium">{connections.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-300">Groups:</span>
            <span className="text-white font-medium">
              {connections.filter(c => c.isGroup).length}
            </span>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
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
                  : 'border-gray-600 hover:border-gray-500'
              }`}
            >
              <format.icon size={24} className="mx-auto mb-2 text-gray-300" />
              <div className="text-white font-medium">{format.label}</div>
              <div className="text-xs text-gray-400 mt-1">{format.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={includePasswords}
            onChange={e => setIncludePasswords(e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Include passwords in export</span>
        </label>

        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={exportEncrypted}
            onChange={e => setExportEncrypted(e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-blue-600"
          />
          <span className="text-gray-300">Encrypt export file</span>
          <Lock size={16} className="text-yellow-400" />
        </label>

        {exportEncrypted && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Encryption Password
            </label>
            <PasswordInput
              value={exportPassword}
              onChange={e => setExportPassword(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter encryption password"
            />
          </div>
        )}
      </div>

      <button
        onClick={handleExport}
        disabled={isProcessing || connections.length === 0 || (exportEncrypted && !exportPassword)}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center space-x-2"
      >
        {isProcessing ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
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
