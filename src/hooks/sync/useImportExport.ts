import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Connection } from '../../types/connection/connection';
import { useConnections } from '../../contexts/useConnections';
import { useToastContext } from '../../contexts/ToastContext';
import { CollectionManager } from '../../utils/connection/collectionManager';
import { SettingsManager } from '../../utils/settings/settingsManager';
import { ImportResult, ImportVpnData } from '../../components/importExport/types';
import {
  encryptWithPassword,
  decryptWithPassword,
  isWebCryptoPayload,
} from '../../utils/crypto/webCryptoAes';
import {
  importConnections,
  detectImportFormat,
  getFormatName,
  detectMRemoteNGEncryption,
  decryptMRemoteNGXml,
  verifyMRemoteNGPassword,
  MREMOTENG_DEFAULT_MASTER_PASSWORD,
} from '../../components/importExport/utils';
import { ProxyOpenVPNManager } from '../../utils/network/proxyOpenVPNManager';
import { proxyCollectionManager } from '../../utils/connection/proxyCollectionManager';

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

  // In-app password prompt state. `pendingPasswordRequest` carries the
  // resolver for the awaiting import flow; the dialog UI lives in
  // ImportExport/index.tsx and calls submit/cancel here.
  const [passwordPrompt, setPasswordPrompt] = useState<{
    title: string;
    description: string;
    error?: string;
  } | null>(null);
  const pendingPasswordResolverRef = useRef<((value: string | null) => void) | null>(null);

  const requestPassword = (opts: {
    title: string;
    description: string;
    error?: string;
  }): Promise<string | null> => {
    // Cancel any in-flight prompt before queuing a new one.
    if (pendingPasswordResolverRef.current) {
      pendingPasswordResolverRef.current(null);
      pendingPasswordResolverRef.current = null;
    }
    setPasswordPrompt(opts);
    return new Promise<string | null>((resolve) => {
      pendingPasswordResolverRef.current = resolve;
    });
  };

  const submitPasswordPrompt = (value: string) => {
    const resolve = pendingPasswordResolverRef.current;
    pendingPasswordResolverRef.current = null;
    setPasswordPrompt(null);
    resolve?.(value);
  };

  const cancelPasswordPrompt = () => {
    const resolve = pendingPasswordResolverRef.current;
    pendingPasswordResolverRef.current = null;
    setPasswordPrompt(null);
    resolve?.(null);
  };

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

  const normalizeVpnImportData = (value: unknown): ImportVpnData | undefined => {
    if (!value || typeof value !== 'object') return undefined;

    const candidate = value as Partial<Record<keyof ImportVpnData, unknown>>;

    return {
      openvpn: Array.isArray(candidate.openvpn) ? candidate.openvpn : [],
      wireguard: Array.isArray(candidate.wireguard) ? candidate.wireguard : [],
      tailscale: Array.isArray(candidate.tailscale) ? candidate.tailscale : [],
      zerotier: Array.isArray(candidate.zerotier) ? candidate.zerotier : [],
    };
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
          `CreatedAt="${conn.createdAt}"`,
          `UpdatedAt="${conn.updatedAt}"`,
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
      conn.createdAt,
      conn.updatedAt,
    ]);
    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  };

  const handleExport = async () => {
    setIsProcessing(true);
    try {
      let content: string;
      let filename: string;
      let mimeType: string;
      const shouldUsePasswordEncryption = exportEncrypted && Boolean(exportPassword);

      const currentCollection = collectionManager.getCurrentCollection();
      if (!currentCollection) throw new Error('No collection selected');

      switch (exportFormat) {
        case 'json': {
          content = await collectionManager.exportCollection(
            currentCollection.id,
            includePasswords,
            shouldUsePasswordEncryption ? exportPassword : undefined,
          );

          // Enrich with VPN connections and tunnel chain templates
          try {
            const parsed = JSON.parse(content);
            const proxyMgr = ProxyOpenVPNManager.getInstance();

            const [vpnOpenVPN, vpnWireGuard, vpnTailscale, vpnZeroTier] =
              await Promise.allSettled([
                proxyMgr.listOpenVPNConnections(),
                proxyMgr.listWireGuardConnections(),
                proxyMgr.listTailscaleConnections(),
                proxyMgr.listZeroTierConnections(),
              ]);

            const tunnelChains = proxyCollectionManager.getTunnelChains();

            parsed.vpnConnections = {
              openvpn:
                vpnOpenVPN.status === 'fulfilled' ? vpnOpenVPN.value : [],
              wireguard:
                vpnWireGuard.status === 'fulfilled' ? vpnWireGuard.value : [],
              tailscale:
                vpnTailscale.status === 'fulfilled' ? vpnTailscale.value : [],
              zerotier:
                vpnZeroTier.status === 'fulfilled' ? vpnZeroTier.value : [],
            };
            parsed.tunnelChainTemplates = tunnelChains;

            content = JSON.stringify(parsed, null, 2);
          } catch (e) {
            console.warn('Failed to include VPN data in export:', e);
          }

          filename = generateExportFilename('json');
          mimeType = 'application/json';
          break;
        }
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

      if (shouldUsePasswordEncryption && exportFormat !== 'json') {
        content = await encryptWithPassword(content, exportPassword);
        filename = filename.replace(/\.[^.]+$/, '.encrypted$&');
      }

      downloadFile(content, filename, mimeType);
      toast.success(`Exported successfully: ${filename}`);
      settingsManager.logAction(
        'info',
        'Data exported',
        undefined,
        `Exported ${state.connections.length} connections to ${exportFormat.toUpperCase()}${shouldUsePasswordEncryption ? ' (encrypted)' : ''}`,
      );
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export failed. Check the console for details.');
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
        const password = await requestPassword({
          title: 'Decrypt import file',
          description: 'This file is encrypted. Enter the password used during export to decrypt it.',
        });
        if (!password) throw new Error('Password required for encrypted file');
        let decrypted: string | null = null;
        // Try new WebCrypto format first (salt.iv.ciphertext).
        if (isWebCryptoPayload(processedContent)) {
          try {
            decrypted = await decryptWithPassword(processedContent, password);
          } catch {
            // fall through to legacy
          }
        }
        // Fallback: legacy CryptoJS-format ciphertext decrypted via Rust backend.
        if (!decrypted) {
          const invoke = (globalThis as any).__TAURI__?.core?.invoke;
          if (invoke) {
            try {
              decrypted = (await invoke(
                'crypto_legacy_decrypt_cryptojs',
                { ciphertext: processedContent, password },
              )) as string;
            } catch {
              decrypted = null;
            }
          }
        }
        if (!decrypted) {
          throw new Error('Failed to decrypt file. Check your password.');
        }
        processedContent = decrypted;
      }

      const detectedFormat = detectImportFormat(processedContent, filename);
      let connections: Connection[];
      if (detectedFormat === 'mremoteng') {
        const enc = detectMRemoteNGEncryption(processedContent);
        if (enc.isEncrypted) {
          // Step 1: figure out which master password to use by validating
          // against the file's `Protected` sentinel. If the user never set a
          // master password, the literal `mR3m` decrypts everything; only
          // prompt when the file uses a custom master.
          const defaultCheck = await verifyMRemoteNGPassword(
            processedContent,
            MREMOTENG_DEFAULT_MASTER_PASSWORD,
          );

          let masterPassword: string | null = null;
          if (defaultCheck.valid) {
            masterPassword = MREMOTENG_DEFAULT_MASTER_PASSWORD;
          } else {
            // Custom master password set — prompt and re-validate.
            let attemptError: string | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
              const candidate = await requestPassword({
                title: 'Encrypted mRemoteNG file',
                description:
                  'Enter the mRemoteNG master password used to encrypt this export.',
                error: attemptError,
              });
              if (!candidate) break;
              const check = await verifyMRemoteNGPassword(
                processedContent,
                candidate,
              );
              if (check.valid) {
                masterPassword = candidate;
                break;
              }
              attemptError = 'Incorrect master password — try again.';
            }
          }

          if (!masterPassword) {
            throw new Error('Password required for encrypted mRemoteNG file');
          }

          // Step 2: actual decryption. With the password validated this can
          // only fail on cipher-mode incompatibility or corrupted bodies.
          let decryptedXml: string;
          try {
            decryptedXml = await decryptMRemoteNGXml(
              processedContent,
              masterPassword,
            );
          } catch (e) {
            throw new Error(
              `Failed to decrypt mRemoteNG file: ${e instanceof Error ? e.message : String(e)}`,
            );
          }

          connections = await importConnections(
            decryptedXml,
            filename,
            detectedFormat,
          );
          console.log(
            `[mRemoteNG] decrypted import returned ${connections.length} connections (master=${defaultCheck.valid ? 'default mR3m' : 'user-supplied'})`,
          );
        } else {
          connections = await importConnections(
            processedContent,
            filename,
            detectedFormat,
          );
        }
      } else {
        connections = await importConnections(
          processedContent,
          filename,
          detectedFormat,
        );
      }
      console.log(`Import format detected: ${getFormatName(detectedFormat)}`);

      // Extract VPN connections and tunnel chain templates from JSON imports
      let vpnConnections: ImportVpnData | undefined;
      let tunnelChainTemplates: ImportResult['tunnelChainTemplates'];
      if (detectedFormat === 'json') {
        try {
          const parsed = JSON.parse(processedContent);
          vpnConnections = normalizeVpnImportData(parsed.vpnConnections);
          if (Array.isArray(parsed.tunnelChainTemplates)) {
            tunnelChainTemplates = parsed.tunnelChainTemplates;
          }
        } catch {
          // Not a JSON file or no VPN data -- ignore
        }
      }

      const actualExtension = filename
        .replace('.encrypted', '')
        .split('.')
        .pop()
        ?.toLowerCase();

      const hasVpnData =
        vpnConnections &&
        (vpnConnections.openvpn.length > 0 ||
          vpnConnections.wireguard.length > 0 ||
          vpnConnections.tailscale.length > 0 ||
          vpnConnections.zerotier.length > 0);
      const hasTunnelChains =
        tunnelChainTemplates && tunnelChainTemplates.length > 0;

      if (
        (!connections || connections.length === 0) &&
        !hasVpnData &&
        !hasTunnelChains
      ) {
        throw new Error(
          `No connections found in ${actualExtension?.toUpperCase()} file`,
        );
      }
      return {
        success: true,
        imported: connections.length,
        errors,
        connections,
        vpnConnections,
        tunnelChainTemplates,
      };
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
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File is too large. Maximum allowed size is 50 MB.');
      return;
    }
    setIsProcessing(true);
    setImportResult(null);
    setImportFilename(file.name);
    try {
      const content = await readFileContent(file);
      const result = await processImportFile(file.name, content);
      setImportResult(result);
      if (!result.success) {
        console.error('Import failed:', result.errors);
        toast.error('Import failed. Check the file format and try again.');
      }
    } catch (error) {
      console.error('Import failed:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      setImportResult({
        success: false,
        imported: 0,
        errors: [errorMessage],
        connections: [],
      });
      toast.error('Import failed. Check the console for details.');
    } finally {
      setIsProcessing(false);
      // Clear the file input so re-selecting the same file fires onChange again
      // (browsers suppress change events when the value is unchanged, so a user
      // who cancels the password prompt and re-picks the same file would
      // otherwise see nothing happen).
      if (event.target) {
        try {
          (event.target as HTMLInputElement).value = '';
        } catch {
          // ignored — some test harnesses make .value read-only
        }
      }
    }
  };

  const confirmImport = async (filename?: string) => {
    if (importResult && importResult.success) {
      importResult.connections.forEach((conn) => {
        dispatch({ type: 'ADD_CONNECTION', payload: conn });
      });

      // Restore VPN connections
      let vpnImportedCount = 0;
      if (importResult.vpnConnections) {
        const proxyMgr = ProxyOpenVPNManager.getInstance();

        for (const conn of importResult.vpnConnections.openvpn) {
          try {
            await proxyMgr.createOpenVPNConnection(conn.name, conn.config);
            vpnImportedCount++;
          } catch (e) {
            console.warn('VPN import skip (OpenVPN):', e);
          }
        }
        for (const conn of importResult.vpnConnections.wireguard) {
          try {
            await proxyMgr.createWireGuardConnection(conn.name, conn.config);
            vpnImportedCount++;
          } catch (e) {
            console.warn('VPN import skip (WireGuard):', e);
          }
        }
        for (const conn of importResult.vpnConnections.tailscale) {
          try {
            await proxyMgr.createTailscaleConnection(conn.name, conn.config);
            vpnImportedCount++;
          } catch (e) {
            console.warn('VPN import skip (Tailscale):', e);
          }
        }
        for (const conn of importResult.vpnConnections.zerotier) {
          try {
            await proxyMgr.createZeroTierConnection(conn.name, conn.config);
            vpnImportedCount++;
          } catch (e) {
            console.warn('VPN import skip (ZeroTier):', e);
          }
        }
      }

      // Restore tunnel chain templates
      let tunnelChainsImportedCount = 0;
      if (importResult.tunnelChainTemplates?.length) {
        for (const chain of importResult.tunnelChainTemplates) {
          try {
            await proxyCollectionManager.createTunnelChain(
              chain.name,
              chain.layers,
              { description: chain.description, tags: chain.tags },
            );
            tunnelChainsImportedCount++;
          } catch (e) {
            console.warn('Tunnel chain import skip:', e);
          }
        }
      }

      const connectionCount = importResult.connections.length;
      const parts: string[] = [];
      if (connectionCount > 0) {
        parts.push(`${connectionCount} connection(s)`);
      }
      if (vpnImportedCount > 0) {
        parts.push(`${vpnImportedCount} VPN connection(s)`);
      }
      if (tunnelChainsImportedCount > 0) {
        parts.push(`${tunnelChainsImportedCount} tunnel chain(s)`);
      }
      const summary = parts.join(', ') || '0 items';

      toast.success(
        filename
          ? `Imported ${summary} from ${filename}`
          : `Imported ${summary} successfully`,
      );
      settingsManager.logAction(
        'info',
        'Data imported',
        undefined,
        `Imported ${summary}${filename ? ` from ${filename}` : ''}`,
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
    passwordPrompt,
    submitPasswordPrompt,
    cancelPasswordPrompt,
  };
}
