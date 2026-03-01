import { useState, useRef, useEffect } from 'react';
import { Connection } from '../types/connection';
import { useConnections } from '../contexts/useConnections';
import { useToastContext } from '../contexts/ToastContext';
import { CollectionManager } from '../utils/collectionManager';
import { SettingsManager } from '../utils/settingsManager';
import { ImportResult } from '../components/ImportExport/types';
import CryptoJS from 'crypto-js';
import {
  importConnections,
  detectImportFormat,
  getFormatName,
} from '../components/ImportExport/utils';

interface UseImportExportParams {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'export' | 'import';
}

export function useImportExport({
  isOpen,
  onClose,
  initialTab = 'export',
}: UseImportExportParams) {
  const { state, dispatch } = useConnections();
  const { toast } = useToastContext();
  const [activeTab, setActiveTab] = useState<'export' | 'import'>(initialTab);
  const [exportFormat, setExportFormat] = useState<'json' | 'xml' | 'csv'>(
    'json',
  );
  const [exportEncrypted, setExportEncrypted] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [includePasswords, setIncludePasswords] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importFilename, setImportFilename] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const collectionManager = CollectionManager.getInstance();
  const settingsManager = SettingsManager.getInstance();

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // ── Helpers ──────────────────────────────────────────────────

  const escapeXml = (str: string): string =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const escapeCsv = (str: string): string => {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const generateExportFilename = (format: string): string => {
    const now = new Date();
    const datetime = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const randomHex = Math.random().toString(16).substring(2, 8);
    return `sortofremoteng-exports-${datetime}-${randomHex}.${format}`;
  };

  const downloadFile = (
    content: string,
    filename: string,
    mimeType: string,
  ) => {
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

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  // ── Export ───────────────────────────────────────────────────

  const exportToXML = (): string => {
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const xmlRoot = '<sortOfRemoteNG>\n';
    const xmlConnections = state.connections
      .map((conn) => {
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
          `UpdatedAt="${conn.updatedAt.toISOString()}"`,
        ].join(' ');
        return `  <Connection ${attributes} />`;
      })
      .join('\n');
    const xmlFooter = '\n</sortOfRemoteNG>';
    return xmlHeader + xmlRoot + xmlConnections + xmlFooter;
  };

  const exportToCSV = (): string => {
    const headers = [
      'ID',
      'Name',
      'Protocol',
      'Hostname',
      'Port',
      'Username',
      'Domain',
      'Description',
      'ParentId',
      'IsGroup',
      'Tags',
      'CreatedAt',
      'UpdatedAt',
    ];
    const rows = state.connections.map((conn) => [
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
      conn.updatedAt.toISOString(),
    ]);
    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  };

  const handleExport = async () => {
    setIsProcessing(true);
    try {
      let content: string;
      let filename: string;
      let mimeType: string;

      const currentCollection = collectionManager.getCurrentCollection();
      if (!currentCollection) throw new Error('No collection selected');

      switch (exportFormat) {
        case 'json':
          content = await collectionManager.exportCollection(
            currentCollection.id,
            includePasswords,
            exportEncrypted ? exportPassword : undefined,
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
        `Exported ${state.connections.length} connections to ${exportFormat.toUpperCase()}${exportEncrypted ? ' (encrypted)' : ''}`,
      );
    } catch (error) {
      console.error('Export failed:', error);
      toast.error(
        'Export failed: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Import ───────────────────────────────────────────────────

  const processImportFile = async (
    filename: string,
    content: string,
  ): Promise<ImportResult> => {
    const errors: string[] = [];
    try {
      let processedContent = content;
      if (
        filename.includes('.encrypted.') ||
        filename.split('.').pop()?.toLowerCase() === 'encrypted'
      ) {
        const password = prompt('Enter decryption password:');
        if (!password) throw new Error('Password required for encrypted file');
        try {
          processedContent = CryptoJS.AES.decrypt(
            processedContent,
            password,
          ).toString(CryptoJS.enc.Utf8);
          if (!processedContent)
            throw new Error('Invalid password or corrupted file');
        } catch {
          throw new Error('Failed to decrypt file. Check your password.');
        }
      }

      const detectedFormat = detectImportFormat(processedContent, filename);
      const connections = await importConnections(
        processedContent,
        detectedFormat,
      );
      console.log(`Import format detected: ${getFormatName(detectedFormat)}`);

      const actualExtension = filename
        .replace('.encrypted', '')
        .split('.')
        .pop()
        ?.toLowerCase();
      if (!connections || connections.length === 0) {
        throw new Error(
          `No connections found in ${actualExtension?.toUpperCase()} file`,
        );
      }
      return { success: true, imported: connections.length, errors, connections };
    } catch (error) {
      return {
        success: false,
        imported: 0,
        errors: [error instanceof Error ? error.message : 'Import failed'],
        connections: [],
      };
    }
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
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
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      setImportResult({
        success: false,
        imported: 0,
        errors: [errorMessage],
        connections: [],
      });
      toast.error(`Import failed: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmImport = (filename?: string) => {
    if (importResult && importResult.success) {
      importResult.connections.forEach((conn) => {
        dispatch({ type: 'ADD_CONNECTION', payload: conn });
      });
      const connectionCount = importResult.connections.length;
      toast.success(
        filename
          ? `Imported ${connectionCount} connection(s) from ${filename}`
          : `Imported ${connectionCount} connection(s) successfully`,
      );
      settingsManager.logAction(
        'info',
        'Data imported',
        undefined,
        `Imported ${connectionCount} connection(s)${filename ? ` from ${filename}` : ''}`,
      );
      setImportResult(null);
      onClose();
    }
  };

  const cancelImport = () => {
    setImportResult(null);
    setImportFilename('');
  };

  return {
    connections: state.connections,
    activeTab,
    setActiveTab,
    exportFormat,
    setExportFormat,
    exportEncrypted,
    setExportEncrypted,
    exportPassword,
    setExportPassword,
    includePasswords,
    setIncludePasswords,
    importResult,
    importFilename,
    isProcessing,
    fileInputRef,
    handleExport,
    handleImport,
    handleFileSelect,
    confirmImport,
    cancelImport,
  };
}
