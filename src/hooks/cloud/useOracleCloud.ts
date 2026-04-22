// useOracleCloud — typed Tauri `invoke(...)` wrappers for the
// sorng-oracle-cloud backend. Pairs 1:1 with the 67 `oci_*` commands in
// `src-tauri/crates/sorng-oracle-cloud/src/commands.rs`.
//
// Tauri maps JS camelCase arg keys to Rust snake_case arg names, so we
// send `connectionId`, `compartmentId`, `vcnId`, etc.

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  LaunchInstanceRequest,
  OciAlarm,
  OciAuditEvent,
  OciAutonomousDb,
  OciBlockVolume,
  OciBucket,
  OciCompartment,
  OciConnectionConfig,
  OciConnectionSummary,
  OciContainerInstance,
  OciDashboard,
  OciDbSystem,
  OciFunction,
  OciFunctionApplication,
  OciGroup,
  OciImage,
  OciInstance,
  OciInternetGateway,
  OciLoadBalancer,
  OciMetricData,
  OciNatGateway,
  OciObject,
  OciPolicy,
  OciRouteTable,
  OciSecurityList,
  OciShape,
  OciSubnet,
  OciUser,
  OciVcn,
  OkeCluster,
  OkeNodePool,
} from '../../types/oracleCloud';

// ─── Low-level invoke wrappers ─────────────────────────────────────────

