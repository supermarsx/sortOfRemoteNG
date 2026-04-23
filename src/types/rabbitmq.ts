// RabbitMQ types — align with sorng-rabbitmq crate DTOs.

export interface RabbitConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  vhost?: string;
  useTls?: boolean;
  verifyTls?: boolean;
}

export interface RabbitSession {
  id: string;
  host: string;
  port: number;
  vhost: string;
  username: string;
  connectedAt: string;
}

export interface VhostInfo {
  name: string;
  tracing?: boolean;
  description?: string;
  messages?: number;
  messagesReady?: number;
  messagesUnacknowledged?: number;
}

export interface ExchangeInfo {
  name: string;
  vhost: string;
  exchangeType: string;
  durable: boolean;
  autoDelete: boolean;
  internal: boolean;
  arguments?: Record<string, unknown>;
}

export interface QueueInfo {
  name: string;
  vhost: string;
  durable: boolean;
  autoDelete: boolean;
  exclusive: boolean;
  messages: number;
  messagesReady: number;
  messagesUnacknowledged: number;
  consumers: number;
  state?: string;
  node?: string;
  arguments?: Record<string, unknown>;
}

export interface BindingInfo {
  source: string;
  destination: string;
  destinationType: string;
  routingKey: string;
  vhost: string;
  propertiesKey?: string;
  arguments?: Record<string, unknown>;
}

export interface UserInfo {
  name: string;
  tags: string[];
  passwordHash?: string;
  hashingAlgorithm?: string;
}

export interface PermissionInfo {
  user: string;
  vhost: string;
  configure: string;
  write: string;
  read: string;
}

export interface PolicyInfo {
  name: string;
  vhost: string;
  pattern: string;
  applyTo: string;
  priority: number;
  definition: Record<string, unknown>;
}

export interface ShovelInfo {
  name: string;
  vhost: string;
  state: string;
  type: string;
  sourceUri?: string;
  destinationUri?: string;
}

export interface ShovelDefinition {
  name: string;
  vhost: string;
  sourceUri: string;
  sourceQueue?: string;
  sourceExchange?: string;
  destinationUri: string;
  destinationQueue?: string;
  destinationExchange?: string;
  ackMode?: string;
  deleteAfter?: string | number;
}

export interface FederationUpstream {
  name: string;
  vhost: string;
  uri: string;
  expires?: number;
  messageTtl?: number;
  maxHops?: number;
  prefetchCount?: number;
}

export type FederationUpstreamDef = FederationUpstream;

export interface FederationLink {
  upstream: string;
  vhost: string;
  status: string;
  type: string;
  queue?: string;
  exchange?: string;
  uri?: string;
}

export interface ClusterNode {
  name: string;
  type: string;
  running: boolean;
  uptime?: number;
  memUsed?: number;
  memLimit?: number;
  diskFree?: number;
  diskFreeLimit?: number;
}

export interface ConnectionInfo {
  name: string;
  vhost: string;
  user: string;
  state: string;
  protocol?: string;
  node?: string;
  channels?: number;
  peerHost?: string;
  peerPort?: number;
  connectedAt?: string;
}

export interface ChannelInfo {
  name: string;
  connectionName: string;
  number: number;
  state: string;
  user: string;
  vhost: string;
  consumerCount: number;
  messagesUnacknowledged: number;
  messagesUnconfirmed: number;
}

export interface ConsumerInfo {
  consumerTag: string;
  queue: string;
  channel: string;
  connectionName: string;
  vhost: string;
  ackRequired: boolean;
  prefetchCount?: number;
}

export interface OverviewInfo {
  rabbitmqVersion?: string;
  erlangVersion?: string;
  clusterName?: string;
  messageStats?: Record<string, number>;
  queueTotals?: Record<string, number>;
  objectTotals?: Record<string, number>;
}

export interface DefinitionsExport {
  rabbitVersion?: string;
  vhosts?: VhostInfo[];
  users?: UserInfo[];
  permissions?: PermissionInfo[];
  policies?: PolicyInfo[];
  exchanges?: ExchangeInfo[];
  queues?: QueueInfo[];
  bindings?: BindingInfo[];
  raw?: Record<string, unknown>;
}
