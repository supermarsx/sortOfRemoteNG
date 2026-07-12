// useNetboxTenancy — Tenancy & Contacts slice for the NetBox integration
// (t42-netbox-c4).
//
// Pairs 1:1 with the 24 Tenancy/Contacts commands in
// `src-tauri/crates/sorng-netbox/src/commands.rs`:
//   Tenants (+ groups): 11   Contacts (+ groups/roles/assignments): 13
// Argument names are camelCase — Tauri maps them to the snake_case Rust
// `#[tauri::command]` parameters (e.g. `tenantId` -> `tenant_id`), matching the
// established convention in `useNetboxConnection.ts` / `useVmware.ts`.
//
// Category-exec owned: consumes the live `connectionId` from `NetboxTabProps`
// (never re-implements connect). Import shared list/ref types from the shell
// barrel; domain types from the sibling `tenancy` type module.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PaginatedResponse } from "../../../types/netbox";
import type {
  Contact,
  ContactAssignment,
  ContactGroup,
  ContactRole,
  Tenant,
  TenantGroup,
} from "../../../types/netbox/tenancy";

/** A NetBox list query — flattened to `[key, value]` pairs (the Rust
 *  `params: Vec<(String, String)>` shape). */
export type NetboxListParams = Array<[string, string]>;

// ─── Low-level invoke wrappers (all 24 Tenancy/Contacts commands) ─────────────

