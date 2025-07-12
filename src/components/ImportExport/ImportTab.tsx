import React from 'react';
import { Upload, File, FolderOpen, CheckCircle, AlertCircle } from 'lucide-react';
import { ImportResult } from './types';

interface ImportTabProps {
  isProcessing: boolean;
  handleImport: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  importResult: ImportResult | null;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  confirmImport: () => void;
  cancelImport: () => void;
}

const ImportTab: React.FC<ImportTabProps> = ({
  isProcessing,
  handleImport,
  fileInputRef,
  importResult,
  handleFileSelect,
  confirmImport,
  cancelImport,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-white mb-4">Import Connections</h3>
        <p className="text-gray-400 mb-4">
          Import connections from JSON, XML, or CSV files. Encrypted files are automatically detected.
        </p>
      </div>

      {!importResult && (
        <div className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center">
          <FolderOpen size={48} className="mx-auto mb-4 text-gray-400" />
          <p className="text-gray-300 mb-4">Select a file to import connections</p>
          <button
            onClick={handleImport}
            disabled={isProcessing}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg transition-colors flex items-center space-x-2 mx-auto"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
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
            Supported formats: .json, .xml, .csv (encrypted files supported)
          </p>
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
            </div>

            {importResult.success && (
              <p className="text-gray-300">Found {importResult.imported} connections ready to import.</p>
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
                className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                Import {importResult.imported} Connections
              </button>
              <button
                onClick={cancelImport}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {!importResult.success && (
            <button
              onClick={cancelImport}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Try Again
            </button>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.xml,.csv,.encrypted"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
};

export default ImportTab;
