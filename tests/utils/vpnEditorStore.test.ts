import { describe, it, expect, beforeEach } from 'vitest';
import { setPendingVpnEdit, consumePendingVpnEdit } from '../../src/utils/network/vpnEditorStore';

describe('vpnEditorStore', () => {
  beforeEach(() => {
    // Clear any pending edit
    consumePendingVpnEdit();
  });

  it('returns null when no pending edit', () => {
    expect(consumePendingVpnEdit()).toBeNull();
  });

  it('stores and retrieves a pending edit', () => {
    const editData = {
      id: 'vpn-1',
      vpnType: 'openvpn' as const,
      name: 'My VPN',
      config: { remoteHost: 'vpn.test', remotePort: 1194 },
    };

    setPendingVpnEdit(editData);
    const result = consumePendingVpnEdit();

    expect(result).toEqual(editData);
  });

  it('consumes the edit (one-time read)', () => {
    setPendingVpnEdit({
      id: 'vpn-1',
      vpnType: 'wireguard' as const,
      name: 'WG VPN',
      config: {},
    });

    // First consume should return the data
    expect(consumePendingVpnEdit()).not.toBeNull();

    // Second consume should return null (already consumed)
    expect(consumePendingVpnEdit()).toBeNull();
  });

  it('can be overwritten before consumption', () => {
    setPendingVpnEdit({
      id: 'vpn-1',
      vpnType: 'openvpn' as const,
      name: 'First',
      config: {},
    });

    setPendingVpnEdit({
      id: 'vpn-2',
      vpnType: 'tailscale' as const,
      name: 'Second',
      config: {},
    });

    const result = consumePendingVpnEdit();
    expect(result!.id).toBe('vpn-2');
    expect(result!.name).toBe('Second');
  });

  it('can be cleared by setting null', () => {
    setPendingVpnEdit({
      id: 'vpn-1',
      vpnType: 'zerotier' as const,
      name: 'ZT',
      config: { networkId: 'abc123' },
    });

    setPendingVpnEdit(null);
    expect(consumePendingVpnEdit()).toBeNull();
  });
});
