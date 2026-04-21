import { useState, useCallback, useEffect } from 'react';
import { ProxyOpenVPNManager } from '../../utils/network/proxyOpenVPNManager';
import { consumePendingVpnEdit } from '../../utils/network/vpnEditorStore';

export type VpnEditorType = 'openvpn' | 'wireguard' | 'tailscale' | 'zerotier' | 'pptp' | 'l2tp' | 'ikev2' | 'ipsec' | 'sstp';

export interface VpnEditingConnection {
  id: string;
  vpnType: VpnEditorType;
  name: string;
  config: Record<string, any>;
}

export function useVpnEditor(
  isOpen: boolean,
  editingConnection: VpnEditingConnection | null | undefined,
  onSave: () => void,
) {
  const mgr = ProxyOpenVPNManager.getInstance();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [vpnType, setVpnType] = useState<VpnEditorType>('openvpn');
  const [config, setConfig] = useState<Record<string, any>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName('');
    setDescription('');
    setVpnType('openvpn');
    setConfig({});
    setTags([]);
    setTagInput('');
    setError(null);
    setEditingId(null);
  }, []);

  // Populate form when editing, reset when creating
  useEffect(() => {
    if (!isOpen) return;

    // Check for pending edit from the store (passed from VpnConnectionsTab)
    const pending = consumePendingVpnEdit();
    const toEdit = editingConnection ?? (pending ? pending as VpnEditingConnection : null);

    if (toEdit) {
      setName(toEdit.name);
      setVpnType(toEdit.vpnType as VpnEditorType);
      setConfig(toEdit.config ?? {});
      setDescription('');
      setTags([]);
      setEditingId(toEdit.id);
    } else {
      resetForm();
    }
  }, [isOpen, editingConnection, resetForm]);

  // Reset config when vpnType changes (only in create mode)
  const handleTypeChange = useCallback((newType: VpnEditorType) => {
    setVpnType(newType);
    if (!editingConnection && !editingId) {
      setConfig({});
    }
  }, [editingConnection, editingId]);

  const updateConfig = useCallback((updates: Record<string, any>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Tags
  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags(prev => [...prev, trimmed]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  }, []);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  }, [handleAddTag]);

  // Build typed config from form state
  const buildTypedConfig = useCallback((): Record<string, unknown> => {
    const splitCsv = (s?: string): string[] =>
      s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
    const splitLines = (s?: string): string[] =>
      s ? s.split('\n').map(x => x.trim()).filter(Boolean) : [];

    switch (vpnType) {
      case 'openvpn': {
        const cfg: Record<string, unknown> = { enabled: true };
        if (config.configFile) cfg.configFile = config.configFile;
        if (config.authFile) cfg.authFile = config.authFile;
        if (config.caCert) cfg.caCert = config.caCert;
        if (config.clientCert) cfg.clientCert = config.clientCert;
        if (config.clientKey) cfg.clientKey = config.clientKey;
        if (config.username) cfg.username = config.username;
        if (config.password) cfg.password = config.password;
        if (config.remoteHost) cfg.remoteHost = config.remoteHost;
        if (config.remotePort) cfg.remotePort = config.remotePort;
        if (config.protocol) cfg.protocol = config.protocol;
        if (config.cipher) cfg.cipher = config.cipher;
        if (config.auth) cfg.auth = config.auth;
        if (config.tlsAuth) cfg.tlsAuth = true;
        if (config.tlsCrypt) cfg.tlsCrypt = true;
        if (config.compression) cfg.compression = true;
        if (config.routeNoPull) cfg.routeNoPull = true;
        if (config.mtuDiscover) cfg.mtuDiscover = true;
        if (config.mssFix) cfg.mssFix = config.mssFix;
        if (config.tunMtu) cfg.tunMtu = config.tunMtu;
        if (config.fragment) cfg.fragment = config.fragment;
        if (config.keepAliveInterval || config.keepAliveTimeout) {
          cfg.keepAlive = { interval: config.keepAliveInterval ?? 10, timeout: config.keepAliveTimeout ?? 60 };
        }
        const opts = splitLines(config.customOptions);
        if (opts.length) cfg.customOptions = opts;
        return cfg;
      }
      case 'wireguard': {
        return {
          enabled: true,
          configFile: config.configFile || undefined,
          interface: {
            privateKey: config.privateKey ?? '',
            address: splitCsv(config.address),
            dns: splitCsv(config.dns).length ? splitCsv(config.dns) : undefined,
            mtu: config.mtu || undefined,
          },
          peer: {
            publicKey: config.publicKey ?? '',
            presharedKey: config.presharedKey || undefined,
            endpoint: config.endpoint || undefined,
            allowedIPs: splitCsv(config.allowedIPs || '0.0.0.0/0'),
            persistentKeepalive: config.persistentKeepalive || undefined,
          },
        };
      }
      case 'tailscale': {
        const cfg: Record<string, unknown> = { enabled: true };
        if (config.authKey) cfg.authKey = config.authKey;
        if (config.loginServer) cfg.loginServer = config.loginServer;
        if (config.exitNode) cfg.exitNode = config.exitNode;
        const routes = splitCsv(config.routes);
        if (routes.length) cfg.routes = routes;
        const advRoutes = splitCsv(config.advertiseRoutes);
        if (advRoutes.length) cfg.advertiseRoutes = advRoutes;
        if (config.acceptRoutes) cfg.acceptRoutes = true;
        if (config.ssh) cfg.ssh = true;
        const opts = splitLines(config.customOptions);
        if (opts.length) cfg.customOptions = opts;
        return cfg;
      }
      case 'zerotier': {
        const cfg: Record<string, unknown> = {
          enabled: true,
          networkId: config.networkId ?? '',
        };
        if (config.allowManaged !== undefined) cfg.allowManaged = config.allowManaged;
        if (config.allowGlobal !== undefined) cfg.allowGlobal = config.allowGlobal;
        if (config.allowDefault !== undefined) cfg.allowDefault = config.allowDefault;
        if (config.allowDNS !== undefined) cfg.allowDNS = config.allowDNS;
        const opts = splitLines(config.customOptions);
        if (opts.length) cfg.customOptions = opts;
        return cfg;
      }
      case 'pptp': {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? '',
          username: config.username ?? '',
          password: config.password ?? '',
        };
        if (config.domain) cfg.domain = config.domain;
        if (config.requireMppe !== undefined) cfg.requireMppe = config.requireMppe;
        if (config.mppeStateful !== undefined) cfg.mppeStateful = config.mppeStateful;
        if (config.refuseEap !== undefined) cfg.refuseEap = config.refuseEap;
        if (config.refusePap !== undefined) cfg.refusePap = config.refusePap;
        if (config.refuseChap !== undefined) cfg.refuseChap = config.refuseChap;
        if (config.refuseMsChap !== undefined) cfg.refuseMsChap = config.refuseMsChap;
        if (config.refuseMsChapV2 !== undefined) cfg.refuseMsChapV2 = config.refuseMsChapV2;
        if (config.nobsdcomp !== undefined) cfg.nobsdcomp = config.nobsdcomp;
        if (config.nodeflate !== undefined) cfg.nodeflate = config.nodeflate;
        if (config.noVjComp !== undefined) cfg.noVjComp = config.noVjComp;
        const pptpOpts = splitLines(config.customOptions);
        if (pptpOpts.length) cfg.customOptions = pptpOpts;
        return cfg;
      }
      case 'l2tp': {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? '',
          username: config.username ?? '',
          password: config.password ?? '',
        };
        // PPP settings
        const ppp: Record<string, unknown> = {};
        if (config.pppMru) ppp.mru = config.pppMru;
        if (config.pppMtu) ppp.mtu = config.pppMtu;
        if (config.lcpEchoInterval) ppp.lcpEchoInterval = config.lcpEchoInterval;
        if (config.lcpEchoFailure) ppp.lcpEchoFailure = config.lcpEchoFailure;
        if (config.requireChap !== undefined) ppp.requireChap = config.requireChap;
        if (config.requireMsChapV2 !== undefined) ppp.requireMsChapV2 = config.requireMsChapV2;
        if (config.requireEap !== undefined) ppp.requireEap = config.requireEap;
        if (Object.keys(ppp).length) cfg.pppSettings = ppp;
        // IPsec settings
        const ipsec: Record<string, unknown> = {};
        if (config.ipsecIke) ipsec.ike = config.ipsecIke;
        if (config.ipsecEsp) ipsec.esp = config.ipsecEsp;
        if (config.ipsecPfs) ipsec.pfs = config.ipsecPfs;
        if (Object.keys(ipsec).length) cfg.ipsecSettings = ipsec;
        const l2tpOpts = splitLines(config.customOptions);
        if (l2tpOpts.length) cfg.customOptions = l2tpOpts;
        return cfg;
      }
      case 'ikev2': {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? '',
          username: config.username ?? '',
        };
        if (config.password) cfg.password = config.password;
        if (config.certificate) cfg.certificate = config.certificate;
        if (config.privateKey) cfg.privateKey = config.privateKey;
        if (config.caCertificate) cfg.caCertificate = config.caCertificate;
        if (config.eapMethod) cfg.eapMethod = config.eapMethod;
        if (config.phase1Algorithms) cfg.phase1Algorithms = config.phase1Algorithms;
        if (config.phase2Algorithms) cfg.phase2Algorithms = config.phase2Algorithms;
        if (config.localId) cfg.localId = config.localId;
        if (config.remoteId) cfg.remoteId = config.remoteId;
        if (config.fragmentation !== undefined) cfg.fragmentation = config.fragmentation;
        if (config.mobike !== undefined) cfg.mobike = config.mobike;
        const ikev2Opts = splitLines(config.customOptions);
        if (ikev2Opts.length) cfg.customOptions = ikev2Opts;
        return cfg;
      }
      case 'ipsec': {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? '',
        };
        if (config.authMethod) cfg.authMethod = config.authMethod;
        if (config.psk) cfg.psk = config.psk;
        if (config.certificate) cfg.certificate = config.certificate;
        if (config.privateKey) cfg.privateKey = config.privateKey;
        if (config.caCertificate) cfg.caCertificate = config.caCertificate;
        if (config.phase1Proposals) cfg.phase1Proposals = config.phase1Proposals;
        if (config.phase2Proposals) cfg.phase2Proposals = config.phase2Proposals;
        if (config.saLifetime) cfg.saLifetime = config.saLifetime;
        if (config.dpdDelay) cfg.dpdDelay = config.dpdDelay;
        if (config.dpdTimeout) cfg.dpdTimeout = config.dpdTimeout;
        if (config.tunnelMode !== undefined) cfg.tunnelMode = config.tunnelMode;
        const ipsecOpts = splitLines(config.customOptions);
        if (ipsecOpts.length) cfg.customOptions = ipsecOpts;
        return cfg;
      }
      case 'sstp': {
        const cfg: Record<string, unknown> = {
          enabled: true,
          server: config.server ?? '',
          username: config.username ?? '',
        };
        if (config.password) cfg.password = config.password;
        if (config.domain) cfg.domain = config.domain;
        if (config.certificate) cfg.certificate = config.certificate;
        if (config.caCertificate) cfg.caCertificate = config.caCertificate;
        if (config.ignoreCertificate !== undefined) cfg.ignoreCertificate = config.ignoreCertificate;
        const sstpOpts = splitLines(config.customOptions);
        if (sstpOpts.length) cfg.customOptions = sstpOpts;
        return cfg;
      }
    }
  }, [vpnType, config]);

  // Save
  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const typedConfig = buildTypedConfig();
      if (editingId) {
        // Update existing connection
        switch (vpnType) {
          case 'openvpn':
            await mgr.updateOpenVPNConnection(editingId, name.trim(), typedConfig as any);
            break;
          case 'wireguard':
            await mgr.updateWireGuardConnection(editingId, name.trim(), typedConfig as any);
            break;
          case 'tailscale':
            await mgr.updateTailscaleConnection(editingId, name.trim(), typedConfig as any);
            break;
          case 'zerotier':
            await mgr.updateZeroTierConnection(editingId, name.trim(), typedConfig as any);
            break;
          case 'pptp':
            await mgr.updatePPTPConnection(editingId, name.trim(), typedConfig as any);
            break;
          case 'l2tp':
            await mgr.updateL2TPConnection(editingId, name.trim(), typedConfig as any);
            break;
          case 'ikev2':
            await mgr.updateIKEv2Connection(editingId, name.trim(), typedConfig as any);
            break;
          case 'ipsec':
            await mgr.updateIPsecConnection(editingId, name.trim(), typedConfig as any);
            break;
          case 'sstp':
            await mgr.updateSSTPConnection(editingId, name.trim(), typedConfig as any);
            break;
        }
      } else {
        // Create new connection
        switch (vpnType) {
          case 'openvpn':
            await mgr.createOpenVPNConnection(name.trim(), typedConfig as any);
            break;
          case 'wireguard':
            await mgr.createWireGuardConnection(name.trim(), typedConfig as any);
            break;
          case 'tailscale':
            await mgr.createTailscaleConnection(name.trim(), typedConfig as any);
            break;
          case 'zerotier':
            await mgr.createZeroTierConnection(name.trim(), typedConfig as any);
            break;
          case 'pptp':
            await mgr.createPPTPConnection(name.trim(), typedConfig as any);
            break;
          case 'l2tp':
            await mgr.createL2TPConnection(name.trim(), typedConfig as any);
            break;
          case 'ikev2':
            await mgr.createIKEv2Connection(name.trim(), typedConfig as any);
            break;
          case 'ipsec':
            await mgr.createIPsecConnection(name.trim(), typedConfig as any);
            break;
          case 'sstp':
            await mgr.createSSTPConnection(name.trim(), typedConfig as any);
            break;
        }
      }
      resetForm();
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save VPN connection');
    } finally {
      setIsSaving(false);
    }
  }, [name, vpnType, editingId, buildTypedConfig, mgr, resetForm, onSave]);

  const canSave = name.trim() !== '';

  return {
    name, setName,
    description, setDescription,
    vpnType, handleTypeChange,
    config, updateConfig, setConfig,
    tags, tagInput, setTagInput,
    handleAddTag, handleRemoveTag, handleTagKeyDown,
    isSaving, error,
    handleSave, canSave,
    editingConnection,
    editingId,
    resetForm,
  };
}
