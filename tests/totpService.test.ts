import { describe, it, expect, beforeEach } from 'vitest';
import { authenticator } from 'otplib';
import { TOTPService } from '../src/utils/totpService';

describe('TOTPService', () => {
  let service: TOTPService;

  beforeEach(() => {
    service = new TOTPService();
  });

  it('generates and verifies tokens with default options', () => {
    const secret = service.generateSecret();
    const token = service.generateToken(secret);

    // authenticator uses same default options after generateToken
    const expected = authenticator.generate(secret);
    expect(token).toBe(expected);
    expect(service.verifyToken(token, secret)).toBe(true);
  });

  it('generates and verifies tokens with custom options', () => {
    const secret = service.generateSecret();
    const options = { digits: 8, period: 60, algorithm: 'SHA256' as const };

    const token = service.generateToken(secret, options);

    authenticator.options = {
      digits: options.digits,
      step: options.period,
      algorithm: options.algorithm.toLowerCase(),
      window: 1,
    };
    const expected = authenticator.generate(secret);
    expect(token).toBe(expected);
    expect(service.verifyToken(token, secret, options)).toBe(true);
  });

  it('verifies tokens from previous time step using window option', () => {
    const secret = service.generateSecret();
    const step = 30;

    authenticator.options = { digits: 6, step, algorithm: 'sha1', epoch: Date.now() - step * 1000 };
    const oldToken = authenticator.generate(secret);

    expect(service.verifyToken(oldToken, secret)).toBe(true);
  });
});
