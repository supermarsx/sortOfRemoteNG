// osTicket Administration invoke slice + hook (t42-osticket-c2).
//
// `osticketAdminApi` is a thin 1:1 wrapper over the 44 admin-panel `osticket_*`
// commands (Departments 6, Help Topics 5, Agents 7, Teams 8, SLA 5, Canned 6,
// Fields/Forms 7) in `src-tauri/crates/sorng-osticket/src/commands.rs`. Every
// command's first arg is the live connection `id` (the shell's `connectionId`).
//
// The command ARGUMENT names follow Tauri's camelCase conversion:
// `dept_id -> deptId`, `topic_id -> topicId`, `agent_id -> agentId`,
// `team_id -> teamId`, `staff_id -> staffId`, `sla_id -> slaId`,
// `canned_id -> cannedId`, `form_id -> formId`, `field_id -> fieldId`,
// `on_vacation -> onVacation`; request-bearing commands pass the struct as
// `request`. The request/response STRUCT fields themselves stay snake_case — see
// `../../../types/osticket/admin`.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  CreateAgentRequest,
  CreateCannedResponseRequest,
  CreateCustomFieldRequest,
  CreateDepartmentRequest,
  CreateSlaRequest,
  CreateTeamRequest,
  CreateTopicRequest,
  OsticketAgent,
  OsticketCannedResponse,
  OsticketCustomField,
  OsticketDepartment,
  OsticketForm,
  OsticketSla,
  OsticketTeam,
  OsticketTopic,
  TeamMember,
  UpdateAgentRequest,
  UpdateCannedResponseRequest,
  UpdateCustomFieldRequest,
  UpdateDepartmentRequest,
  UpdateSlaRequest,
  UpdateTeamRequest,
  UpdateTopicRequest,
} from "../../../types/osticket/admin";

