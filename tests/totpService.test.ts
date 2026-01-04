import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authenticator } from 'otplib';
import { TOTPService } from '../src/utils/totpService';

vi.mock('qrcode', () => ({
  toDataURL: vi.fn(async () => 'data:url')
}));

describe('TOTPService', () => {
  let service: TOTPService;

  beforeEach(() => {
    service = new TOTPService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates and verifies tokens with default options', () => {
    const secret = service.generateSecret();
    const token = service.generateToken(secret);

    // authenticator default options match service defaults
    const expected = authenticator.generate(secret);
    expect(token).toBe(expected);
    expect(service.verifyToken(token, secret)).toBe(true);
  });

  it('generates and verifies tokens with custom options', () => {
    const secret = service.generateSecret();
    const options = { digits: 8, period: 60, algorithm: 'sha256' as const };

    const token = service.generateToken(secret, options);

    const expected = authenticator
      .clone({
        digits: options.digits,
        step: options.period,
        algorithm: options.algorithm as any,
      })
      .generate(secret);
    expect(token).toBe(expected);
    expect(service.verifyToken(token, secret, options)).toBe(true);
  });

  it('verifies tokens from previous time step using window option', () => {
    const secret = service.generateSecret();
    const step = 30;

    const oldToken = authenticator
      .clone({ digits: 6, step, algorithm: 'sha1' as any, epoch: Date.now() - step * 1000 })
      .generate(secret);

    expect(service.verifyToken(oldToken, secret)).toBe(true);
  });

  it('does not mutate global authenticator when using custom options', () => {
    const original = { ...authenticator.options };
    const secret = service.generateSecret();
    service.generateToken(secret, { digits: 8 });
    expect(authenticator.options).toEqual(original);
  });

  it('loads qrcode module only once when generating multiple QR codes', async () => {
    const spy = vi.spyOn(service as any, 'importQRCode');
    const config = {
      secret: 'S',
      issuer: 'iss',
      account: 'acc',
      digits: 6,
      period: 30,
      algorithm: 'sha1' as const
    };

    await service.generateQRCode(config);
    await service.generateQRCode(config);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('generates unique backup codes of correct length', () => {
    const codes = service.generateBackupCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach(code => expect(code).toHaveLength(8));
  });
});
