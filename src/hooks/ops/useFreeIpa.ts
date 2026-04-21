/**
 * React hook wrapping the 47 `freeipa_*` Tauri commands exposed by the
 * `sorng-freeipa` backend crate (see t3-e54 wiring).
 */

import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type {
  FreeIpaCertificate,
  FreeIpaConnectionConfig,
  FreeIpaConnectionSummary,
  FreeIpaDashboard,
  FreeIpaDnsRecord,
  FreeIpaDnsZone,
  FreeIpaGroup,
  FreeIpaHbacRule,
  FreeIpaHost,
  FreeIpaRole,
  FreeIpaService,
  FreeIpaSudoRule,
  FreeIpaTrust,
  FreeIpaUser,
} from "../../types/freeipa";

export const freeipaApi = {
  // Connection (3)
  connect: (id: string, config: FreeIpaConnectionConfig): Promise<FreeIpaConnectionSummary> =>
    invoke("freeipa_connect", { id, config }),
  disconnect: (id: string): Promise<void> => invoke("freeipa_disconnect", { id }),
  listConnections: (): Promise<string[]> => invoke("freeipa_list_connections"),

  // Dashboard (1)
  getDashboard: (id: string): Promise<FreeIpaDashboard> =>
    invoke("freeipa_get_dashboard", { id }),

  // Users (7)
  listUsers: (id: string): Promise<FreeIpaUser[]> =>
    invoke("freeipa_list_users", { id }),
  getUser: (id: string, uid: string): Promise<FreeIpaUser> =>
    invoke("freeipa_get_user", { id, uid }),
  createUser: (id: string, user: unknown): Promise<FreeIpaUser> =>
    invoke("freeipa_create_user", { id, user }),
  updateUser: (id: string, uid: string, patch: unknown): Promise<FreeIpaUser> =>
    invoke("freeipa_update_user", { id, uid, patch }),
  deleteUser: (id: string, uid: string): Promise<void> =>
    invoke("freeipa_delete_user", { id, uid }),
  enableUser: (id: string, uid: string): Promise<void> =>
    invoke("freeipa_enable_user", { id, uid }),
  disableUser: (id: string, uid: string): Promise<void> =>
    invoke("freeipa_disable_user", { id, uid }),

  // Groups (6)
  listGroups: (id: string): Promise<FreeIpaGroup[]> =>
    invoke("freeipa_list_groups", { id }),
  getGroup: (id: string, cn: string): Promise<FreeIpaGroup> =>
    invoke("freeipa_get_group", { id, cn }),
  createGroup: (id: string, group: unknown): Promise<FreeIpaGroup> =>
    invoke("freeipa_create_group", { id, group }),
  deleteGroup: (id: string, cn: string): Promise<void> =>
    invoke("freeipa_delete_group", { id, cn }),
  addGroupMember: (id: string, cn: string, uid: string): Promise<void> =>
    invoke("freeipa_add_group_member", { id, cn, uid }),
  removeGroupMember: (id: string, cn: string, uid: string): Promise<void> =>
    invoke("freeipa_remove_group_member", { id, cn, uid }),

  // Hosts (4)
  listHosts: (id: string): Promise<FreeIpaHost[]> =>
    invoke("freeipa_list_hosts", { id }),
  getHost: (id: string, fqdn: string): Promise<FreeIpaHost> =>
    invoke("freeipa_get_host", { id, fqdn }),
  createHost: (id: string, host: unknown): Promise<FreeIpaHost> =>
    invoke("freeipa_create_host", { id, host }),
  deleteHost: (id: string, fqdn: string): Promise<void> =>
    invoke("freeipa_delete_host", { id, fqdn }),

  // Services (4)
  listServices: (id: string): Promise<FreeIpaService[]> =>
    invoke("freeipa_list_services", { id }),
  getService: (id: string, principal: string): Promise<FreeIpaService> =>
    invoke("freeipa_get_service", { id, principal }),
  createService: (id: string, svc: unknown): Promise<FreeIpaService> =>
    invoke("freeipa_create_service", { id, svc }),
  deleteService: (id: string, principal: string): Promise<void> =>
    invoke("freeipa_delete_service", { id, principal }),

  // DNS (7)
  listDnsZones: (id: string): Promise<FreeIpaDnsZone[]> =>
    invoke("freeipa_list_dns_zones", { id }),
  getDnsZone: (id: string, zone: string): Promise<FreeIpaDnsZone> =>
    invoke("freeipa_get_dns_zone", { id, zone }),
  createDnsZone: (id: string, zone: unknown): Promise<FreeIpaDnsZone> =>
    invoke("freeipa_create_dns_zone", { id, zone }),
  deleteDnsZone: (id: string, zone: string): Promise<void> =>
    invoke("freeipa_delete_dns_zone", { id, zone }),
  listDnsRecords: (id: string, zone: string): Promise<FreeIpaDnsRecord[]> =>
    invoke("freeipa_list_dns_records", { id, zone }),
  addDnsRecord: (id: string, zone: string, record: unknown): Promise<void> =>
    invoke("freeipa_add_dns_record", { id, zone, record }),
  deleteDnsRecord: (id: string, zone: string, name: string, recordType: string): Promise<void> =>
    invoke("freeipa_delete_dns_record", { id, zone, name, recordType }),

  // RBAC (3)
  listRoles: (id: string): Promise<FreeIpaRole[]> =>
    invoke("freeipa_list_roles", { id }),
  listPrivileges: (id: string): Promise<unknown[]> =>
    invoke("freeipa_list_privileges", { id }),
  listPermissions: (id: string): Promise<unknown[]> =>
    invoke("freeipa_list_permissions", { id }),

  // Certificates (3)
  listCertificates: (id: string): Promise<FreeIpaCertificate[]> =>
    invoke("freeipa_list_certificates", { id }),
  requestCertificate: (id: string, req: unknown): Promise<FreeIpaCertificate> =>
    invoke("freeipa_request_certificate", { id, req }),
  revokeCertificate: (id: string, serial: string, reason?: number): Promise<void> =>
    invoke("freeipa_revoke_certificate", { id, serial, reason }),

  // Sudo (3)
  listSudoRules: (id: string): Promise<FreeIpaSudoRule[]> =>
    invoke("freeipa_list_sudo_rules", { id }),
  createSudoRule: (id: string, rule: unknown): Promise<FreeIpaSudoRule> =>
    invoke("freeipa_create_sudo_rule", { id, rule }),
  deleteSudoRule: (id: string, name: string): Promise<void> =>
    invoke("freeipa_delete_sudo_rule", { id, name }),

  // HBAC (3)
  listHbacRules: (id: string): Promise<FreeIpaHbacRule[]> =>
    invoke("freeipa_list_hbac_rules", { id }),
  createHbacRule: (id: string, rule: unknown): Promise<FreeIpaHbacRule> =>
    invoke("freeipa_create_hbac_rule", { id, rule }),
  deleteHbacRule: (id: string, name: string): Promise<void> =>
    invoke("freeipa_delete_hbac_rule", { id, name }),

  // Trusts (3)
  listTrusts: (id: string): Promise<FreeIpaTrust[]> =>
    invoke("freeipa_list_trusts", { id }),
  createTrust: (id: string, trust: unknown): Promise<FreeIpaTrust> =>
    invoke("freeipa_create_trust", { id, trust }),
  deleteTrust: (id: string, realm: string): Promise<void> =>
    invoke("freeipa_delete_trust", { id, realm }),
};

export function useFreeIpa() {
  return useMemo(() => ({ api: freeipaApi }), []);
}
