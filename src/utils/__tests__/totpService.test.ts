import { describe, it, expect } from 'vitest';
import { TOTPService } from '../totpService';

describe('TOTPService', () => {
  const service = new TOTPService();

  it('generates tokens with custom digits', () => {
    const secret = service.generateSecret();
    const token = service.generateToken(secret, { digits: 8 });
    expect(token).toHaveLength(8);
  });

  it('verifies tokens with custom period', () => {
    const secret = service.generateSecret();
    const token = service.generateToken(secret, { period: 60 });
    expect(service.verifyToken(token, secret, { period: 60 })).toBe(true);
  });
});