export const osticketAdminApi = {
  // ── Departments (6) ────────────────────────────────────────────
  listDepartments: (id: string) =>
    invoke<OsticketDepartment[]>("osticket_list_departments", { id }),
  getDepartment: (id: string, deptId: number) =>
    invoke<OsticketDepartment>("osticket_get_department", { id, deptId }),
  createDepartment: (id: string, request: CreateDepartmentRequest) =>
    invoke<OsticketDepartment>("osticket_create_department", { id, request }),
  updateDepartment: (
    id: string,
    deptId: number,
    request: UpdateDepartmentRequest,
  ) =>
    invoke<OsticketDepartment>("osticket_update_department", {
      id,
      deptId,
      request,
    }),
  deleteDepartment: (id: string, deptId: number) =>
    invoke<void>("osticket_delete_department", { id, deptId }),
  getDepartmentAgents: (id: string, deptId: number) =>
    invoke<OsticketAgent[]>("osticket_get_department_agents", { id, deptId }),

  // ── Help Topics (5) ────────────────────────────────────────────
  listTopics: (id: string) =>
    invoke<OsticketTopic[]>("osticket_list_topics", { id }),
  getTopic: (id: string, topicId: number) =>
    invoke<OsticketTopic>("osticket_get_topic", { id, topicId }),
  createTopic: (id: string, request: CreateTopicRequest) =>
    invoke<OsticketTopic>("osticket_create_topic", { id, request }),
  updateTopic: (id: string, topicId: number, request: UpdateTopicRequest) =>
    invoke<OsticketTopic>("osticket_update_topic", { id, topicId, request }),
  deleteTopic: (id: string, topicId: number) =>
    invoke<void>("osticket_delete_topic", { id, topicId }),

  // ── Agents / Staff (7) ─────────────────────────────────────────
  listAgents: (id: string) =>
    invoke<OsticketAgent[]>("osticket_list_agents", { id }),
  getAgent: (id: string, agentId: number) =>
    invoke<OsticketAgent>("osticket_get_agent", { id, agentId }),
  createAgent: (id: string, request: CreateAgentRequest) =>
    invoke<OsticketAgent>("osticket_create_agent", { id, request }),
  updateAgent: (id: string, agentId: number, request: UpdateAgentRequest) =>
    invoke<OsticketAgent>("osticket_update_agent", { id, agentId, request }),
  deleteAgent: (id: string, agentId: number) =>
    invoke<void>("osticket_delete_agent", { id, agentId }),
  setAgentVacation: (id: string, agentId: number, onVacation: boolean) =>
    invoke<OsticketAgent>("osticket_set_agent_vacation", {
      id,
      agentId,
      onVacation,
    }),
  getAgentTeams: (id: string, agentId: number) =>
    invoke<OsticketTeam[]>("osticket_get_agent_teams", { id, agentId }),

  // ── Teams (8) ──────────────────────────────────────────────────
  listTeams: (id: string) =>
    invoke<OsticketTeam[]>("osticket_list_teams", { id }),
  getTeam: (id: string, teamId: number) =>
    invoke<OsticketTeam>("osticket_get_team", { id, teamId }),
  createTeam: (id: string, request: CreateTeamRequest) =>
    invoke<OsticketTeam>("osticket_create_team", { id, request }),
  updateTeam: (id: string, teamId: number, request: UpdateTeamRequest) =>
    invoke<OsticketTeam>("osticket_update_team", { id, teamId, request }),
  deleteTeam: (id: string, teamId: number) =>
    invoke<void>("osticket_delete_team", { id, teamId }),
  addTeamMember: (id: string, teamId: number, staffId: number) =>
    invoke<TeamMember>("osticket_add_team_member", { id, teamId, staffId }),
  removeTeamMember: (id: string, teamId: number, staffId: number) =>
    invoke<void>("osticket_remove_team_member", { id, teamId, staffId }),
  getTeamMembers: (id: string, teamId: number) =>
    invoke<TeamMember[]>("osticket_get_team_members", { id, teamId }),

  // ── SLA Plans (5) ──────────────────────────────────────────────
  listSla: (id: string) => invoke<OsticketSla[]>("osticket_list_sla", { id }),
  getSla: (id: string, slaId: number) =>
    invoke<OsticketSla>("osticket_get_sla", { id, slaId }),
  createSla: (id: string, request: CreateSlaRequest) =>
    invoke<OsticketSla>("osticket_create_sla", { id, request }),
  updateSla: (id: string, slaId: number, request: UpdateSlaRequest) =>
    invoke<OsticketSla>("osticket_update_sla", { id, slaId, request }),
  deleteSla: (id: string, slaId: number) =>
    invoke<void>("osticket_delete_sla", { id, slaId }),

  // ── Canned Responses (6) ───────────────────────────────────────
  listCannedResponses: (id: string) =>
    invoke<OsticketCannedResponse[]>("osticket_list_canned_responses", { id }),
  getCannedResponse: (id: string, cannedId: number) =>
    invoke<OsticketCannedResponse>("osticket_get_canned_response", {
      id,
      cannedId,
    }),
  createCannedResponse: (id: string, request: CreateCannedResponseRequest) =>
    invoke<OsticketCannedResponse>("osticket_create_canned_response", {
      id,
      request,
    }),
  updateCannedResponse: (
    id: string,
    cannedId: number,
    request: UpdateCannedResponseRequest,
  ) =>
    invoke<OsticketCannedResponse>("osticket_update_canned_response", {
      id,
      cannedId,
      request,
    }),
  deleteCannedResponse: (id: string, cannedId: number) =>
    invoke<void>("osticket_delete_canned_response", { id, cannedId }),
  searchCannedResponses: (id: string, query: string) =>
    invoke<OsticketCannedResponse[]>("osticket_search_canned_responses", {
      id,
      query,
    }),

  // ── Custom Fields / Forms (7) ──────────────────────────────────
  listForms: (id: string) =>
    invoke<OsticketForm[]>("osticket_list_forms", { id }),
  getForm: (id: string, formId: number) =>
    invoke<OsticketForm>("osticket_get_form", { id, formId }),
  listCustomFields: (id: string, formId: number) =>
    invoke<OsticketCustomField[]>("osticket_list_custom_fields", { id, formId }),
  getCustomField: (id: string, fieldId: number) =>
    invoke<OsticketCustomField>("osticket_get_custom_field", { id, fieldId }),
  createCustomField: (id: string, request: CreateCustomFieldRequest) =>
    invoke<OsticketCustomField>("osticket_create_custom_field", { id, request }),
  updateCustomField: (
    id: string,
    fieldId: number,
    request: UpdateCustomFieldRequest,
  ) =>
    invoke<OsticketCustomField>("osticket_update_custom_field", {
      id,
      fieldId,
      request,
    }),
  deleteCustomField: (id: string, fieldId: number) =>
    invoke<void>("osticket_delete_custom_field", { id, fieldId }),
};

export type OsticketAdminApi = typeof osticketAdminApi;

/**
 * Convenience hook for the Administration tab. Exposes the invoke slice plus
 * shared `isLoading`/`error` state and a `run` helper that binds the live
 * `connectionId`, wraps a call, and funnels failures into `error`
 * (`typeof e === 'string' ? e : (e as Error).message`).
 */
export function useOsticketAdmin(connectionId: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: (id: string) => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(connectionId);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [connectionId],
  );

  return {
    api: osticketAdminApi,
    connectionId,
    isLoading,
    error,
    setError,
    run,
  };
}

export type UseOsticketAdmin = ReturnType<typeof useOsticketAdmin>;
