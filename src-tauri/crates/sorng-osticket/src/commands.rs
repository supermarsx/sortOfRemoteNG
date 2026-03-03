// ── sorng-osticket/src/commands.rs ─────────────────────────────────────────────
use tauri::State;
use crate::service::OsticketServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;
fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_connect(state: State<'_, OsticketServiceState>, id: String, config: OsticketConnectionConfig) -> CmdResult<OsticketConnectionStatus> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_disconnect(state: State<'_, OsticketServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn osticket_list_connections(state: State<'_, OsticketServiceState>) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn osticket_ping(state: State<'_, OsticketServiceState>, id: String) -> CmdResult<OsticketConnectionStatus> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Tickets ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_list_tickets(state: State<'_, OsticketServiceState>, id: String, page: Option<u32>, limit: Option<u32>) -> CmdResult<TicketSearchResponse> {
    state.lock().await.list_tickets(&id, page, limit).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_search_tickets(state: State<'_, OsticketServiceState>, id: String, request: TicketSearchRequest) -> CmdResult<TicketSearchResponse> {
    state.lock().await.search_tickets(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_ticket(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64) -> CmdResult<OsticketTicket> {
    state.lock().await.get_ticket(&id, ticket_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_create_ticket(state: State<'_, OsticketServiceState>, id: String, request: CreateTicketRequest) -> CmdResult<OsticketTicket> {
    state.lock().await.create_ticket(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_update_ticket(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64, request: UpdateTicketRequest) -> CmdResult<OsticketTicket> {
    state.lock().await.update_ticket(&id, ticket_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_delete_ticket(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64) -> CmdResult<()> {
    state.lock().await.delete_ticket(&id, ticket_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_close_ticket(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64) -> CmdResult<OsticketTicket> {
    state.lock().await.close_ticket(&id, ticket_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_reopen_ticket(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64) -> CmdResult<OsticketTicket> {
    state.lock().await.reopen_ticket(&id, ticket_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_assign_ticket(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64, staff_id: Option<i64>, team_id: Option<i64>) -> CmdResult<OsticketTicket> {
    state.lock().await.assign_ticket(&id, ticket_id, staff_id, team_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_post_ticket_reply(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64, request: PostThreadRequest) -> CmdResult<TicketThread> {
    state.lock().await.post_ticket_reply(&id, ticket_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_post_ticket_note(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64, request: PostThreadRequest) -> CmdResult<TicketThread> {
    state.lock().await.post_ticket_note(&id, ticket_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_ticket_threads(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64) -> CmdResult<Vec<TicketThread>> {
    state.lock().await.get_ticket_threads(&id, ticket_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_add_ticket_collaborator(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64, user_id: i64, email: Option<String>) -> CmdResult<TicketCollaborator> {
    state.lock().await.add_ticket_collaborator(&id, ticket_id, user_id, email).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_ticket_collaborators(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64) -> CmdResult<Vec<TicketCollaborator>> {
    state.lock().await.get_ticket_collaborators(&id, ticket_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_remove_ticket_collaborator(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64, user_id: i64) -> CmdResult<()> {
    state.lock().await.remove_ticket_collaborator(&id, ticket_id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_transfer_ticket(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64, dept_id: i64) -> CmdResult<OsticketTicket> {
    state.lock().await.transfer_ticket(&id, ticket_id, dept_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_merge_tickets(state: State<'_, OsticketServiceState>, id: String, ticket_id: i64, merge_ids: Vec<i64>) -> CmdResult<OsticketTicket> {
    state.lock().await.merge_tickets(&id, ticket_id, merge_ids).await.map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_list_users(state: State<'_, OsticketServiceState>, id: String, page: Option<u32>, limit: Option<u32>) -> CmdResult<Vec<OsticketUser>> {
    state.lock().await.list_users(&id, page, limit).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_user(state: State<'_, OsticketServiceState>, id: String, user_id: i64) -> CmdResult<OsticketUser> {
    state.lock().await.get_user(&id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_search_users(state: State<'_, OsticketServiceState>, id: String, email: Option<String>, name: Option<String>) -> CmdResult<Vec<OsticketUser>> {
    state.lock().await.search_users(&id, email, name).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_create_user(state: State<'_, OsticketServiceState>, id: String, request: CreateUserRequest) -> CmdResult<OsticketUser> {
    state.lock().await.create_user(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_update_user(state: State<'_, OsticketServiceState>, id: String, user_id: i64, request: UpdateUserRequest) -> CmdResult<OsticketUser> {
    state.lock().await.update_user(&id, user_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_delete_user(state: State<'_, OsticketServiceState>, id: String, user_id: i64) -> CmdResult<()> {
    state.lock().await.delete_user(&id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_user_tickets(state: State<'_, OsticketServiceState>, id: String, user_id: i64) -> CmdResult<Vec<OsticketTicket>> {
    state.lock().await.get_user_tickets(&id, user_id).await.map_err(map_err)
}

// ── Departments ───────────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_list_departments(state: State<'_, OsticketServiceState>, id: String) -> CmdResult<Vec<OsticketDepartment>> {
    state.lock().await.list_departments(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_department(state: State<'_, OsticketServiceState>, id: String, dept_id: i64) -> CmdResult<OsticketDepartment> {
    state.lock().await.get_department(&id, dept_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_create_department(state: State<'_, OsticketServiceState>, id: String, request: CreateDepartmentRequest) -> CmdResult<OsticketDepartment> {
    state.lock().await.create_department(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_update_department(state: State<'_, OsticketServiceState>, id: String, dept_id: i64, request: UpdateDepartmentRequest) -> CmdResult<OsticketDepartment> {
    state.lock().await.update_department(&id, dept_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_delete_department(state: State<'_, OsticketServiceState>, id: String, dept_id: i64) -> CmdResult<()> {
    state.lock().await.delete_department(&id, dept_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_department_agents(state: State<'_, OsticketServiceState>, id: String, dept_id: i64) -> CmdResult<Vec<OsticketAgent>> {
    state.lock().await.get_department_agents(&id, dept_id).await.map_err(map_err)
}

// ── Topics ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_list_topics(state: State<'_, OsticketServiceState>, id: String) -> CmdResult<Vec<OsticketTopic>> {
    state.lock().await.list_topics(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_topic(state: State<'_, OsticketServiceState>, id: String, topic_id: i64) -> CmdResult<OsticketTopic> {
    state.lock().await.get_topic(&id, topic_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_create_topic(state: State<'_, OsticketServiceState>, id: String, request: CreateTopicRequest) -> CmdResult<OsticketTopic> {
    state.lock().await.create_topic(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_update_topic(state: State<'_, OsticketServiceState>, id: String, topic_id: i64, request: UpdateTopicRequest) -> CmdResult<OsticketTopic> {
    state.lock().await.update_topic(&id, topic_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_delete_topic(state: State<'_, OsticketServiceState>, id: String, topic_id: i64) -> CmdResult<()> {
    state.lock().await.delete_topic(&id, topic_id).await.map_err(map_err)
}

// ── Agents ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_list_agents(state: State<'_, OsticketServiceState>, id: String) -> CmdResult<Vec<OsticketAgent>> {
    state.lock().await.list_agents(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_agent(state: State<'_, OsticketServiceState>, id: String, agent_id: i64) -> CmdResult<OsticketAgent> {
    state.lock().await.get_agent(&id, agent_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_create_agent(state: State<'_, OsticketServiceState>, id: String, request: CreateAgentRequest) -> CmdResult<OsticketAgent> {
    state.lock().await.create_agent(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_update_agent(state: State<'_, OsticketServiceState>, id: String, agent_id: i64, request: UpdateAgentRequest) -> CmdResult<OsticketAgent> {
    state.lock().await.update_agent(&id, agent_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_delete_agent(state: State<'_, OsticketServiceState>, id: String, agent_id: i64) -> CmdResult<()> {
    state.lock().await.delete_agent(&id, agent_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_set_agent_vacation(state: State<'_, OsticketServiceState>, id: String, agent_id: i64, on_vacation: bool) -> CmdResult<OsticketAgent> {
    state.lock().await.set_agent_vacation(&id, agent_id, on_vacation).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_agent_teams(state: State<'_, OsticketServiceState>, id: String, agent_id: i64) -> CmdResult<Vec<OsticketTeam>> {
    state.lock().await.get_agent_teams(&id, agent_id).await.map_err(map_err)
}

// ── Teams ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_list_teams(state: State<'_, OsticketServiceState>, id: String) -> CmdResult<Vec<OsticketTeam>> {
    state.lock().await.list_teams(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_team(state: State<'_, OsticketServiceState>, id: String, team_id: i64) -> CmdResult<OsticketTeam> {
    state.lock().await.get_team(&id, team_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_create_team(state: State<'_, OsticketServiceState>, id: String, request: CreateTeamRequest) -> CmdResult<OsticketTeam> {
    state.lock().await.create_team(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_update_team(state: State<'_, OsticketServiceState>, id: String, team_id: i64, request: UpdateTeamRequest) -> CmdResult<OsticketTeam> {
    state.lock().await.update_team(&id, team_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_delete_team(state: State<'_, OsticketServiceState>, id: String, team_id: i64) -> CmdResult<()> {
    state.lock().await.delete_team(&id, team_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_add_team_member(state: State<'_, OsticketServiceState>, id: String, team_id: i64, staff_id: i64) -> CmdResult<TeamMember> {
    state.lock().await.add_team_member(&id, team_id, staff_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_remove_team_member(state: State<'_, OsticketServiceState>, id: String, team_id: i64, staff_id: i64) -> CmdResult<()> {
    state.lock().await.remove_team_member(&id, team_id, staff_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_team_members(state: State<'_, OsticketServiceState>, id: String, team_id: i64) -> CmdResult<Vec<TeamMember>> {
    state.lock().await.get_team_members(&id, team_id).await.map_err(map_err)
}

// ── SLA ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_list_sla(state: State<'_, OsticketServiceState>, id: String) -> CmdResult<Vec<OsticketSla>> {
    state.lock().await.list_sla(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_sla(state: State<'_, OsticketServiceState>, id: String, sla_id: i64) -> CmdResult<OsticketSla> {
    state.lock().await.get_sla(&id, sla_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_create_sla(state: State<'_, OsticketServiceState>, id: String, request: CreateSlaRequest) -> CmdResult<OsticketSla> {
    state.lock().await.create_sla(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_update_sla(state: State<'_, OsticketServiceState>, id: String, sla_id: i64, request: UpdateSlaRequest) -> CmdResult<OsticketSla> {
    state.lock().await.update_sla(&id, sla_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_delete_sla(state: State<'_, OsticketServiceState>, id: String, sla_id: i64) -> CmdResult<()> {
    state.lock().await.delete_sla(&id, sla_id).await.map_err(map_err)
}

// ── Canned Responses ──────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_list_canned_responses(state: State<'_, OsticketServiceState>, id: String) -> CmdResult<Vec<OsticketCannedResponse>> {
    state.lock().await.list_canned_responses(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_canned_response(state: State<'_, OsticketServiceState>, id: String, canned_id: i64) -> CmdResult<OsticketCannedResponse> {
    state.lock().await.get_canned_response(&id, canned_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_create_canned_response(state: State<'_, OsticketServiceState>, id: String, request: CreateCannedResponseRequest) -> CmdResult<OsticketCannedResponse> {
    state.lock().await.create_canned_response(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_update_canned_response(state: State<'_, OsticketServiceState>, id: String, canned_id: i64, request: UpdateCannedResponseRequest) -> CmdResult<OsticketCannedResponse> {
    state.lock().await.update_canned_response(&id, canned_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_delete_canned_response(state: State<'_, OsticketServiceState>, id: String, canned_id: i64) -> CmdResult<()> {
    state.lock().await.delete_canned_response(&id, canned_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_search_canned_responses(state: State<'_, OsticketServiceState>, id: String, query: String) -> CmdResult<Vec<OsticketCannedResponse>> {
    state.lock().await.search_canned_responses(&id, query).await.map_err(map_err)
}

// ── Custom Fields ─────────────────────────────────────────────────

#[tauri::command]
pub async fn osticket_list_forms(state: State<'_, OsticketServiceState>, id: String) -> CmdResult<Vec<OsticketForm>> {
    state.lock().await.list_forms(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_form(state: State<'_, OsticketServiceState>, id: String, form_id: i64) -> CmdResult<OsticketForm> {
    state.lock().await.get_form(&id, form_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_list_custom_fields(state: State<'_, OsticketServiceState>, id: String, form_id: i64) -> CmdResult<Vec<OsticketCustomField>> {
    state.lock().await.list_custom_fields(&id, form_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_get_custom_field(state: State<'_, OsticketServiceState>, id: String, field_id: i64) -> CmdResult<OsticketCustomField> {
    state.lock().await.get_custom_field(&id, field_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_create_custom_field(state: State<'_, OsticketServiceState>, id: String, request: CreateCustomFieldRequest) -> CmdResult<OsticketCustomField> {
    state.lock().await.create_custom_field(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_update_custom_field(state: State<'_, OsticketServiceState>, id: String, field_id: i64, request: UpdateCustomFieldRequest) -> CmdResult<OsticketCustomField> {
    state.lock().await.update_custom_field(&id, field_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn osticket_delete_custom_field(state: State<'_, OsticketServiceState>, id: String, field_id: i64) -> CmdResult<()> {
    state.lock().await.delete_custom_field(&id, field_id).await.map_err(map_err)
}
