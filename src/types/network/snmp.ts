// =============================================================================
// SNMP Types — TypeScript interfaces matching the Rust sorng-snmp crate
// =============================================================================

/** SNMP protocol version. */
export type SnmpVersion = "V1" | "V2c" | "V3";

/** Authentication protocol for SNMPv3. */
export type AuthProtocol =
  | "MD5"
  | "SHA1"
  | "SHA224"
  | "SHA256"
  | "SHA384"
  | "SHA512";

/** Privacy (encryption) protocol for SNMPv3. */
export type PrivProtocol = "DES" | "AES128" | "AES192" | "AES256";

/** USM security level. */
export type SecurityLevel = "NoAuthNoPriv" | "AuthNoPriv" | "AuthPriv";

/** SNMPv3 USM credentials. */
export interface V3Credentials {
  username: string;
  security_level: SecurityLevel;
  auth_protocol?: AuthProtocol;
  auth_password?: string;
  priv_protocol?: PrivProtocol;
  priv_password?: string;
  context_name?: string;
  context_engine_id?: string;
}

/** Connection target for SNMP operations. */
export interface SnmpTarget {
  host: string;
  port: number;
  version: SnmpVersion;
  community: string;
  v3_credentials?: V3Credentials;
  timeout_ms: number;
  retries: number;
}

/** SNMP value type tag. */
export type SnmpValueType =
  | "Integer"
  | "OctetString"
  | "Null"
  | "ObjectIdentifier"
  | "IpAddress"
  | "Counter32"
  | "Gauge32"
  | "TimeTicks"
  | "Opaque"
  | "Counter64"
  | "NoSuchObject"
  | "NoSuchInstance"
  | "EndOfMibView";

/**
 * SNMP value — serialised as a tagged enum.
 * e.g. `{ "Integer": 42 }` or `{ "OctetString": [72,101,108,108,111] }`
 */
export type SnmpValue =
  | { Integer: number }
  | { OctetString: number[] }
  | "Null"
  | { ObjectIdentifier: string }
  | { IpAddress: string }
  | { Counter32: number }
  | { Gauge32: number }
  | { TimeTicks: number }
  | { Opaque: number[] }
  | { Counter64: number }
  | "NoSuchObject"
  | "NoSuchInstance"
  | "EndOfMibView";

/** Variable binding (OID + value). */
export interface VarBind {
  oid: string;
  value: SnmpValue;
}

/** PDU type. */
export type PduType =
  | "GetRequest"
  | "GetNextRequest"
  | "GetResponse"
  | "SetRequest"
  | "GetBulkRequest"
  | "InformRequest"
  | "TrapV1"
  | "TrapV2"
  | "Report";

/** SNMP error status codes. */
export type SnmpErrorStatus =
  | "NoError"
  | "TooBig"
  | "NoSuchName"
  | "BadValue"
  | "ReadOnly"
  | "GenErr"
  | "NoAccess"
  | "WrongType"
  | "WrongLength"
  | "WrongEncoding"
  | "WrongValue"
  | "NoCreation"
  | "InconsistentValue"
  | "ResourceUnavailable"
  | "CommitFailed"
  | "UndoFailed"
  | "AuthorizationError"
  | "NotWritable"
  | "InconsistentName";

/** Response from an SNMP operation. */
export interface SnmpResponse {
  request_id: number;
  error_status: SnmpErrorStatus;
  error_index: number;
  varbinds: VarBind[];
  rtt_ms: number;
}

/** Trap severity levels. */
export type TrapSeverity =
  | "Emergency"
  | "Alert"
  | "Critical"
  | "Error"
  | "Warning"
  | "Notice"
  | "Informational"
  | "Debug"
  | "Unknown";

/** Received SNMP trap. */
export interface SnmpTrap {
  id: string;
  source: string;
  version: SnmpVersion;
  community?: string;
  enterprise?: string;
  generic_trap?: number;
  specific_trap?: number;
  timestamp?: number;
  varbinds: VarBind[];
  severity: TrapSeverity;
  received_at: string;
}

/** Device identified via SNMP. */
export interface SnmpDevice {
  host: string;
  port: number;
  version: SnmpVersion;
  sys_descr?: string;
  sys_object_id?: string;
  sys_uptime?: string;
  sys_contact?: string;
  sys_name?: string;
  sys_location?: string;
  sys_services?: number;
  if_number?: number;
  last_seen?: string;
  reachable: boolean;
}

/** OID-to-name mapping. */
export interface OidMapping {
  oid: string;
  name: string;
  module: string;
  description: string;
}

/** MIB module metadata. */
export interface MibModule {
  name: string;
  description: string;
  objects: string[];
}

/** A single object in the MIB. */
export interface MibObject {
  oid: string;
  name: string;
  syntax: string;
  access: string;
  status: string;
  description: string;
}

