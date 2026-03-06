// ── TypeScript types for sorng-warpgate crate ────────────────────────────────
// Warpgate: SSH/HTTPS/MySQL/PostgreSQL/Kubernetes bastion host admin API

// ── Connection ───────────────────────────────────────────────────────────────

export interface WarpgateConnectionConfig {
  name: string;
  /** Warpgate HTTPS admin URL, e.g. https://warpgate.example.com:8888 */
  host: string;
  /** Username for admin login */
  username: string;
  /** Password for admin login */
  password: string;
  timeoutSeconds?: number;
  skipTlsVerify?: boolean;
}

export interface WarpgateConnectionStatus {
  connected: boolean;
  host: string;
  version?: string;
}

// ── Targets ──────────────────────────────────────────────────────────────────

export type WarpgateTargetKind =
  | "Ssh"
  | "Http"
  | "MySql"
  | "WebAdmin"
  | "PostgreSql"
  | "Kubernetes";

export interface SshTargetPasswordAuth {
  password: string;
}

export type SshTargetPublicKeyAuth = Record<string, never>;

export type SshTargetAuth =
  | { type: "Password"; password: string }
  | { type: "PublicKey" };

export interface TargetSshOptions {
  host: string;
  port: number;
  username: string;
  auth: SshTargetAuth;
  allowInsecureAlgos?: boolean;
}

export interface TargetTlsOptions {
  mode: string;
  verify: boolean;
}

export interface TargetHttpOptions {
  url: string;
  tls?: TargetTlsOptions;
  headers?: Record<string, string>;
  externalHost?: string;
}

export interface TargetMySqlOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  tls?: TargetTlsOptions;
}

export interface TargetPostgreSqlOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  tls?: TargetTlsOptions;
}

export interface TargetKubernetesOptions {
  kubeconfig?: string;
  context?: string;
  namespace?: string;
}

export type TargetWebAdminOptions = Record<string, never>;

export type TargetOptions =
  | { kind: "Ssh" } & TargetSshOptions
  | { kind: "Http" } & TargetHttpOptions
  | { kind: "MySql" } & TargetMySqlOptions
  | { kind: "WebAdmin" } & TargetWebAdminOptions
  | { kind: "PostgreSql" } & TargetPostgreSqlOptions
  | { kind: "Kubernetes" } & TargetKubernetesOptions;

export interface WarpgateTarget {
  id: string;
  name: string;
  description?: string;
  options: TargetOptions;
  rateLimitBytesPerSecond?: number;
  groupId?: string;
}

export interface TargetDataRequest {
  name: string;
  description?: string;
  options: TargetOptions;
  rateLimitBytesPerSecond?: number;
  groupId?: string;
}

// ── Target Groups ────────────────────────────────────────────────────────────

export interface WarpgateTargetGroup {
  id: string;
  name: string;
  description?: string;
  color?: string;
}

export interface TargetGroupDataRequest {
  name: string;
  description?: string;
  color?: string;
}

// ── Roles ────────────────────────────────────────────────────────────────────

export interface WarpgateRole {
  id: string;
  name: string;
  description?: string;
}

