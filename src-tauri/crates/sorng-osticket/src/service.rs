// ── sorng-osticket/src/service.rs ──────────────────────────────────────────────
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::OsticketClient;
use crate::error::{OsticketError, OsticketResult};
use crate::types::*;

use crate::tickets::TicketManager;
use crate::users::OsticketUserManager;
use crate::departments::DepartmentManager;
use crate::topics::TopicManager;
use crate::agents::AgentManager;
use crate::teams::TeamManager;
use crate::sla::SlaManager;
use crate::canned_responses::CannedResponseManager;
use crate::custom_fields::CustomFieldManager;

pub type OsticketServiceState = Arc<Mutex<OsticketService>>;

pub struct OsticketService {
    connections: HashMap<String, OsticketClient>,
}

impl OsticketService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ─────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: OsticketConnectionConfig) -> OsticketResult<OsticketConnectionStatus> {
        let client = OsticketClient::from_config(&config)?;
        let status = client.ping().await?;
        self.connections.insert(id, client);
        Ok(status)
    }

    pub fn disconnect(&mut self, id: &str) -> OsticketResult<()> {
        self.connections.remove(id).map(|_| ())
            .ok_or_else(|| OsticketError::session(&format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> OsticketResult<&OsticketClient> {
        self.connections.get(id)
            .ok_or_else(|| OsticketError::session(&format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> OsticketResult<OsticketConnectionStatus> {
        self.client(id)?.ping().await
    }

    // ── Tickets ──────────────────────────────────────────────────

    pub async fn list_tickets(&self, id: &str, page: Option<u32>, limit: Option<u32>) -> OsticketResult<TicketSearchResponse> {
        TicketManager::list(self.client(id)?, page, limit).await
    }

    pub async fn search_tickets(&self, id: &str, req: TicketSearchRequest) -> OsticketResult<TicketSearchResponse> {
        TicketManager::search(self.client(id)?, &req).await
    }

    pub async fn get_ticket(&self, id: &str, ticket_id: i64) -> OsticketResult<OsticketTicket> {
        TicketManager::get(self.client(id)?, ticket_id).await
    }

    pub async fn create_ticket(&self, id: &str, req: CreateTicketRequest) -> OsticketResult<OsticketTicket> {
        TicketManager::create(self.client(id)?, &req).await
    }

    pub async fn update_ticket(&self, id: &str, ticket_id: i64, req: UpdateTicketRequest) -> OsticketResult<OsticketTicket> {
        TicketManager::update(self.client(id)?, ticket_id, &req).await
    }

    pub async fn delete_ticket(&self, id: &str, ticket_id: i64) -> OsticketResult<()> {
        TicketManager::delete(self.client(id)?, ticket_id).await
    }

    pub async fn close_ticket(&self, id: &str, ticket_id: i64) -> OsticketResult<OsticketTicket> {
        TicketManager::close(self.client(id)?, ticket_id).await
    }

    pub async fn reopen_ticket(&self, id: &str, ticket_id: i64) -> OsticketResult<OsticketTicket> {
        TicketManager::reopen(self.client(id)?, ticket_id).await
    }

    pub async fn assign_ticket(&self, id: &str, ticket_id: i64, staff_id: Option<i64>, team_id: Option<i64>) -> OsticketResult<OsticketTicket> {
        TicketManager::assign(self.client(id)?, ticket_id, staff_id, team_id).await
    }

    pub async fn post_ticket_reply(&self, id: &str, ticket_id: i64, req: PostThreadRequest) -> OsticketResult<TicketThread> {
        TicketManager::post_reply(self.client(id)?, ticket_id, &req).await
    }

    pub async fn post_ticket_note(&self, id: &str, ticket_id: i64, req: PostThreadRequest) -> OsticketResult<TicketThread> {
        TicketManager::post_note(self.client(id)?, ticket_id, &req).await
    }

    pub async fn get_ticket_threads(&self, id: &str, ticket_id: i64) -> OsticketResult<Vec<TicketThread>> {
        TicketManager::get_threads(self.client(id)?, ticket_id).await
    }

    pub async fn add_ticket_collaborator(&self, id: &str, ticket_id: i64, user_id: i64, email: Option<String>) -> OsticketResult<TicketCollaborator> {
        TicketManager::add_collaborator(self.client(id)?, ticket_id, user_id, email.as_deref()).await
    }

    pub async fn get_ticket_collaborators(&self, id: &str, ticket_id: i64) -> OsticketResult<Vec<TicketCollaborator>> {
        TicketManager::get_collaborators(self.client(id)?, ticket_id).await
    }

    pub async fn remove_ticket_collaborator(&self, id: &str, ticket_id: i64, user_id: i64) -> OsticketResult<()> {
        TicketManager::remove_collaborator(self.client(id)?, ticket_id, user_id).await
    }

    pub async fn transfer_ticket(&self, id: &str, ticket_id: i64, dept_id: i64) -> OsticketResult<OsticketTicket> {
        TicketManager::transfer(self.client(id)?, ticket_id, dept_id).await
    }

    pub async fn merge_tickets(&self, id: &str, ticket_id: i64, merge_ids: Vec<i64>) -> OsticketResult<OsticketTicket> {
        TicketManager::merge(self.client(id)?, ticket_id, &merge_ids).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str, page: Option<u32>, limit: Option<u32>) -> OsticketResult<Vec<OsticketUser>> {
        OsticketUserManager::list(self.client(id)?, page, limit).await
    }

    pub async fn get_user(&self, id: &str, user_id: i64) -> OsticketResult<OsticketUser> {
        OsticketUserManager::get(self.client(id)?, user_id).await
    }

    pub async fn search_users(&self, id: &str, email: Option<String>, name: Option<String>) -> OsticketResult<Vec<OsticketUser>> {
        OsticketUserManager::search(self.client(id)?, email.as_deref(), name.as_deref()).await
    }

    pub async fn create_user(&self, id: &str, req: CreateUserRequest) -> OsticketResult<OsticketUser> {
        OsticketUserManager::create(self.client(id)?, &req).await
    }

    pub async fn update_user(&self, id: &str, user_id: i64, req: UpdateUserRequest) -> OsticketResult<OsticketUser> {
        OsticketUserManager::update(self.client(id)?, user_id, &req).await
    }

    pub async fn delete_user(&self, id: &str, user_id: i64) -> OsticketResult<()> {
        OsticketUserManager::delete(self.client(id)?, user_id).await
    }

    pub async fn get_user_tickets(&self, id: &str, user_id: i64) -> OsticketResult<Vec<OsticketTicket>> {
        OsticketUserManager::get_tickets(self.client(id)?, user_id).await
    }

    // ── Departments ──────────────────────────────────────────────

    pub async fn list_departments(&self, id: &str) -> OsticketResult<Vec<OsticketDepartment>> {
        DepartmentManager::list(self.client(id)?).await
    }

    pub async fn get_department(&self, id: &str, dept_id: i64) -> OsticketResult<OsticketDepartment> {
        DepartmentManager::get(self.client(id)?, dept_id).await
    }

    pub async fn create_department(&self, id: &str, req: CreateDepartmentRequest) -> OsticketResult<OsticketDepartment> {
        DepartmentManager::create(self.client(id)?, &req).await
    }

    pub async fn update_department(&self, id: &str, dept_id: i64, req: UpdateDepartmentRequest) -> OsticketResult<OsticketDepartment> {
        DepartmentManager::update(self.client(id)?, dept_id, &req).await
    }

    pub async fn delete_department(&self, id: &str, dept_id: i64) -> OsticketResult<()> {
        DepartmentManager::delete(self.client(id)?, dept_id).await
    }

    pub async fn get_department_agents(&self, id: &str, dept_id: i64) -> OsticketResult<Vec<OsticketAgent>> {
        DepartmentManager::get_agents(self.client(id)?, dept_id).await
    }

    // ── Topics ───────────────────────────────────────────────────

    pub async fn list_topics(&self, id: &str) -> OsticketResult<Vec<OsticketTopic>> {
        TopicManager::list(self.client(id)?).await
    }

    pub async fn get_topic(&self, id: &str, topic_id: i64) -> OsticketResult<OsticketTopic> {
        TopicManager::get(self.client(id)?, topic_id).await
    }

    pub async fn create_topic(&self, id: &str, req: CreateTopicRequest) -> OsticketResult<OsticketTopic> {
        TopicManager::create(self.client(id)?, &req).await
    }

    pub async fn update_topic(&self, id: &str, topic_id: i64, req: UpdateTopicRequest) -> OsticketResult<OsticketTopic> {
        TopicManager::update(self.client(id)?, topic_id, &req).await
    }

    pub async fn delete_topic(&self, id: &str, topic_id: i64) -> OsticketResult<()> {
        TopicManager::delete(self.client(id)?, topic_id).await
    }

    // ── Agents ───────────────────────────────────────────────────

    pub async fn list_agents(&self, id: &str) -> OsticketResult<Vec<OsticketAgent>> {
        AgentManager::list(self.client(id)?).await
    }

    pub async fn get_agent(&self, id: &str, agent_id: i64) -> OsticketResult<OsticketAgent> {
        AgentManager::get(self.client(id)?, agent_id).await
    }

    pub async fn create_agent(&self, id: &str, req: CreateAgentRequest) -> OsticketResult<OsticketAgent> {
        AgentManager::create(self.client(id)?, &req).await
    }

    pub async fn update_agent(&self, id: &str, agent_id: i64, req: UpdateAgentRequest) -> OsticketResult<OsticketAgent> {
        AgentManager::update(self.client(id)?, agent_id, &req).await
    }

    pub async fn delete_agent(&self, id: &str, agent_id: i64) -> OsticketResult<()> {
        AgentManager::delete(self.client(id)?, agent_id).await
    }

    pub async fn set_agent_vacation(&self, id: &str, agent_id: i64, on_vacation: bool) -> OsticketResult<OsticketAgent> {
        AgentManager::set_vacation(self.client(id)?, agent_id, on_vacation).await
    }

    pub async fn get_agent_teams(&self, id: &str, agent_id: i64) -> OsticketResult<Vec<OsticketTeam>> {
        AgentManager::get_teams(self.client(id)?, agent_id).await
    }

    // ── Teams ────────────────────────────────────────────────────

    pub async fn list_teams(&self, id: &str) -> OsticketResult<Vec<OsticketTeam>> {
        TeamManager::list(self.client(id)?).await
    }

    pub async fn get_team(&self, id: &str, team_id: i64) -> OsticketResult<OsticketTeam> {
        TeamManager::get(self.client(id)?, team_id).await
    }

    pub async fn create_team(&self, id: &str, req: CreateTeamRequest) -> OsticketResult<OsticketTeam> {
        TeamManager::create(self.client(id)?, &req).await
    }

    pub async fn update_team(&self, id: &str, team_id: i64, req: UpdateTeamRequest) -> OsticketResult<OsticketTeam> {
        TeamManager::update(self.client(id)?, team_id, &req).await
    }

    pub async fn delete_team(&self, id: &str, team_id: i64) -> OsticketResult<()> {
        TeamManager::delete(self.client(id)?, team_id).await
    }

    pub async fn add_team_member(&self, id: &str, team_id: i64, staff_id: i64) -> OsticketResult<TeamMember> {
        TeamManager::add_member(self.client(id)?, team_id, staff_id).await
    }

    pub async fn remove_team_member(&self, id: &str, team_id: i64, staff_id: i64) -> OsticketResult<()> {
        TeamManager::remove_member(self.client(id)?, team_id, staff_id).await
    }

    pub async fn get_team_members(&self, id: &str, team_id: i64) -> OsticketResult<Vec<TeamMember>> {
        TeamManager::get_members(self.client(id)?, team_id).await
    }

    // ── SLA ──────────────────────────────────────────────────────

    pub async fn list_sla(&self, id: &str) -> OsticketResult<Vec<OsticketSla>> {
        SlaManager::list(self.client(id)?).await
    }

    pub async fn get_sla(&self, id: &str, sla_id: i64) -> OsticketResult<OsticketSla> {
        SlaManager::get(self.client(id)?, sla_id).await
    }

    pub async fn create_sla(&self, id: &str, req: CreateSlaRequest) -> OsticketResult<OsticketSla> {
        SlaManager::create(self.client(id)?, &req).await
    }

    pub async fn update_sla(&self, id: &str, sla_id: i64, req: UpdateSlaRequest) -> OsticketResult<OsticketSla> {
        SlaManager::update(self.client(id)?, sla_id, &req).await
    }

    pub async fn delete_sla(&self, id: &str, sla_id: i64) -> OsticketResult<()> {
        SlaManager::delete(self.client(id)?, sla_id).await
    }

    // ── Canned Responses ─────────────────────────────────────────

    pub async fn list_canned_responses(&self, id: &str) -> OsticketResult<Vec<OsticketCannedResponse>> {
        CannedResponseManager::list(self.client(id)?).await
    }

    pub async fn get_canned_response(&self, id: &str, canned_id: i64) -> OsticketResult<OsticketCannedResponse> {
        CannedResponseManager::get(self.client(id)?, canned_id).await
    }

    pub async fn create_canned_response(&self, id: &str, req: CreateCannedResponseRequest) -> OsticketResult<OsticketCannedResponse> {
        CannedResponseManager::create(self.client(id)?, &req).await
    }

    pub async fn update_canned_response(&self, id: &str, canned_id: i64, req: UpdateCannedResponseRequest) -> OsticketResult<OsticketCannedResponse> {
        CannedResponseManager::update(self.client(id)?, canned_id, &req).await
    }

    pub async fn delete_canned_response(&self, id: &str, canned_id: i64) -> OsticketResult<()> {
        CannedResponseManager::delete(self.client(id)?, canned_id).await
    }

    pub async fn search_canned_responses(&self, id: &str, query: String) -> OsticketResult<Vec<OsticketCannedResponse>> {
        CannedResponseManager::search(self.client(id)?, &query).await
    }

    // ── Custom Fields ────────────────────────────────────────────

    pub async fn list_forms(&self, id: &str) -> OsticketResult<Vec<OsticketForm>> {
        CustomFieldManager::list_forms(self.client(id)?).await
    }

    pub async fn get_form(&self, id: &str, form_id: i64) -> OsticketResult<OsticketForm> {
        CustomFieldManager::get_form(self.client(id)?, form_id).await
    }

    pub async fn list_custom_fields(&self, id: &str, form_id: i64) -> OsticketResult<Vec<OsticketCustomField>> {
        CustomFieldManager::list_fields(self.client(id)?, form_id).await
    }

    pub async fn get_custom_field(&self, id: &str, field_id: i64) -> OsticketResult<OsticketCustomField> {
        CustomFieldManager::get_field(self.client(id)?, field_id).await
    }

    pub async fn create_custom_field(&self, id: &str, req: CreateCustomFieldRequest) -> OsticketResult<OsticketCustomField> {
        CustomFieldManager::create_field(self.client(id)?, &req).await
    }

    pub async fn update_custom_field(&self, id: &str, field_id: i64, req: UpdateCustomFieldRequest) -> OsticketResult<OsticketCustomField> {
        CustomFieldManager::update_field(self.client(id)?, field_id, &req).await
    }

    pub async fn delete_custom_field(&self, id: &str, field_id: i64) -> OsticketResult<()> {
        CustomFieldManager::delete_field(self.client(id)?, field_id).await
    }
}