/** SNMP table with column and row data. */
export interface SnmpTable {
  table_oid: string;
  columns: string[];
  rows: SnmpTableRow[];
}

/** Row in an SNMP table. */
export interface SnmpTableRow {
  index: string;
  values: Record<string, SnmpValue>;
}

/** Walk result. */
export interface WalkResult {
  root_oid: string;
  entries: VarBind[];
  total_requests: number;
  duration_ms: number;
}

/** Threshold comparison operator. */
export type ThresholdOperator =
  | "GreaterThan"
  | "GreaterThanOrEqual"
  | "LessThan"
  | "LessThanOrEqual"
  | "Equal"
  | "NotEqual";

/** Threshold definition for a monitored OID. */
export interface MonitorThreshold {
  oid: string;
  value: number;
  operator: ThresholdOperator;
  severity: TrapSeverity;
  description: string;
}

/** Monitor target definition. */
export interface MonitorTarget {
  id: string;
  name: string;
  target: SnmpTarget;
  oids: string[];
  interval_secs: number;
  thresholds: MonitorThreshold[];
  enabled: boolean;
}

/** A single poll data point. */
export interface PollDataPoint {
  oid: string;
  value: SnmpValue;
  timestamp: string;
  rtt_ms: number;
}

/** Alert raised when a threshold is exceeded. */
export interface MonitorAlert {
  id: string;
  monitor_id: string;
  oid: string;
  current_value: number;
  threshold_value: number;
  operator: ThresholdOperator;
  severity: TrapSeverity;
  description: string;
  triggered_at: string;
  acknowledged: boolean;
}

/** Discovery configuration. */
export interface DiscoveryConfig {
  subnets: string[];
  communities: string[];
  versions: SnmpVersion[];
  timeout_ms?: number;
  max_concurrent?: number;
  fetch_system_info?: boolean;
}

/** Discovery result for a single host. */
export interface DiscoveryResult {
  host: string;
  port: number;
  reachable: boolean;
  version?: SnmpVersion;
  community?: string;
  device?: SnmpDevice;
  rtt_ms: number;
  error?: string;
}

/** Interface info from IF-MIB. */
export interface InterfaceInfo {
  index: number;
  descr: string;
  if_type: number;
  mtu?: number;
  speed?: number;
  high_speed?: number;
  phys_address?: string;
  admin_status: InterfaceStatus;
  oper_status: InterfaceStatus;
  last_change?: number;
  in_octets?: number;
  out_octets?: number;
  in_ucast_pkts?: number;
  out_ucast_pkts?: number;
  in_errors?: number;
  out_errors?: number;
  in_discards?: number;
  out_discards?: number;
  alias?: string;
}

/** Interface status. */
export type InterfaceStatus = "Up" | "Down" | "Testing" | "Unknown";

/** Calculated bandwidth for an interface. */
export interface InterfaceBandwidth {
  if_index: number;
  if_descr: string;
  in_bps: number;
  out_bps: number;
  in_utilization: number;
  out_utilization: number;
  speed_bps: number;
  timestamp: string;
}

/** Trap receiver configuration. */
export interface TrapReceiverConfig {
  port: number;
  bind_address: string;
  buffer_size: number;
  allowed_sources: string[];
  community_filter: string[];
}

/** Trap receiver run-time status. */
export interface TrapReceiverStatus {
  running: boolean;
  port: number;
  bind_address: string;
  total_received: number;
  buffer_used: number;
  buffer_capacity: number;
  started_at?: string;
}

/** USM user record. */
export interface UsmUser {
  username: string;
  security_level: SecurityLevel;
  auth_protocol?: AuthProtocol;
  auth_password?: string;
  priv_protocol?: PrivProtocol;
  priv_password?: string;
}

/** Engine discovery information (SNMPv3). */
export interface EngineInfo {
  engine_id: number[];
  engine_boots: number;
  engine_time: number;
}

/** Bulk operation configuration. */
export interface BulkOperationConfig {
  targets: SnmpTarget[];
  max_concurrent: number;
  stop_on_error: boolean;
}

/** Bulk operation result. */
export interface BulkOperationResult {
  results: BulkTargetResult[];
  total_duration_ms: number;
  success_count: number;
  failure_count: number;
}

/** Per-target result in a bulk operation. */
export interface BulkTargetResult {
  host: string;
  port: number;
  success: boolean;
  response?: SnmpResponse;
  walk_result?: WalkResult;
  error?: string;
  rtt_ms: number;
}

/** SNMP service overall status. */
export interface SnmpServiceStatus {
  trap_receiver_running: boolean;
  trap_count: number;
  device_count: number;
  target_count: number;
  usm_user_count: number;
  mib_mapping_count: number;
  monitor_count: number;
}
