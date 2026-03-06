// Credential Rotation & Expiry Tracking types

export type CredentialKind = 'password' | 'ssh_key' | 'certificate' | 'api_key' | 'token' | 'totp_secret';
export type CredentialStrength = 'very_weak' | 'weak' | 'fair' | 'strong' | 'very_strong';
export type ComplianceStatus = 'compliant' | 'non_compliant' | 'warning' | 'unknown';
export type CredAlertSeverity = 'info' | 'warning' | 'critical';

export interface TrackedCredential {
  id: string;
  connectionId: string;
  connectionName: string;
  kind: CredentialKind;
  label: string;
  createdAt: string;
  lastRotated: string | null;
  expiresAt: string | null;
  rotationCount: number;
  strength: CredentialStrength;
  ageDays: number;
  isExpired: boolean;
  isStale: boolean;
  metadata: Record<string, unknown>;
}

export interface RotationPolicy {
  id: string;
  name: string;
  kind: CredentialKind;
  maxAgeDays: number;
  warningDays: number;
  requireMinStrength: CredentialStrength;
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigits: boolean;
  requireSpecial: boolean;
  forbidReuse: number;
  enabled: boolean;
}

export interface CredentialGroup {
  id: string;
  name: string;
  description: string;
  credentialIds: string[];
  policyId: string | null;
}

export interface CredentialAlert {
  id: string;
  credentialId: string;
  alertType: 'expired' | 'expiring_soon' | 'stale' | 'weak' | 'duplicate' | 'non_compliant';
  severity: CredAlertSeverity;
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface StrengthResult {
  strength: CredentialStrength;
  score: number;
  suggestions: string[];
  entropyBits: number;
}

export interface ComplianceResult {
  credentialId: string;
  policyId: string;
  status: ComplianceStatus;
  violations: string[];
}

export interface DuplicateGroup {
  hash: string;
  credentialIds: string[];
  count: number;
}

export interface CredentialAuditEntry {
  id: string;
  credentialId: string;
  action: string;
  timestamp: string;
  details: string;
}

export interface CredentialStats {
  total: number;
  byKind: Record<CredentialKind, number>;
  expired: number;
  expiringSoon: number;
  stale: number;
  weak: number;
  duplicateGroups: number;
  averageAgeDays: number;
  complianceRate: number;
}

export interface CredentialConfig {
  enabled: boolean;
  autoScanEnabled: boolean;
  scanIntervalMs: number;
  defaultWarningDays: number;
  defaultMaxAgeDays: number;
  trackPasswordStrength: boolean;
  detectDuplicates: boolean;
}
