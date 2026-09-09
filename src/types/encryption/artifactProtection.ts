export const MUTABLE_ARTIFACT_IDS = [
  "connections",
  "databases-index",
  "trust-store",
  "settings",
  "recordings-meta",
  "recordings-media",
  "backups",
  "logs",
  "macros",
] as const;
export type MutableArtifactId = (typeof MUTABLE_ARTIFACT_IDS)[number];
export type ArtifactId = MutableArtifactId | "key-ring" | "artifact-policy";
export type ArtifactPolicyTarget = "encrypted" | "plaintext";
export interface ArtifactProtectionStatus {
  id: ArtifactId;
  policy: "default" | ArtifactPolicyTarget;
  diskState: "encrypted" | "plaintext" | "mixed" | "absent" | "unverified";
  encryptedFiles: number;
  plaintextFiles: number;
  unverifiedFiles: number;
  bytes: number;
  mutable: boolean;
  reason?: string | null;
}
export interface ArtifactProtectionSnapshot {
  artifacts: ArtifactProtectionStatus[];
  unlocked: boolean;
  recoveryRequired: boolean;
  busy: boolean;
  policyError?: string | null;
  warnings: string[];
}
export interface ArtifactPolicyPreview {
  token: string;
  target: ArtifactPolicyTarget;
  artifacts: ArtifactProtectionStatus[];
  totalFiles: number;
  totalBytes: number;
}
export interface ArtifactPolicyResult {
  requestId: string;
  outcome: "completed" | "cancelled" | "failed";
  results: {
    id: ArtifactId;
    outcome: "committed" | "unchanged" | "failed" | "not-attempted";
    files: number;
    error?: string | null;
  }[];
  recoveryRequired: boolean;
  error?: string | null;
}
export interface ArtifactPolicyProgress {
  requestId: string;
  phase: "scan" | "stage" | "commit" | "rollback" | "complete";
  completed: number;
  total: number;
}
export function isMutableArtifactId(id: string): id is MutableArtifactId {
  return (MUTABLE_ARTIFACT_IDS as readonly string[]).includes(id);
}