export const oracleCloudApi = {
  // ── Connection management ───────────────────────────────────────────
  connect: (connectionId: string, config: OciConnectionConfig) =>
    invoke<OciConnectionSummary>('oci_connect', { connectionId, config }),
  disconnect: (connectionId: string) =>
    invoke<void>('oci_disconnect', { connectionId }),
  listConnections: () =>
    invoke<OciConnectionSummary[]>('oci_list_connections'),
  ping: (connectionId: string) => invoke<void>('oci_ping', { connectionId }),
  getDashboard: (connectionId: string) =>
    invoke<OciDashboard>('oci_get_dashboard', { connectionId }),

  // ── Compute ─────────────────────────────────────────────────────────
  listInstances: (connectionId: string, compartmentId: string) =>
    invoke<OciInstance[]>('oci_list_instances', { connectionId, compartmentId }),
  getInstance: (connectionId: string, instanceId: string) =>
    invoke<OciInstance>('oci_get_instance', { connectionId, instanceId }),
  launchInstance: (connectionId: string, request: LaunchInstanceRequest) =>
    invoke<OciInstance>('oci_launch_instance', { connectionId, request }),
  terminateInstance: (connectionId: string, instanceId: string) =>
    invoke<void>('oci_terminate_instance', { connectionId, instanceId }),
  startInstance: (connectionId: string, instanceId: string) =>
    invoke<OciInstance>('oci_start_instance', { connectionId, instanceId }),
  stopInstance: (connectionId: string, instanceId: string) =>
    invoke<OciInstance>('oci_stop_instance', { connectionId, instanceId }),
  rebootInstance: (connectionId: string, instanceId: string) =>
    invoke<OciInstance>('oci_reboot_instance', { connectionId, instanceId }),
  listShapes: (connectionId: string, compartmentId: string) =>
    invoke<OciShape[]>('oci_list_shapes', { connectionId, compartmentId }),
  listImages: (connectionId: string, compartmentId: string) =>
    invoke<OciImage[]>('oci_list_images', { connectionId, compartmentId }),
  getImage: (connectionId: string, imageId: string) =>
    invoke<OciImage>('oci_get_image', { connectionId, imageId }),

  // ── Networking ──────────────────────────────────────────────────────
  listVcns: (connectionId: string, compartmentId: string) =>
    invoke<OciVcn[]>('oci_list_vcns', { connectionId, compartmentId }),
  getVcn: (connectionId: string, vcnId: string) =>
    invoke<OciVcn>('oci_get_vcn', { connectionId, vcnId }),
  createVcn: (
    connectionId: string,
    compartmentId: string,
    displayName: string,
    cidrBlock: string,
  ) =>
    invoke<OciVcn>('oci_create_vcn', {
      connectionId,
      compartmentId,
      displayName,
      cidrBlock,
    }),
  deleteVcn: (connectionId: string, vcnId: string) =>
    invoke<void>('oci_delete_vcn', { connectionId, vcnId }),
  listSubnets: (
    connectionId: string,
    compartmentId: string,
    vcnId?: string | null,
  ) =>
    invoke<OciSubnet[]>('oci_list_subnets', {
      connectionId,
      compartmentId,
      vcnId: vcnId ?? null,
    }),
  getSubnet: (connectionId: string, subnetId: string) =>
    invoke<OciSubnet>('oci_get_subnet', { connectionId, subnetId }),
  createSubnet: (connectionId: string, body: unknown) =>
    invoke<OciSubnet>('oci_create_subnet', { connectionId, body }),
  deleteSubnet: (connectionId: string, subnetId: string) =>
    invoke<void>('oci_delete_subnet', { connectionId, subnetId }),
  listSecurityLists: (
    connectionId: string,
    compartmentId: string,
    vcnId?: string | null,
  ) =>
    invoke<OciSecurityList[]>('oci_list_security_lists', {
      connectionId,
      compartmentId,
      vcnId: vcnId ?? null,
    }),
  getSecurityList: (connectionId: string, securityListId: string) =>
    invoke<OciSecurityList>('oci_get_security_list', {
      connectionId,
      securityListId,
    }),
  listRouteTables: (
    connectionId: string,
    compartmentId: string,
    vcnId?: string | null,
  ) =>
    invoke<OciRouteTable[]>('oci_list_route_tables', {
      connectionId,
      compartmentId,
      vcnId: vcnId ?? null,
    }),
  listInternetGateways: (
    connectionId: string,
    compartmentId: string,
    vcnId?: string | null,
  ) =>
    invoke<OciInternetGateway[]>('oci_list_internet_gateways', {
      connectionId,
      compartmentId,
      vcnId: vcnId ?? null,
    }),
  listNatGateways: (
    connectionId: string,
    compartmentId: string,
    vcnId?: string | null,
  ) =>
    invoke<OciNatGateway[]>('oci_list_nat_gateways', {
      connectionId,
      compartmentId,
      vcnId: vcnId ?? null,
    }),
  listLoadBalancers: (connectionId: string, compartmentId: string) =>
    invoke<OciLoadBalancer[]>('oci_list_load_balancers', {
      connectionId,
      compartmentId,
    }),
  getLoadBalancer: (connectionId: string, lbId: string) =>
    invoke<OciLoadBalancer>('oci_get_load_balancer', { connectionId, lbId }),

  // ── Storage ─────────────────────────────────────────────────────────
  listBlockVolumes: (connectionId: string, compartmentId: string) =>
    invoke<OciBlockVolume[]>('oci_list_block_volumes', {
      connectionId,
      compartmentId,
    }),
  getBlockVolume: (connectionId: string, volumeId: string) =>
    invoke<OciBlockVolume>('oci_get_block_volume', { connectionId, volumeId }),
  createBlockVolume: (
    connectionId: string,
    compartmentId: string,
    availabilityDomain: string,
    displayName: string,
    sizeInGbs: number,
  ) =>
    invoke<OciBlockVolume>('oci_create_block_volume', {
      connectionId,
      compartmentId,
      availabilityDomain,
      displayName,
      sizeInGbs,
    }),
  deleteBlockVolume: (connectionId: string, volumeId: string) =>
    invoke<void>('oci_delete_block_volume', { connectionId, volumeId }),
  listBuckets: (
    connectionId: string,
    namespace: string,
    compartmentId: string,
  ) =>
    invoke<OciBucket[]>('oci_list_buckets', {
      connectionId,
      namespace,
      compartmentId,
    }),
  getBucket: (connectionId: string, namespace: string, bucketName: string) =>
    invoke<OciBucket>('oci_get_bucket', {
      connectionId,
      namespace,
      bucketName,
    }),
  createBucket: (
    connectionId: string,
    namespace: string,
    compartmentId: string,
    bucketName: string,
  ) =>
    invoke<OciBucket>('oci_create_bucket', {
      connectionId,
      namespace,
      compartmentId,
      bucketName,
    }),
  deleteBucket: (connectionId: string, namespace: string, bucketName: string) =>
    invoke<void>('oci_delete_bucket', { connectionId, namespace, bucketName }),
  listObjects: (
    connectionId: string,
    namespace: string,
    bucketName: string,
    prefix?: string | null,
  ) =>
    invoke<OciObject[]>('oci_list_objects', {
      connectionId,
      namespace,
      bucketName,
      prefix: prefix ?? null,
    }),

  // ── Identity / IAM ──────────────────────────────────────────────────
  listCompartments: (connectionId: string, compartmentId: string) =>
    invoke<OciCompartment[]>('oci_list_compartments', {
      connectionId,
      compartmentId,
    }),
  getCompartment: (connectionId: string, compartmentId: string) =>
    invoke<OciCompartment>('oci_get_compartment', {
      connectionId,
      compartmentId,
    }),
  createCompartment: (
    connectionId: string,
    parentCompartmentId: string,
    name: string,
    description: string,
  ) =>
    invoke<OciCompartment>('oci_create_compartment', {
      connectionId,
      parentCompartmentId,
      name,
      description,
    }),
  listUsers: (connectionId: string, compartmentId: string) =>
    invoke<OciUser[]>('oci_list_users', { connectionId, compartmentId }),
  getUser: (connectionId: string, userId: string) =>
    invoke<OciUser>('oci_get_user', { connectionId, userId }),
  createUser: (
    connectionId: string,
    compartmentId: string,
    name: string,
    description: string,
    email?: string | null,
  ) =>
    invoke<OciUser>('oci_create_user', {
      connectionId,
      compartmentId,
      name,
      description,
      email: email ?? null,
    }),
  deleteUser: (connectionId: string, userId: string) =>
    invoke<void>('oci_delete_user', { connectionId, userId }),
  listGroups: (connectionId: string, compartmentId: string) =>
    invoke<OciGroup[]>('oci_list_groups', { connectionId, compartmentId }),
  listPolicies: (connectionId: string, compartmentId: string) =>
    invoke<OciPolicy[]>('oci_list_policies', { connectionId, compartmentId }),

  // ── Database ────────────────────────────────────────────────────────
  listDbSystems: (connectionId: string, compartmentId: string) =>
    invoke<OciDbSystem[]>('oci_list_db_systems', {
      connectionId,
      compartmentId,
    }),
  getDbSystem: (connectionId: string, dbSystemId: string) =>
    invoke<OciDbSystem>('oci_get_db_system', { connectionId, dbSystemId }),
  listAutonomousDbs: (connectionId: string, compartmentId: string) =>
    invoke<OciAutonomousDb[]>('oci_list_autonomous_dbs', {
      connectionId,
      compartmentId,
    }),
  getAutonomousDb: (connectionId: string, autonomousDbId: string) =>
    invoke<OciAutonomousDb>('oci_get_autonomous_db', {
      connectionId,
      autonomousDbId,
    }),
  createAutonomousDb: (connectionId: string, body: unknown) =>
    invoke<OciAutonomousDb>('oci_create_autonomous_db', { connectionId, body }),
  startAutonomousDb: (connectionId: string, autonomousDbId: string) =>
    invoke<OciAutonomousDb>('oci_start_autonomous_db', {
      connectionId,
      autonomousDbId,
    }),
  stopAutonomousDb: (connectionId: string, autonomousDbId: string) =>
    invoke<OciAutonomousDb>('oci_stop_autonomous_db', {
      connectionId,
      autonomousDbId,
    }),

  // ── Containers / OKE ────────────────────────────────────────────────
  listContainerInstances: (connectionId: string, compartmentId: string) =>
    invoke<OciContainerInstance[]>('oci_list_container_instances', {
      connectionId,
      compartmentId,
    }),
  listOkeClusters: (connectionId: string, compartmentId: string) =>
    invoke<OkeCluster[]>('oci_list_oke_clusters', {
      connectionId,
      compartmentId,
    }),
  getOkeCluster: (connectionId: string, clusterId: string) =>
    invoke<OkeCluster>('oci_get_oke_cluster', { connectionId, clusterId }),
  listNodePools: (
    connectionId: string,
    compartmentId: string,
    clusterId?: string | null,
  ) =>
    invoke<OkeNodePool[]>('oci_list_node_pools', {
      connectionId,
      compartmentId,
      clusterId: clusterId ?? null,
    }),

  // ── Functions ───────────────────────────────────────────────────────
  listApplications: (connectionId: string, compartmentId: string) =>
    invoke<OciFunctionApplication[]>('oci_list_applications', {
      connectionId,
      compartmentId,
    }),
  listFunctions: (connectionId: string, applicationId: string) =>
    invoke<OciFunction[]>('oci_list_functions', {
      connectionId,
      applicationId,
    }),
  getFunction: (connectionId: string, functionId: string) =>
    invoke<OciFunction>('oci_get_function', { connectionId, functionId }),
  invokeFunction: (
    connectionId: string,
    functionId: string,
    payload: unknown,
  ) =>
    invoke<unknown>('oci_invoke_function', {
      connectionId,
      functionId,
      payload,
    }),

  // ── Monitoring ──────────────────────────────────────────────────────
  listAlarms: (connectionId: string, compartmentId: string) =>
    invoke<OciAlarm[]>('oci_list_alarms', { connectionId, compartmentId }),
  getAlarm: (connectionId: string, alarmId: string) =>
    invoke<OciAlarm>('oci_get_alarm', { connectionId, alarmId }),
  queryMetrics: (
    connectionId: string,
    compartmentId: string,
    query: string,
    namespace: string,
  ) =>
    invoke<OciMetricData[]>('oci_query_metrics', {
      connectionId,
      compartmentId,
      query,
      namespace,
    }),
  listAuditEvents: (
    connectionId: string,
    compartmentId: string,
    startTime: string,
    endTime: string,
  ) =>
    invoke<OciAuditEvent[]>('oci_list_audit_events', {
      connectionId,
      compartmentId,
      startTime,
      endTime,
    }),
} as const;

