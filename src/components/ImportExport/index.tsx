import React, { useState, useRef } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { Connection } from '../../types/connection';
import { useConnections } from '../../contexts/useConnections';
import { useToastContext } from '../../contexts/ToastContext';
import { CollectionManager } from '../../utils/collectionManager';
import { SettingsManager } from '../../utils/settingsManager';
import ExportTab from './ExportTab';
import ImportTab from './ImportTab';
import { ImportResult } from './types';
import CryptoJS from 'crypto-js';
import { parseCSVLine, importFromCSV, importConnections, detectImportFormat, getFormatName } from './utils';
import { generateId } from '../../utils/id';

interface ImportExportProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

export const ImportExport: React.FC<ImportExportProps> = ({
  isOpen,
  onClose,
  embedded = false,
}) => {
  const { state, dispatch } = useConnections();
  const { toast } = useToastContext();
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [exportFormat, setExportFormat] = useState<'json' | 'xml' | 'csv'>('json');
  const [exportEncrypted, setExportEncrypted] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [includePasswords, setIncludePasswords] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importFilename, setImportFilename] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const collectionManager = CollectionManager.getInstance();
  const settingsManager = SettingsManager.getInstance();

  const generateExportFilename = (format: string): string => {
    const now = new Date();
    const datetime = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const randomHex = Math.random().toString(16).substring(2, 8);
    return `sortofremoteng-exports-${datetime}-${randomHex}.${format}`;
  };

  const handleExport = async () => {
    setIsProcessing(true);
    
    try {
      let content: string;
      let filename: string;
      let mimeType: string;

      const currentCollection = collectionManager.getCurrentCollection();
      if (!currentCollection) {
        throw new Error('No collection selected');
      }

      switch (exportFormat) {
        case 'json':
          content = await collectionManager.exportCollection(
            currentCollection.id, 
            includePasswords, 
            exportEncrypted ? exportPassword : undefined
          );
          filename = generateExportFilename('json');
          mimeType = 'application/json';
          break;
        case 'xml':
          content = exportToXML();
          filename = generateExportFilename('xml');
          mimeType = 'application/xml';
          break;
        case 'csv':
          content = exportToCSV();
          filename = generateExportFilename('csv');
          mimeType = 'text/csv';
          break;
        default:
          throw new Error('Unsupported export format');
      }

      // Apply additional encryption if requested and not JSON with built-in encryption
      if (exportEncrypted && exportPassword && exportFormat !== 'json') {
        content = CryptoJS.AES.encrypt(content, exportPassword).toString();
        filename = filename.replace(/\.[^.]+$/, '.encrypted$&');
      }

      downloadFile(content, filename, mimeType);
      toast.success(`Exported successfully: ${filename}`);
      
      settingsManager.logAction(
        'info',
        'Data exported',
        undefined,
        `Exported ${state.connections.length} connections to ${exportFormat.toUpperCase()}${exportEncrypted ? ' (encrypted)' : ''}`
      );
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const exportToXML = (): string => {
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const xmlRoot = '<sortOfRemoteNG>\n';
    const xmlConnections = state.connections.map(conn => {
      const attributes = [
        `Id="${conn.id}"`,
        `Name="${escapeXml(conn.name)}"`,
        `Type="${conn.protocol.toUpperCase()}"`,
        `Server="${escapeXml(conn.hostname)}"`,
        `Port="${conn.port}"`,
        `Username="${escapeXml(conn.username || '')}"`,
        `Domain="${escapeXml(conn.domain || '')}"`,
        `Description="${escapeXml(conn.description || '')}"`,
        `ParentId="${conn.parentId || ''}"`,
        `IsGroup="${conn.isGroup}"`,
        `Tags="${escapeXml((conn.tags || []).join(','))}"`,
        `CreatedAt="${conn.createdAt.toISOString()}"`,
        `UpdatedAt="${conn.updatedAt.toISOString()}"`
      ].join(' ');
      
      return `  <Connection ${attributes} />`;
    }).join('\n');
    const xmlFooter = '\n</sortOfRemoteNG>';
    
    return xmlHeader + xmlRoot + xmlConnections + xmlFooter;
  };

  const exportToCSV = (): string => {
    const headers = [
      'ID', 'Name', 'Protocol', 'Hostname', 'Port', 'Username', 
      'Domain', 'Description', 'ParentId', 'IsGroup', 'Tags', 
      'CreatedAt', 'UpdatedAt'
    ];
    
    const rows = state.connections.map(conn => [
      conn.id,
      escapeCsv(conn.name),
      conn.protocol,
      escapeCsv(conn.hostname),
      conn.port.toString(),
      escapeCsv(conn.username || ''),
      escapeCsv(conn.domain || ''),
      escapeCsv(conn.description || ''),
      conn.parentId || '',
      conn.isGroup.toString(),
      escapeCsv((conn.tags || []).join(';')),
      conn.createdAt.toISOString(),
      conn.updatedAt.toISOString()
    ]);
    
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  };

  const escapeXml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const escapeCsv = (str: string): string => {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setImportResult(null);
    setImportFilename(file.name);

    try {
      const content = await readFileContent(file);
      const result = await processImportFile(file.name, content);
      setImportResult(result);
      if (!result.success) {
        toast.error(`Import failed: ${result.errors[0] || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setImportResult({
        success: false,
        imported: 0,
        errors: [errorMessage],
        connections: []
      });
      toast.error(`Import failed: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const processImportFile = async (filename: string, content: string): Promise<ImportResult> => {
    const extension = filename.split('.').pop()?.toLowerCase();
    let connections: Connection[] = [];
    const errors: string[] = [];

    try {
      // Check if file is encrypted
      if (filename.includes('.encrypted.') || extension === 'encrypted') {
        const password = prompt('Enter decryption password:');
        if (!password) {
          throw new Error('Password required for encrypted file');
        }
        
        try {
          content = CryptoJS.AES.decrypt(content, password).toString(CryptoJS.enc.Utf8);
          if (!content) {
            throw new Error('Invalid password or corrupted file');
          }
        } catch (error) {
          throw new Error('Failed to decrypt file. Check your password.');
        }
      }

      // Use unified importConnections with format auto-detection
      const actualExtension = filename.replace('.encrypted', '').split('.').pop()?.toLowerCase();
      const detectedFormat = detectImportFormat(content, filename);
      
      // Use the detected format for better accuracy
      connections = await importConnections(content, detectedFormat);
      
      // Log the detected format for debugging
      console.log(`Import format detected: ${getFormatName(detectedFormat)}`);
      
      if (!connections || connections.length === 0) {
        throw new Error(`No connections found in ${actualExtension?.toUpperCase()} file`);
      }

      return {
        success: true,
        imported: connections.length,
        errors,
        connections
      };
    } catch (error) {
      return {
        success: false,
        imported: 0,
        errors: [error instanceof Error ? error.message : 'Import failed'],
        connections: []
      };
    }
  };

  const confirmImport = (filename?: string) => {
    if (importResult && importResult.success) {
      importResult.connections.forEach(conn => {
        dispatch({ type: 'ADD_CONNECTION', payload: conn });
      });
      const connectionCount = importResult.connections.length;
      toast.success(
        filename 
          ? `Imported ${connectionCount} connection(s) from ${filename}` 
          : `Imported ${connectionCount} connection(s) successfully`
      );
      
      settingsManager.logAction(
        'info',
        'Data imported',
        undefined,
        `Imported ${connectionCount} connection(s)${filename ? ` from ${filename}` : ''}`
      );
      
      setImportResult(null);
      onClose();
    }
  };

  React.useEffect(() => {
    if (!isOpen || embedded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [embedded, isOpen, onClose]);

  const content = (
    <div className={embedded ? "" : "bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto relative"}>
      {!embedded && (
        <div className="relative h-16 border-b border-gray-700">
          <h2 className="absolute left-6 top-4 text-xl font-semibold text-white">
            Import / Export Connections
          </h2>
          <button
            onClick={onClose}
            className="absolute right-4 top-3 text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      )}

      <div className={embedded ? "p-0" : "p-6"}>
        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-gray-700 rounded-lg p-1">
          <button
            onClick={() => setActiveTab("export")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === "export"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:text-white"
            }`}
          >
            <Download size={16} className="inline mr-2" />
            Export
          </button>
          <button
            onClick={() => setActiveTab("import")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === "import"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:text-white"
            }`}
          >
            <Upload size={16} className="inline mr-2" />
            Import
          </button>
        </div>

        {/* Export Tab */}
        {activeTab === "export" && (
          <ExportTab
            connections={state.connections}
            exportFormat={exportFormat}
            setExportFormat={setExportFormat}
            includePasswords={includePasswords}
            setIncludePasswords={setIncludePasswords}
            exportEncrypted={exportEncrypted}
            setExportEncrypted={setExportEncrypted}
            exportPassword={exportPassword}
            setExportPassword={setExportPassword}
            isProcessing={isProcessing}
            handleExport={handleExport}
          />
        )}

        {/* Import Tab */}
        {activeTab === "import" && (
          <ImportTab
            isProcessing={isProcessing}
            handleImport={handleImport}
            fileInputRef={fileInputRef}
            importResult={importResult}
            handleFileSelect={handleFileSelect}
            confirmImport={() => confirmImport(importFilename)}
            cancelImport={() => {
              setImportResult(null);
              setImportFilename('');
            }}
          />
        )}
      </div>
    </div>
  );

  if (!isOpen && !embedded) return null;
  if (embedded) return content;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {content}
    </div>
  );
};
