import { describe, it, expect, vi } from 'vitest';
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

  it('schedules long delays and passes port', async () => {
    vi.useFakeTimers();
    const service = new WakeOnLanService();
    const sendSpy = vi
      .spyOn(service, 'sendWakePacket')
      .mockResolvedValue(undefined);
    const wakeTime = new Date(Date.now() + 0x7fffffff + 1000);

    service.scheduleWakeUp('00:11:22:33:44:55', wakeTime, undefined, 7);

    vi.advanceTimersByTime(0x7fffffff);
    expect(sendSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(sendSpy).toHaveBeenCalledWith('00:11:22:33:44:55', undefined, 7);

    vi.useRealTimers();
  });
});