// ─── State hook ────────────────────────────────────────────────────────

interface OciState {
  connections: OciConnectionSummary[];
  activeId: string | null;
  lastError: string | null;
  loading: boolean;
}

export function useOracleCloud() {
  const [state, setState] = useState<OciState>({
    connections: [],
    activeId: null,
    lastError: null,
    loading: false,
  });

  const refreshConnections = useCallback(async () => {
    try {
      const connections = await oracleCloudApi.listConnections();
      setState((s) => ({ ...s, connections, lastError: null }));
      return connections;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, lastError: msg }));
      throw e;
    }
  }, []);

  const connect = useCallback(
    async (connectionId: string, config: OciConnectionConfig) => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const summary = await oracleCloudApi.connect(connectionId, config);
        const connections = await oracleCloudApi.listConnections();
        setState((s) => ({
          ...s,
          connections,
          activeId: connectionId,
          lastError: null,
          loading: false,
        }));
        return summary;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, lastError: msg, loading: false }));
        throw e;
      }
    },
    [],
  );

  const disconnect = useCallback(async (connectionId: string) => {
    await oracleCloudApi.disconnect(connectionId);
    const connections = await oracleCloudApi.listConnections();
    setState((s) => ({
      ...s,
      connections,
      activeId: s.activeId === connectionId ? null : s.activeId,
    }));
  }, []);

  return {
    ...state,
    api: oracleCloudApi,
    refreshConnections,
    connect,
    disconnect,
    setActiveId: (id: string | null) =>
      setState((s) => ({ ...s, activeId: id })),
  };
}

export default useOracleCloud;
