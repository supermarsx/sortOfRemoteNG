import { describe, it, expect } from 'vitest';
import { WakeOnLanService } from '../wakeOnLan';

describe('WakeOnLanService', () => {
  it('formats MAC addresses', () => {
    expect(WakeOnLanService.formatMacAddress('AABBCCDDEEFF')).toBe('aa:bb:cc:dd:ee:ff');
    expect(WakeOnLanService.formatMacAddress('aa-bb-cc-dd-ee-ff')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('validates MAC addresses', () => {
    expect(WakeOnLanService.validateMacAddress('aa:bb:cc:dd:ee:ff')).toBe(true);
    expect(WakeOnLanService.validateMacAddress('gg:hh:ii:jj:kk:ll')).toBe(false);
  });

  it('creates a proper magic packet', () => {
    const service = new WakeOnLanService();
    const packet = (service as any).createMagicPacket('aabbccddeeff');
    expect(packet.length).toBe(102);
    for (let i = 0; i < 6; i++) {
      expect(packet[i]).toBe(0xff);
    }
    const mac = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    expect(packet.slice(6, 12)).toEqual(mac);
    expect(packet.slice(packet.length - 6)).toEqual(mac);
  });
});
