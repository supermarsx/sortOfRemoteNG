import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTunnelChainEditor } from '../../src/hooks/network/useTunnelChainEditor';

describe('useTunnelChainEditor', () => {
  it('initializes with empty layers', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    expect(result.current.layers).toEqual([]);
    expect(result.current.isDirty).toBe(false);
  });

  it('initializes with provided layers', () => {
    const initial = [
      { id: '1', type: 'proxy' as const, enabled: true, proxy: { proxyType: 'socks5' as const, host: 'test', port: 1080 } },
    ];
    const { result } = renderHook(() => useTunnelChainEditor(initial));
    expect(result.current.layers).toHaveLength(1);
  });

  it('adds a layer', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('proxy'); });
    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].type).toBe('proxy');
    expect(result.current.layers[0].enabled).toBe(true);
    expect(result.current.isDirty).toBe(true);
  });

  it('removes a layer', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('proxy'); });
    const id = result.current.layers[0].id;
    act(() => { result.current.removeLayer(id); });
    expect(result.current.layers).toHaveLength(0);
  });

  it('toggles a layer', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('ssh-jump'); });
    const id = result.current.layers[0].id;
    expect(result.current.layers[0].enabled).toBe(true);
    act(() => { result.current.toggleLayer(id); });
    expect(result.current.layers[0].enabled).toBe(false);
    act(() => { result.current.toggleLayer(id); });
    expect(result.current.layers[0].enabled).toBe(true);
  });

  it('moves a layer up', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('proxy'); });
    act(() => { result.current.addLayer('ssh-jump'); });
    const secondId = result.current.layers[1].id;
    act(() => { result.current.moveLayer(secondId, 'up'); });
    expect(result.current.layers[0].id).toBe(secondId);
  });

  it('moves a layer down', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('proxy'); });
    act(() => { result.current.addLayer('ssh-jump'); });
    const firstId = result.current.layers[0].id;
    act(() => { result.current.moveLayer(firstId, 'down'); });
    expect(result.current.layers[1].id).toBe(firstId);
  });

  it('does not move first layer up', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('proxy'); });
    act(() => { result.current.addLayer('ssh-jump'); });
    const firstId = result.current.layers[0].id;
    act(() => { result.current.moveLayer(firstId, 'up'); });
    expect(result.current.layers[0].id).toBe(firstId); // unchanged
  });

  it('does not move last layer down', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('proxy'); });
    act(() => { result.current.addLayer('ssh-jump'); });
    const lastId = result.current.layers[1].id;
    act(() => { result.current.moveLayer(lastId, 'down'); });
    expect(result.current.layers[1].id).toBe(lastId); // unchanged
  });

  it('updates a layer', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('proxy'); });
    const id = result.current.layers[0].id;
    act(() => { result.current.updateLayer(id, { name: 'My Proxy' }); });
    expect(result.current.layers[0].name).toBe('My Proxy');
  });

  it('clears all layers', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('proxy'); });
    act(() => { result.current.addLayer('ssh-jump'); });
    act(() => { result.current.clearLayers(); });
    expect(result.current.layers).toHaveLength(0);
    expect(result.current.isDirty).toBe(true);
  });

  it('resets layers and clears dirty flag', () => {
    const { result } = renderHook(() => useTunnelChainEditor());
    act(() => { result.current.addLayer('proxy'); });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.resetLayers([
        { id: 'new-1', type: 'openvpn' as const, enabled: true },
      ]);
    });
    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].type).toBe('openvpn');
    expect(result.current.isDirty).toBe(false);
  });

  it('creates correct defaults for each tunnel type', () => {
    const { result } = renderHook(() => useTunnelChainEditor());

    const types = ['proxy', 'ssh-jump', 'ssh-tunnel', 'openvpn', 'wireguard', 'tailscale', 'zerotier', 'tor', 'shadowsocks'] as const;

    for (const type of types) {
      act(() => { result.current.addLayer(type); });
    }

    expect(result.current.layers).toHaveLength(types.length);

    // Verify proxy default
    const proxyLayer = result.current.layers.find(l => l.type === 'proxy');
    expect(proxyLayer?.proxy?.proxyType).toBe('socks5');

    // Verify tor default
    const torLayer = result.current.layers.find(l => l.type === 'tor');
    expect(torLayer?.proxy?.host).toBe('127.0.0.1');
    expect(torLayer?.proxy?.port).toBe(9050);
  });
});
