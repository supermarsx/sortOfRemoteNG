import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { BiometricStatus } from '../../types/biometrics';

export interface BiometricInfo {
  /** Whether biometric auth is usable right now (hardware present + enrolled). */
  available: boolean;
  /** Whether the user has enrolled biometrics. */
  enrolled: boolean;
  /** Platform-specific label: "Touch ID", "Windows Hello", "Fingerprint". */
  platformLabel: string;
  /** Detected biometric kinds. */
  kinds: string[];
  /** Icon hint for the frontend: 'fingerprint' | 'face' | 'shield'. */
  iconHint: 'fingerprint' | 'face' | 'shield';
  /** Whether legacy biometric setup needs migration (macOS only). */
  needsMigration: boolean;
}

/**
 * React hook that queries the backend for biometric hardware info.
 * Returns platform-aware data for rendering the correct labels and icons.
 */
export function useBiometricInfo() {
  const [info, setInfo] = useState<BiometricInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const [status, needsMigration] = await Promise.all([
          invoke<BiometricStatus>('biometric_check_availability'),
          invoke<boolean>('biometric_needs_migration').catch(() => false),
        ]);

        if (cancelled) return;

        const iconHint: BiometricInfo['iconHint'] =
          status.kinds.includes('fingerprint') ? 'fingerprint'
          : status.kinds.includes('face_recognition') ? 'face'
          : 'shield';

        setInfo({
          available: status.hardwareAvailable && status.enrolled,
          enrolled: status.enrolled,
          platformLabel: status.platformLabel,
          kinds: status.kinds,
          iconHint,
          needsMigration,
        });
      } catch {
        if (!cancelled) setInfo(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  return { info, loading };
}
