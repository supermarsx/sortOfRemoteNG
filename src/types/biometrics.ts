/** Biometric sensor kind returned by the backend. */
export type BiometricKind = 'fingerprint' | 'face_recognition' | 'iris' | 'other';

/** macOS-specific biometry classification. */
export type BiometryType = 'touch_id' | 'face_id' | 'optic_id' | 'none';

/** Detailed biometric hardware/enrollment status from the backend. */
export interface BiometricStatus {
  hardwareAvailable: boolean;
  enrolled: boolean;
  kinds: BiometricKind[];
  platformLabel: string;
  biometryType: BiometryType;
  unavailableReason: string | null;
}

/** Platform-specific info for UI rendering. */
export interface BiometricPlatformInfo {
  os: string;
  platformLabel: string;
  iconHint: 'fingerprint' | 'face' | 'shield';
}
