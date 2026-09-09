import { MUTABLE_ARTIFACT_IDS } from "../../src/types/encryption/artifactProtection";
import { refuse } from "./failures";

export const demoDatabaseId = "docs-demo-database";
export const commandCalls: string[] = [];
const date = "2026-09-09T09:00:00Z";
const trustRecords = [
  {
    host: "dashboard.example.test:443",
    record_type: "tls",
    identity: {
      kind: "tls",
      fingerprint: Array.from({ length: 32 }, (_, i) =>
        (i + 32).toString(16),
      ).join(":"),
      first_seen: date,
      last_seen: date,
      subject: "CN=dashboard.example.test",
      issuer: "CN=Example demonstration CA",
      valid_from: "2026-01-01T00:00:00Z",
      valid_to: "2027-01-01T00:00:00Z",
      san: ["dashboard.example.test"],
      key_algorithm: "RSA",
      key_size: 2048,
      signature_algorithm: "SHA256withRSA",
    },
    user_approved: true,
    tags: ["operations", "demo"],
    nickname: "Operations dashboard",
    history: [],
    revoked: false,
  },
  {
    host: "app.example.test:22",
    record_type: "ssh",
    identity: {
      kind: "ssh",
      fingerprint: "SHA256:DEMOExampleHostKey00000000000000000000000000",
      first_seen: date,
      last_seen: date,
      key_type: "ssh-ed25519",
      key_bits: 256,
    },
    user_approved: true,
    tags: ["servers", "demo"],
    nickname: "Application server",
    history: [],
    host_policy: "strict",
    revoked: false,
  },
];
const capabilities = {
  rdp: true,
  serial: true,
  cloud: true,
  ops: true,
  mysql: true,
  postgresql: true,
  mongodb: true,
  mssql: true,
  sqlite: true,
  redis: true,
  platform: true,
  collab: true,
  softether: true,
  scriptEngine: true,
  opkssh: true,
};
const artifactStatus = {
  unlocked: true,
  busy: false,
  recoveryRequired: false,
  warnings: [
    "Documentation demo data. No application files were inspected or changed.",
  ],
  artifacts: [
    ...MUTABLE_ARTIFACT_IDS.map((id, index) => ({
      id,
      policy: "encrypted",
      diskState: index === 4 ? "mixed" : "encrypted",
      encryptedFiles: index + 1,
      plaintextFiles: index === 4 ? 2 : 0,
      unverifiedFiles: 0,
      bytes: 1048576 * (index + 1),
      mutable: true,
    })),
    ...["key-ring", "artifact-policy"].map((id) => ({
      id,
      policy: "encrypted",
      diskState: "encrypted",
      encryptedFiles: 1,
      plaintextFiles: 0,
      unverifiedFiles: 0,
      bytes: 2048,
      mutable: false,
      reason: "Protected key infrastructure; excluded from bulk changes.",
    })),
  ],
};
export async function invoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  commandCalls.push(command);
  if (command === "database_protection_unlock") {
    if (
      new URLSearchParams(location.search).get("view") !== "database" ||
      args?.databaseId !== demoDatabaseId ||
      args?.slotId !== "demo-vault-slot" ||
      args?.password !== undefined
    )
      refuse("unexpected fixture unlock request");
    return {
      sessionId: "synthetic-lease-never-a-native-token",
      sessionExpiresAt: Date.now() + 900000,
      securityRevision: "demo-revision",
      data: {
        connections: [],
        sessions: [],
        tabGroups: [],
        colorTags: {},
        settings: {},
      },
    } as T;
  }
  const replies: Record<string, unknown> = {
    get_runtime_capabilities: capabilities,
    read_app_data: null,
    encryption_get_artifact_status: artifactStatus,
    database_protection_capabilities: {
      schemaVersion: 1,
      ciphers: [
        { id: "aes-256-gcm", available: true },
        { id: "chacha20-poly1305", available: true },
        { id: "twofish-256-eax", available: true },
        { id: "serpent-256-eax", available: true },
      ],
      protectors: [
        {
          id: "password",
          available: true,
          deviceBound: false,
          requiresUserPresence: false,
        },
        {
          id: "os-vault",
          available: true,
          deviceBound: true,
          requiresUserPresence: false,
        },
        {
          id: "webauthn-prf",
          available: false,
          deviceBound: true,
          requiresUserPresence: true,
          reason: "Not available in this demonstrated build.",
        },
        {
          id: "biometric",
          available: false,
          deviceBound: true,
          requiresUserPresence: true,
          reason: "Not available in this demonstrated build.",
        },
      ],
    },
    database_protection_status: {
      kind: "managed",
      version: 1,
      dataCipher: "aes-256-gcm",
      securityRevision: "demo-revision",
      slots: [
        {
          id: "demo-password-slot",
          type: "password",
          label: "Recovery password",
          deviceBound: false,
        },
        {
          id: "demo-vault-slot",
          type: "os-vault",
          label: "This computer",
          deviceBound: true,
        },
      ],
      unlocked: true,
      sessionExpiresAt: Date.now() + 900000,
    },
    list_rdp_sessions: [
      {
        id: "demo-rdp-session",
        connection_id: "docs-demo-rdp",
        host: "desktop.example.test",
        port: 3389,
        username: "demo.operator",
        connected: true,
        desktop_width: 1920,
        desktop_height: 1080,
        viewer_attached: true,
      },
    ],
    get_rdp_stats: {
      session_id: "demo-rdp-session",
      uptime_secs: 1240,
      bytes_received: 31457280,
      bytes_sent: 524288,
      pdus_received: 2640,
      pdus_sent: 380,
      frame_count: 15600,
      fps: 30,
      input_events: 420,
      errors_recovered: 0,
      reactivations: 0,
      phase: "connected",
    },
    list_sessions: [
      {
        id: "demo-ssh-session",
        config: {
          host: "app.example.test",
          port: 22,
          username: "demo.operator",
        },
        connected_at: date,
        last_activity: date,
        is_alive: true,
      },
    ],
    get_proxy_session_details: [
      {
        session_id: "docs-demo-web",
        target_url: "https://dashboard.example.test/",
        username: "demo.operator",
        proxy_url: "http://127.0.0.1:40000",
        created_at: date,
        request_count: 48,
        error_count: 0,
        last_error: null,
      },
    ],
    get_proxy_request_log: [],
    "plugin:window|is_minimized": false,
    trust_get_active_database: {
      databaseId: demoDatabaseId,
      encrypted: true,
      recordCount: 2,
      seededRecords: 0,
    },
    trust_get_all_records: trustRecords,
    trust_get_summary: {
      total_records: 2,
      revoked_count: 0,
      expired_count: 0,
      records_with_history: 0,
      total_verifications: 24,
      total_mismatches: 0,
      average_trust_score: 100,
    },
  };
  if (!Object.prototype.hasOwnProperty.call(replies, command))
    refuse(`native command ${command}`);
  return structuredClone(replies[command]) as T;
}
export const isTauri = () => true;
export const convertFileSrc = () => refuse("native file URL");
export class Channel<T> {
  onmessage: (value: T) => void = () => {};
}
export class Resource {
  rid = 0;
  async close() {}
}
export const transformCallback = () => 0;