export interface RoleDataRequest {
  name: string;
  description?: string;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface UserRequireCredentialsPolicy {
  password?: boolean;
  publicKey?: boolean;
  totp?: boolean;
  sso?: boolean;
  certificate?: boolean;
}

export interface WarpgateUser {
  id: string;
  username: string;
  description?: string;
  credentialPolicy?: UserRequireCredentialsPolicy;
  rateLimitBytesPerSecond?: number;
}

export interface CreateUserRequest {
  username: string;
  description?: string;
}

export interface UpdateUserRequest {
  username: string;
  credentialPolicy?: UserRequireCredentialsPolicy;
  description?: string;
  rateLimitBytesPerSecond?: number;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export interface WarpgateSession {
  id: string;
  username?: string;
  targetName?: string;
  started?: string;
  ended?: string;
  protocol?: string;
  [key: string]: unknown;
}

export interface SessionListResponse {
  data: WarpgateSession[];
  offset?: number;
  total?: number;
}

// ── Recordings ───────────────────────────────────────────────────────────────

export interface WarpgateRecording {
  id: string;
  sessionId: string;
  name: string;
  kind?: string;
  started?: string;
  ended?: string;
  [key: string]: unknown;
}

// ── Tickets ──────────────────────────────────────────────────────────────────

export interface WarpgateTicket {
  id: string;
  username: string;
  target: string;
  secret?: string;
  created?: string;
  expiry?: string;
  usesLeft?: number;
  description?: string;
}

export interface CreateTicketRequest {
  username: string;
  targetName: string;
  expiry?: string;
  numberOfUses?: number;
  description?: string;
}

export interface TicketAndSecret {
  ticket: WarpgateTicket;
  secret: string;
}

// ── Credentials ──────────────────────────────────────────────────────────────

// Password
export interface PasswordCredential {
  id: string;
}

export interface NewPasswordCredential {
  password: string;
}

// Public Key
export interface PublicKeyCredential {
  id: string;
  label?: string;
  dateAdded?: string;
  lastUsed?: string;
  opensshPublicKey?: string;
}

export interface NewPublicKeyCredential {
  label: string;
  opensshPublicKey: string;
}

// SSO
export interface SsoCredential {
  id: string;
  provider?: string;
  email?: string;
}

export interface NewSsoCredential {
  provider?: string;
  email: string;
}

// OTP
export interface OtpCredential {
  id: string;
}

export interface NewOtpCredential {
  secretKey: number[];
}

// Certificate
export interface CertificateCredential {
  id: string;
  label?: string;
  dateAdded?: string;
  lastUsed?: string;
  fingerprint?: string;
}

export interface IssueCertificateRequest {
  label: string;
  publicKeyPem: string;
}

export interface IssuedCertificate {
  credential: CertificateCredential;
  certificatePem: string;
}

export interface UpdateCertificateLabel {
  label: string;
}

// ── SSH Keys ─────────────────────────────────────────────────────────────────

export interface WarpgateSshKey {
  kind: string;
  publicKeyBase64: string;
}

// ── Known Hosts ──────────────────────────────────────────────────────────────

export interface WarpgateKnownHost {
  id: string;
  host: string;
  port: number;
  keyType: string;
  keyBase64: string;
}

export interface AddKnownHostRequest {
  host: string;
  port: number;
  keyType: string;
  keyBase64: string;
}

// ── SSH Connection Test ──────────────────────────────────────────────────────

export interface CheckSshHostKeyRequest {
  host: string;
  port: number;
}

export interface CheckSshHostKeyResponse {
  remoteKeyType: string;
  remoteKeyBase64: string;
}

// ── LDAP Servers ─────────────────────────────────────────────────────────────

export interface WarpgateLdapServer {
  id: string;
  name: string;
  host: string;
  port: number;
  bindDn: string;
  userFilter: string;
  baseDns: string[];
  tlsMode?: string;
  tlsVerify?: boolean;
  enabled?: boolean;
  autoLinkSsoUsers?: boolean;
  description?: string;
  usernameAttribute?: string;
  sshKeyAttribute?: string;
  uuidAttribute?: string;
}

export interface CreateLdapServerRequest {
  name: string;
  host: string;
  port?: number;
  bindDn: string;
  bindPassword: string;
  userFilter?: string;
  tlsMode?: string;
  tlsVerify?: boolean;
  enabled?: boolean;
  autoLinkSsoUsers?: boolean;
  description?: string;
  usernameAttribute?: string;
  sshKeyAttribute?: string;
  uuidAttribute?: string;
}

export interface UpdateLdapServerRequest {
  name: string;
  host: string;
  port: number;
  bindDn: string;
  bindPassword?: string;
  userFilter: string;
  tlsMode?: string;
  tlsVerify?: boolean;
  enabled?: boolean;
  autoLinkSsoUsers?: boolean;
  description?: string;
  usernameAttribute?: string;
  sshKeyAttribute?: string;
  uuidAttribute?: string;
}

export interface TestLdapServerRequest {
  host: string;
  port: number;
  bindDn: string;
  bindPassword: string;
  tlsMode?: string;
  tlsVerify?: boolean;
}

export interface TestLdapServerResponse {
  success: boolean;
  message: string;
  baseDns?: string[];
}

export interface LdapUser {
  username: string;
  email?: string;
  displayName?: string;
  dn: string;
}

export interface ImportLdapUsersRequest {
  dns: string[];
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export interface GetLogsRequest {
  before?: string;
  after?: string;
  limit?: number;
  sessionId?: string;
  username?: string;
  search?: string;
}

export interface WarpgateLogEntry {
  id: string;
  timestamp?: string;
  sessionId?: string;
  username?: string;
  text?: string;
  [key: string]: unknown;
}

// ── Parameters (system config) ───────────────────────────────────────────────

export interface WarpgateParameters {
  allowOwnCredentialManagement: boolean;
  rateLimitBytesPerSecond?: number;
  sshClientAuthPublickey?: boolean;
  sshClientAuthPassword?: boolean;
  sshClientAuthKeyboardInteractive?: boolean;
}

export interface UpdateParametersRequest {
  allowOwnCredentialManagement: boolean;
  rateLimitBytesPerSecond?: number;
  sshClientAuthPublickey?: boolean;
  sshClientAuthPassword?: boolean;
  sshClientAuthKeyboardInteractive?: boolean;
}
