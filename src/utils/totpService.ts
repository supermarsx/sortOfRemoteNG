import { authenticator } from 'otplib';
import { Authenticator } from '@otplib/core';
import { TOTPConfig } from '../types/settings';
import { LocalStorageService } from './localStorageService';

export class TOTPService {
  private readonly storageKey = 'mremote-totp-configs';
  private qrCodeModulePromise?: Promise<typeof import('qrcode')>;

  private importQRCode() {
    return import('qrcode');
  }

  private loadQRCodeModule() {
    if (!this.qrCodeModulePromise) {
      this.qrCodeModulePromise = this.importQRCode();
    }
    return this.qrCodeModulePromise;
  }

  generateSecret(): string {
    const instance = new Authenticator(authenticator.options);
    return instance.generateSecret();
  }

  generateToken(secret: string, config?: Partial<TOTPConfig>): string {
    const instance = new Authenticator(authenticator.options);
    instance.options = {
      ...instance.options,
      digits: config?.digits ?? 6,
      step: config?.period ?? 30,
      algorithm: (config?.algorithm ?? 'SHA1').toLowerCase(),
    };
    return instance.generate(secret);
  }

  verifyToken(token: string, secret: string, config?: Partial<TOTPConfig>): boolean {
    const instance = new Authenticator(authenticator.options);
    instance.options = {
      ...instance.options,
      digits: config?.digits ?? 6,
      step: config?.period ?? 30,
      algorithm: (config?.algorithm ?? 'SHA1').toLowerCase(),
      window: 1, // Allow 1 step tolerance
    };
    return instance.verify({ token, secret });
  }

  generateOTPAuthURL(config: TOTPConfig): string {
    const instance = new Authenticator(authenticator.options);
    return instance.keyuri(config.account, config.issuer, config.secret);
  }

  saveConfig(config: TOTPConfig): void {
    const configs = this.getAllConfigs();
    const existingIndex = configs.findIndex(c => c.secret === config.secret);
    
    if (existingIndex >= 0) {
      configs[existingIndex] = config;
    } else {
      configs.push(config);
    }
    
    LocalStorageService.setItem(this.storageKey, configs);
  }

  getAllConfigs(): TOTPConfig[] {
    try {
      const stored = LocalStorageService.getItem<TOTPConfig[]>(this.storageKey);
      return stored ? stored : [];
    } catch (error) {
      console.error('Failed to load TOTP configs:', error);
      return [];
    }
  }

  getConfig(secret: string): TOTPConfig | undefined {
    return this.getAllConfigs().find(config => config.secret === secret);
  }

  deleteConfig(secret: string): void {
    const configs = this.getAllConfigs().filter(config => config.secret !== secret);
    LocalStorageService.setItem(this.storageKey, configs);
  }

  // Generate QR code data URL
  async generateQRCode(config: TOTPConfig): Promise<string> {
    const QRCode = await this.loadQRCodeModule();
    const otpAuthUrl = this.generateOTPAuthURL(config);
    return QRCode.toDataURL(otpAuthUrl);
  }

  // Get time remaining for current token
  getTimeRemaining(period: number = 30): number {
    const now = Math.floor(Date.now() / 1000);
    return period - (now % period);
  }

  // Backup codes generation
  generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    
    for (let i = 0; i < count; i++) {
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      codes.push(code);
    }
    
    return codes;
  }

  // Export TOTP configs for backup
  exportConfigs(): string {
    const configs = this.getAllConfigs();
    return JSON.stringify(configs, null, 2);
  }

  // Import TOTP configs from backup
  importConfigs(jsonData: string): void {
    try {
      const configs = JSON.parse(jsonData) as TOTPConfig[];
      
      // Validate configs
      configs.forEach(config => {
        if (!config.secret || !config.account || !config.issuer) {
          throw new Error('Invalid TOTP configuration format');
        }
      });
      
      LocalStorageService.setItem(this.storageKey, configs);
    } catch (error) {
      throw new Error('Failed to import TOTP configurations: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }
}
