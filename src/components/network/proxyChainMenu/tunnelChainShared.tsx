import React from "react";
import type { TunnelChainLayer } from "../../../types/connection/connection";
import { getTypeIcon, getTypeLabel } from "./tunnelChainShared.helpers";

// ── Per-layer config forms ──────────────────────────────────────

export function ProxyLayerConfig({ layer, onUpdate }: { layer: TunnelChainLayer; onUpdate: (u: Partial<TunnelChainLayer>) => void }) {
  const proxy = layer.proxy ?? { proxyType: 'socks5' as const, host: '', port: 1080 };
  const up = (updates: Partial<typeof proxy>) => onUpdate({ proxy: { ...proxy, ...updates } });

  return (
    <div className="grid grid-cols-3 gap-2 mt-2">
      <select
        value={proxy.proxyType}
        onChange={e => up({ proxyType: e.target.value as any })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      >
        <option value="socks5">SOCKS5</option>
        <option value="socks4">SOCKS4</option>
        <option value="http">HTTP</option>
        <option value="https">HTTPS</option>
        <option value="http-connect">HTTP CONNECT</option>
      </select>
      <input
        type="text" placeholder="Host" value={proxy.host}
        onChange={e => up({ host: e.target.value })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
      <input
        type="number" placeholder="Port" value={proxy.port}
        onChange={e => up({ port: parseInt(e.target.value) || 0 })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
    </div>
  );
}

export function SshJumpLayerConfig({ layer, onUpdate }: { layer: TunnelChainLayer; onUpdate: (u: Partial<TunnelChainLayer>) => void }) {
  const ssh = layer.sshTunnel ?? { forwardType: 'local' as const, host: '', port: 22, username: '' };
  const up = (updates: Partial<typeof ssh>) => onUpdate({ sshTunnel: { ...ssh, ...updates } });

  return (
    <div className="grid grid-cols-4 gap-2 mt-2">
      <input
        type="text" placeholder="Host" value={ssh.host ?? ''}
        onChange={e => up({ host: e.target.value })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
      <input
        type="number" placeholder="Port" value={ssh.port ?? 22}
        onChange={e => up({ port: parseInt(e.target.value) || 22 })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
      <input
        type="text" placeholder="Username" value={ssh.username ?? ''}
        onChange={e => up({ username: e.target.value })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
      <input
        type="password" placeholder="Password" value={ssh.password ?? ''}
        onChange={e => up({ password: e.target.value })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
    </div>
  );
}

export function VpnLayerConfig({ layer, onUpdate }: { layer: TunnelChainLayer; onUpdate: (u: Partial<TunnelChainLayer>) => void }) {
  const vpn = layer.vpn ?? {};
  const up = (updates: Partial<typeof vpn>) => onUpdate({ vpn: { ...vpn, ...updates } });

  return (
    <div className="grid grid-cols-3 gap-2 mt-2">
      <input
        type="text" placeholder="Config ID or path" value={vpn.configId ?? vpn.configFile ?? ''}
        onChange={e => up({ configId: e.target.value })}
        className="col-span-2 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
      <select
        value={vpn.protocol ?? 'udp'}
        onChange={e => up({ protocol: e.target.value as any })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      >
        <option value="udp">UDP</option>
        <option value="tcp">TCP</option>
      </select>
    </div>
  );
}

export function MeshLayerConfig({ layer, onUpdate }: { layer: TunnelChainLayer; onUpdate: (u: Partial<TunnelChainLayer>) => void }) {
  const mesh = layer.mesh ?? {};
  const up = (updates: Partial<typeof mesh>) => onUpdate({ mesh: { ...mesh, ...updates } });

  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      <input
        type="text" placeholder="Network ID" value={mesh.networkId ?? ''}
        onChange={e => up({ networkId: e.target.value })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
      <input
        type="text" placeholder="Auth Key" value={mesh.authKey ?? ''}
        onChange={e => up({ authKey: e.target.value })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
    </div>
  );
}

export function TunnelLayerConfig({ layer, onUpdate }: { layer: TunnelChainLayer; onUpdate: (u: Partial<TunnelChainLayer>) => void }) {
  const tunnel = layer.tunnel ?? {};
  const up = (updates: Partial<typeof tunnel>) => onUpdate({ tunnel: { ...tunnel, ...updates } });

  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      <input
        type="text" placeholder="Server URL" value={tunnel.serverUrl ?? ''}
        onChange={e => up({ serverUrl: e.target.value })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
      <input
        type="text" placeholder="Auth Token" value={tunnel.authToken ?? ''}
        onChange={e => up({ authToken: e.target.value })}
        className="col-span-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
      />
    </div>
  );
}

export function LayerConfigForm({ layer, onUpdate }: { layer: TunnelChainLayer; onUpdate: (u: Partial<TunnelChainLayer>) => void }) {
  switch (layer.type) {
    case 'proxy':
    case 'shadowsocks':
    case 'tor':
      return <ProxyLayerConfig layer={layer} onUpdate={onUpdate} />;
    case 'ssh-jump':
    case 'ssh-tunnel':
    case 'ssh-proxycmd':
    case 'ssh-stdio':
      return <SshJumpLayerConfig layer={layer} onUpdate={onUpdate} />;
    case 'openvpn':
    case 'wireguard':
      return <VpnLayerConfig layer={layer} onUpdate={onUpdate} />;
    case 'tailscale':
    case 'zerotier':
      return <MeshLayerConfig layer={layer} onUpdate={onUpdate} />;
    case 'stunnel':
    case 'chisel':
    case 'ngrok':
    case 'cloudflared':
      return <TunnelLayerConfig layer={layer} onUpdate={onUpdate} />;
    default:
      return (
        <div className="mt-2 text-xs text-[var(--color-textMuted)]">
          No configuration options for {getTypeLabel(layer.type)}
        </div>
      );
  }
}

// ── Chain preview ───────────────────────────────────────────────

export function ChainPreviewInline({ layers }: { layers: TunnelChainLayer[] }) {
  const enabled = layers.filter(l => l.enabled);
  if (enabled.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {enabled.map((layer, idx) => (
        <React.Fragment key={layer.id}>
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]">
            {getTypeIcon(layer.type)}
            {layer.name || getTypeLabel(layer.type)}
          </span>
          {idx < enabled.length - 1 && (
            <span className="text-[var(--color-textMuted)] text-xs">&rarr;</span>
          )}
        </React.Fragment>
      ))}
      <span className="text-[var(--color-textMuted)] text-xs">&rarr; Target</span>
    </div>
  );
}
