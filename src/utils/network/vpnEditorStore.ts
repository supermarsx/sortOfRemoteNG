/**
 * Simple module-level store for passing VPN editing context between
 * VpnConnectionsTab -> VpnEditor tab. Written to before opening the
 * editor tab, read on mount, and cleared after reading.
 */

export interface VpnEditingData {
  id: string;
  vpnType: 'openvpn' | 'wireguard' | 'tailscale' | 'zerotier';
  name: string;
  config: Record<string, any>;
}

let pendingEdit: VpnEditingData | null = null;

export function setPendingVpnEdit(data: VpnEditingData | null): void {
  pendingEdit = data;
}

export function consumePendingVpnEdit(): VpnEditingData | null {
  const data = pendingEdit;
  pendingEdit = null;
  return data;
}
