import React, { useState, useRef } from 'react';
import { 
  Download, 
  Upload, 
  FileText, 
  Database, 
  Settings,
  CheckCircle,
  AlertCircle,
  X,
  File,
  FolderOpen,
  Lock
} from 'lucide-react';
import { Connection } from '../types/connection';
import { useConnections } from '../contexts/ConnectionContext';
import { CollectionManager } from '../utils/collectionManager';
import CryptoJS from 'crypto-js';

interface ImportExportProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ImportResult {
  success: boolean;
  imported: number;
  errors: string[];
  connections: Connection[];
}

export const ImportExport: React.FC<ImportExportProps> = ({ isOpen, onClose }) => {
  const { state, dispatch } = useConnections();
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [exportFormat, setExportFormat] = useState<'json' | 'xml' | 'csv'>('json');
  const [exportEncrypted, setExportEncrypted] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [includePasswords, setIncludePasswords] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const collectionManager = CollectionManager.getInstance();

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
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
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

    try {
      const content = await readFileContent(file);
      const result = await processImportFile(file.name, content);
      setImportResult(result);
    } catch (error) {
      setImportResult({
        success: false,
        imported: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        connections: []
      });
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

      const actualExtension = filename.replace('.encrypted', '').split('.').pop()?.toLowerCase();
      
      switch (actualExtension) {
        case 'json':
          connections = await importFromJSON(content);
          break;
        case 'xml':
          connections = await importFromXML(content);
          break;
        case 'csv':
          connections = await importFromCSV(content);
          break;
        default:
          throw new Error(`Unsupported file format: ${actualExtension}`);
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

  const importFromJSON = async (content: string): Promise<Connection[]> => {
    const data = JSON.parse(content);
    
    if (data.connections && Array.isArray(data.connections)) {
      return data.connections.map((conn: any) => ({
        ...conn,
        id: conn.id || crypto.randomUUID(),
        createdAt: new Date(conn.createdAt || Date.now()),
        updatedAt: new Date(conn.updatedAt || Date.now()),
        password: conn.password === '***ENCRYPTED***' ? undefined : conn.password
      }));
    }
    
    throw new Error('Invalid JSON format');
  };

  const importFromXML = async (content: string): Promise<Connection[]> => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'application/xml');
    const connections: Connection[] = [];
    
    const connectionNodes = doc.querySelectorAll('Connection');
    
    connectionNodes.forEach(node => {
      const conn: Connection = {
        id: node.getAttribute('Id') || crypto.randomUUID(),
        name: node.getAttribute('Name') || 'Imported Connection',
        protocol: (node.getAttribute('Type')?.toLowerCase() || 'rdp') as Connection['protocol'],
        hostname: node.getAttribute('Server') || '',
        port: parseInt(node.getAttribute('Port') || '3389'),
        username: node.getAttribute('Username') || undefined,
        domain: node.getAttribute('Domain') || undefined,
        description: node.getAttribute('Description') || undefined,
        parentId: node.getAttribute('ParentId') || undefined,
        isGroup: node.getAttribute('IsGroup') === 'true',
        tags: node.getAttribute('Tags')?.split(',').filter(t => t.trim()) || [],
        createdAt: new Date(node.getAttribute('CreatedAt') || Date.now()),
        updatedAt: new Date(node.getAttribute('UpdatedAt') || Date.now())
      };
      connections.push(conn);
    });
    
    return connections;
  };

  const importFromCSV = async (content: string): Promise<Connection[]> => {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) throw new Error('CSV file must have headers and at least one data row');
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const connections: Connection[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length !== headers.length) continue;
      
      const conn: any = {};
      headers.forEach((header, index) => {
        conn[header] = values[index];
      });
      
      connections.push({
        id: conn.ID || crypto.randomUUID(),
        name: conn.Name || 'Imported Connection',
        protocol: (conn.Protocol?.toLowerCase() || 'rdp') as Connection['protocol'],
        hostname: conn.Hostname || '',
        port: parseInt(conn.Port || '3389'),
        username: conn.Username || undefined,
        domain: conn.Domain || undefined,
        description: conn.Description || undefined,
        parentId: conn.ParentId || undefined,
        isGroup: conn.IsGroup === 'true',
        tags: conn.Tags?.split(';').filter((t: string) => t.trim()) || [],
        createdAt: new Date(conn.CreatedAt || Date.now()),
        updatedAt: new Date(conn.UpdatedAt || Date.now())
      });
    }
    
    return connections;
  };

  const parseCSVLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    values.push(current.trim());
    return values;
  };

  const confirmImport = () => {
    if (importResult && importResult.success) {
      importResult.connections.forEach(conn => {
        dispatch({ type: 'ADD_CONNECTION', payload: conn });
      });
      setImportResult(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Import / Export Connections</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {/* Tabs */}
          <div className="flex space-x-1 mb-6 bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('export')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'export'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              <Download size={16} className="inline mr-2" />
              Export
            </button>
            <button
              onClick={() => setActiveTab('import')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'import'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              <Upload size={16} className="inline mr-2" />
              Import
            </button>
          </div>

          {/* Export Tab */}
          {activeTab === 'export' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-white mb-4">Export Connections</h3>
                <p className="text-gray-400 mb-4">
                  Export your connections to a file. Configure encryption and password options below.
                </p>
                
                <div className="bg-gray-700 rounded-lg p-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-300">Total Connections:</span>
                    <span className="text-white font-medium">{state.connections.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Groups:</span>
                    <span className="text-white font-medium">
                      {state.connections.filter(c => c.isGroup).length}
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
                    { value: 'csv', label: 'CSV', icon: Settings, desc: 'Spreadsheet format' }
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
                    onChange={(e) => setIncludePasswords(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="text-gray-300">Include passwords in export</span>
                </label>

                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={exportEncrypted}
                    onChange={(e) => setExportEncrypted(e.target.checked)}
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
                    <input
                      type="password"
                      value={exportPassword}
                      onChange={(e) => setExportPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter encryption password"
                    />
                  </div>
                )}
              </div>

              <button
                onClick={handleExport}
                disabled={isProcessing || state.connections.length === 0 || (exportEncrypted && !exportPassword)}
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
          )}

          {/* Import Tab */}
          {activeTab === 'import' && (
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
                    importResult.success 
                      ? 'border-green-500 bg-green-500/20' 
                      : 'border-red-500 bg-red-500/20'
                  }`}>
                    <div className="flex items-center space-x-2 mb-2">
                      {importResult.success ? (
                        <CheckCircle size={20} className="text-green-400" />
                      ) : (
                        <AlertCircle size={20} className="text-red-400" />
                      )}
                      <span className={`font-medium ${
                        importResult.success ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {importResult.success ? 'Import Successful' : 'Import Failed'}
                      </span>
                    </div>
                    
                    {importResult.success && (
                      <p className="text-gray-300">
                        Found {importResult.imported} connections ready to import.
                      </p>
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
                        onClick={() => setImportResult(null)}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {!importResult.success && (
                    <button
                      onClick={() => setImportResult(null)}
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
          )}
        </div>
      </div>
    </div>
  );
};