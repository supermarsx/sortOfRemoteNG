import { generateId } from "../core/id";

export const SSH_SESSION_ACTIVITY_STORAGE_KEY = "sshSessionActivity";
export const SSH_SESSION_ACTIVITY_SYNC_EVENT =
  "sortofremoteng:ssh-session-activity-sync";

export type SSHSessionActivityKind = "connected" | "disconnected";

export interface SSHSessionActivityRecord {
  id: string;
  recordedAt: string;
  sessionId: string;
  sessionName: string;
  hostname: string;
  kind: SSHSessionActivityKind;
  source: "web-terminal-lifecycle";
}

const MAX_ACTIVITY_RECORDS = 1000;

export function appendSSHSessionActivity(
  record: Omit<SSHSessionActivityRecord, "id" | "recordedAt" | "source">,
): void {
  if (typeof window === "undefined") return;
  try {
    const stored = window.localStorage.getItem(
      SSH_SESSION_ACTIVITY_STORAGE_KEY,
    );
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    const existing = Array.isArray(parsed) ? parsed : [];
    const next: SSHSessionActivityRecord = {
      id: generateId(),
      recordedAt: new Date().toISOString(),
      sessionId: record.sessionId.slice(0, 512),
      sessionName: record.sessionName.slice(0, 512),
      hostname: record.hostname.slice(0, 512),
      kind: record.kind,
      source: "web-terminal-lifecycle",
    };
    window.localStorage.setItem(
      SSH_SESSION_ACTIVITY_STORAGE_KEY,
      JSON.stringify([...existing, next].slice(-MAX_ACTIVITY_RECORDS)),
    );
    window.dispatchEvent(new Event(SSH_SESSION_ACTIVITY_SYNC_EVENT));
  } catch {
    // Lifecycle telemetry is best-effort and must never break the session.
  }
}