export const netboxTenancyApi = {
  // Tenants (6)
  listTenants: (id: string, params: NetboxListParams = []) =>
    invoke<PaginatedResponse<Tenant>>("netbox_list_tenants", { id, params }),
  getTenant: (id: string, tenantId: number) =>
    invoke<Tenant>("netbox_get_tenant", { id, tenantId }),
  createTenant: (id: string, data: Partial<Tenant>) =>
    invoke<Tenant>("netbox_create_tenant", { id, data }),
  updateTenant: (id: string, tenantId: number, data: Partial<Tenant>) =>
    invoke<Tenant>("netbox_update_tenant", { id, tenantId, data }),
  partialUpdateTenant: (
    id: string,
    tenantId: number,
    data: Partial<Tenant>,
  ) =>
    invoke<Tenant>("netbox_partial_update_tenant", { id, tenantId, data }),
  deleteTenant: (id: string, tenantId: number) =>
    invoke<void>("netbox_delete_tenant", { id, tenantId }),

  // Tenant groups (5)
  listTenantGroups: (id: string) =>
    invoke<PaginatedResponse<TenantGroup>>("netbox_list_tenant_groups", {
      id,
    }),
  getTenantGroup: (id: string, groupId: number) =>
    invoke<TenantGroup>("netbox_get_tenant_group", { id, groupId }),
  createTenantGroup: (id: string, data: Partial<TenantGroup>) =>
    invoke<TenantGroup>("netbox_create_tenant_group", { id, data }),
  updateTenantGroup: (
    id: string,
    groupId: number,
    data: Partial<TenantGroup>,
  ) =>
    invoke<TenantGroup>("netbox_update_tenant_group", { id, groupId, data }),
  deleteTenantGroup: (id: string, groupId: number) =>
    invoke<void>("netbox_delete_tenant_group", { id, groupId }),

  // Contacts (6)
  listContacts: (id: string, params: NetboxListParams = []) =>
    invoke<PaginatedResponse<Contact>>("netbox_list_contacts", { id, params }),
  getContact: (id: string, contactId: number) =>
    invoke<Contact>("netbox_get_contact", { id, contactId }),
  createContact: (id: string, data: Partial<Contact>) =>
    invoke<Contact>("netbox_create_contact", { id, data }),
  updateContact: (id: string, contactId: number, data: Partial<Contact>) =>
    invoke<Contact>("netbox_update_contact", { id, contactId, data }),
  partialUpdateContact: (
    id: string,
    contactId: number,
    data: Partial<Contact>,
  ) =>
    invoke<Contact>("netbox_partial_update_contact", { id, contactId, data }),
  deleteContact: (id: string, contactId: number) =>
    invoke<void>("netbox_delete_contact", { id, contactId }),

  // Contact groups (5)
  listContactGroups: (id: string) =>
    invoke<PaginatedResponse<ContactGroup>>("netbox_list_contact_groups", {
      id,
    }),
  getContactGroup: (id: string, groupId: number) =>
    invoke<ContactGroup>("netbox_get_contact_group", { id, groupId }),
  createContactGroup: (id: string, data: Partial<ContactGroup>) =>
    invoke<ContactGroup>("netbox_create_contact_group", { id, data }),
  updateContactGroup: (
    id: string,
    groupId: number,
    data: Partial<ContactGroup>,
  ) =>
    invoke<ContactGroup>("netbox_update_contact_group", { id, groupId, data }),
  deleteContactGroup: (id: string, groupId: number) =>
    invoke<void>("netbox_delete_contact_group", { id, groupId }),

  // Contact roles + assignments (2)
  listContactRoles: (id: string) =>
    invoke<PaginatedResponse<ContactRole>>("netbox_list_contact_roles", {
      id,
    }),
  listContactAssignments: (id: string) =>
    invoke<PaginatedResponse<ContactAssignment>>(
      "netbox_list_contact_assignments",
      { id },
    ),
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** The tenancy sub-domain a list view can show. */
export type NetboxTenancyView =
  | "tenants"
  | "tenantGroups"
  | "contacts"
  | "contactGroups"
  | "contactRoles"
  | "contactAssignments";

export interface UseNetboxTenancy {
  tenants: Tenant[];
  tenantGroups: TenantGroup[];
  contacts: Contact[];
  contactGroups: ContactGroup[];
  contactRoles: ContactRole[];
  contactAssignments: ContactAssignment[];
  loading: boolean;
  error: string | null;
  /** (Re)load the list backing a single view. */
  load: (view: NetboxTenancyView) => Promise<void>;
  /** Delete a record in `view` by id, then refresh that view. */
  remove: (view: NetboxTenancyView, recordId: number) => Promise<void>;
  clearError: () => void;
  api: typeof netboxTenancyApi;
}

const toMessage = (e: unknown): string =>
  typeof e === "string" ? e : ((e as Error)?.message ?? String(e));

/**
 * Read/refresh state for the Tenancy & Contacts tab. Each `load(view)` fetches
 * the paginated list for that view via `netboxTenancyApi`; `remove` deletes and
 * reloads. Mutations (create/update) are available directly on the returned
 * `api` so forms can call them and then `load` the affected view.
 */
export function useNetboxTenancy(connectionId: string): UseNetboxTenancy {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantGroups, setTenantGroups] = useState<TenantGroup[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactGroups, setContactGroups] = useState<ContactGroup[]>([]);
  const [contactRoles, setContactRoles] = useState<ContactRole[]>([]);
  const [contactAssignments, setContactAssignments] = useState<
    ContactAssignment[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (view: NetboxTenancyView): Promise<void> => {
      if (!connectionId) return;
      setLoading(true);
      setError(null);
      try {
        switch (view) {
          case "tenants":
            setTenants((await netboxTenancyApi.listTenants(connectionId)).results);
            break;
          case "tenantGroups":
            setTenantGroups(
              (await netboxTenancyApi.listTenantGroups(connectionId)).results,
            );
            break;
          case "contacts":
            setContacts(
              (await netboxTenancyApi.listContacts(connectionId)).results,
            );
            break;
          case "contactGroups":
            setContactGroups(
              (await netboxTenancyApi.listContactGroups(connectionId)).results,
            );
            break;
          case "contactRoles":
            setContactRoles(
              (await netboxTenancyApi.listContactRoles(connectionId)).results,
            );
            break;
          case "contactAssignments":
            setContactAssignments(
              (await netboxTenancyApi.listContactAssignments(connectionId))
                .results,
            );
            break;
        }
      } catch (e) {
        setError(toMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [connectionId],
  );

  const remove = useCallback(
    async (view: NetboxTenancyView, recordId: number): Promise<void> => {
      if (!connectionId) return;
      setError(null);
      try {
        switch (view) {
          case "tenants":
            await netboxTenancyApi.deleteTenant(connectionId, recordId);
            break;
          case "tenantGroups":
            await netboxTenancyApi.deleteTenantGroup(connectionId, recordId);
            break;
          case "contacts":
            await netboxTenancyApi.deleteContact(connectionId, recordId);
            break;
          case "contactGroups":
            await netboxTenancyApi.deleteContactGroup(connectionId, recordId);
            break;
          case "contactRoles":
          case "contactAssignments":
            // Read-only views (no delete command); nothing to do.
            return;
        }
        await load(view);
      } catch (e) {
        setError(toMessage(e));
      }
    },
    [connectionId, load],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    tenants,
    tenantGroups,
    contacts,
    contactGroups,
    contactRoles,
    contactAssignments,
    loading,
    error,
    load,
    remove,
    clearError,
    api: netboxTenancyApi,
  };
}
