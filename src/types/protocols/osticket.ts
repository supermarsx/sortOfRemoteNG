// ── TypeScript types for sorng-osticket crate ────────────────────────────────

// ── Connection ────────────────────────────────────────────────────────────────

export interface OsticketConnectionConfig {
  name: string;
  host: string;
  apiKey: string;
  timeoutSeconds?: number;
  skipTlsVerify?: boolean;
}

export interface OsticketConnectionStatus {
  connected: boolean;
  version?: string;
  message?: string;
}

// ── Tickets ──────────────────────────────────────────────────────────────────

export interface TicketAttachment {
  id?: number;
  name?: string;
  size?: number;
  contentType?: string;
  url?: string;
}

export interface TicketThread {
  id?: number;
  threadType?: string;
  poster?: string;
  body?: string;
  created?: string;
  title?: string;
  attachments: TicketAttachment[];
}

export interface TicketCollaborator {
  userId?: number;
  name?: string;
  email?: string;
}

export interface OsticketTicket {
  id?: number;
  number?: string;
  subject?: string;
  status?: string;
  statusId?: number;
  priority?: string;
  priorityId?: number;
  department?: string;
  departmentId?: number;
  topic?: string;
  topicId?: number;
  user?: string;
  userId?: number;
  staff?: string;
  staffId?: number;
  team?: string;
  teamId?: number;
  sla?: string;
  slaId?: number;
  dueDate?: string;
  closeDate?: string;
  created?: string;
  updated?: string;
  source?: string;
  ipAddress?: string;
  isOverdue: boolean;
  isAnswered: boolean;
  threads: TicketThread[];
  collaborators: TicketCollaborator[];
  attachments: TicketAttachment[];
}

export interface CreateAttachment {
  filename: string;
  /** Base64-encoded content */
  data: string;
  contentType?: string;
}

export interface CreateTicketRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
  phone?: string;
  topicId?: number;
  deptId?: number;
  priorityId?: number;
  slaId?: number;
  dueDate?: string;
  source?: string;
  ip?: string;
  autoRespond?: boolean;
  alert?: boolean;
  internalNote?: string;
  attachments?: CreateAttachment[];
}

export interface UpdateTicketRequest {
  statusId?: number;
  priorityId?: number;
  deptId?: number;
  topicId?: number;
  slaId?: number;
  staffId?: number;
  teamId?: number;
  dueDate?: string;
  subject?: string;
}

export interface PostThreadRequest {
  body: string;
  threadType?: string;
  poster?: string;
  title?: string;
  attachments?: CreateAttachment[];
}

export interface TicketSearchRequest {
  status?: string;
  deptId?: number;
  topicId?: number;
  staffId?: number;
  teamId?: number;
  userId?: number;
  query?: string;
  isOverdue?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
}

export interface TicketSearchResponse {
  tickets: OsticketTicket[];
  total?: number;
  page?: number;
  pages?: number;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface OsticketUser {
  id?: number;
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  status?: string;
  created?: string;
  updated?: string;
  orgId?: number;
  defaultEmailId?: number;
  emails: string[];
}

export interface CreateUserRequest {
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  orgId?: number;
  password?: string;
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  orgId?: number;
}

// ── Departments ──────────────────────────────────────────────────────────────

export interface OsticketDepartment {
  id?: number;
  name?: string;
  signature?: string;
  managerId?: number;
  slaId?: number;
  emailId?: number;
  autoRespEmailId?: number;
  parentId?: number;
  path?: string;
  isActive: boolean;
  isPublic: boolean;
  created?: string;
  updated?: string;
}

export interface CreateDepartmentRequest {
  name: string;
  managerId?: number;
  slaId?: number;
  emailId?: number;
  parentId?: number;
  signature?: string;
  isActive?: boolean;
  isPublic?: boolean;
}

export interface UpdateDepartmentRequest {
  name?: string;
  managerId?: number;
  slaId?: number;
  signature?: string;
  isActive?: boolean;
  isPublic?: boolean;
}

// ── Help Topics ──────────────────────────────────────────────────────────────

export interface OsticketTopic {
  id?: number;
  name?: string;
  deptId?: number;
  priorityId?: number;
  slaId?: number;
  autoResp?: boolean;
  statusId?: number;
  sort?: number;
  isActive: boolean;
  isPublic: boolean;
  notes?: string;
  created?: string;
  updated?: string;
}

export interface CreateTopicRequest {
  name: string;
  deptId?: number;
  priorityId?: number;
  slaId?: number;
  autoResp?: boolean;
  isActive?: boolean;
  isPublic?: boolean;
  notes?: string;
}

export interface UpdateTopicRequest {
  name?: string;
  deptId?: number;
  priorityId?: number;
  slaId?: number;
  autoResp?: boolean;
  isActive?: boolean;
  isPublic?: boolean;
}

// ── Agents (Staff) ───────────────────────────────────────────────────────────

export interface OsticketAgent {
  id?: number;
  username?: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  signature?: string;
  deptId?: number;
  roleId?: number;
  timezone?: string;
  isAdmin: boolean;
  isActive: boolean;
  isVisible: boolean;
  onVacation: boolean;
  created?: string;
  updated?: string;
  lastLogin?: string;
  permissions: string[];
}

export interface CreateAgentRequest {
  username: string;
  firstname: string;
  lastname: string;
  email: string;
  password: string;
  phone?: string;
  deptId?: number;
  roleId?: number;
  timezone?: string;
  isAdmin?: boolean;
  isActive?: boolean;
}

export interface UpdateAgentRequest {
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  deptId?: number;
  roleId?: number;
  isActive?: boolean;
  onVacation?: boolean;
  signature?: string;
}

// ── Teams ────────────────────────────────────────────────────────────────────

export interface TeamMember {
  staffId: number;
  name?: string;
}

export interface OsticketTeam {
  id?: number;
  name?: string;
  leadId?: number;
  isActive: boolean;
  notes?: string;
  created?: string;
  updated?: string;
  members: TeamMember[];
}

export interface CreateTeamRequest {
  name: string;
  leadId?: number;
  isActive?: boolean;
  notes?: string;
  memberIds?: number[];
}

export interface UpdateTeamRequest {
  name?: string;
  leadId?: number;
  isActive?: boolean;
  notes?: string;
  memberIds?: number[];
}

// ── SLA Plans ────────────────────────────────────────────────────────────────

export interface OsticketSla {
  id?: number;
  name?: string;
  gracePeriod?: number;
  notes?: string;
  isActive: boolean;
  disableOverdueAlerts: boolean;
  transient: boolean;
  created?: string;
  updated?: string;
}

export interface CreateSlaRequest {
  name: string;
  gracePeriod: number;
  notes?: string;
  isActive?: boolean;
  disableOverdueAlerts?: boolean;
  transient?: boolean;
}

export interface UpdateSlaRequest {
  name?: string;
  gracePeriod?: number;
  notes?: string;
  isActive?: boolean;
  disableOverdueAlerts?: boolean;
}

// ── Canned Responses ─────────────────────────────────────────────────────────

export interface OsticketCannedResponse {
  id?: number;
  title?: string;
  response?: string;
  deptId?: number;
  isActive: boolean;
  notes?: string;
  created?: string;
  updated?: string;
  attachments: TicketAttachment[];
}

export interface CreateCannedResponseRequest {
  title: string;
  response: string;
  deptId?: number;
  isActive?: boolean;
  notes?: string;
}

export interface UpdateCannedResponseRequest {
  title?: string;
  response?: string;
  deptId?: number;
  isActive?: boolean;
  notes?: string;
}

// ── Custom Fields ────────────────────────────────────────────────────────────

export interface OsticketCustomField {
  id?: number;
  name?: string;
  label?: string;
  fieldType?: string;
  formId?: number;
  sort?: number;
  required: boolean;
  private: boolean;
  editable: boolean;
  hint?: string;
  configuration?: unknown;
  created?: string;
  updated?: string;
}

export interface OsticketForm {
  id?: number;
  title?: string;
  instructions?: string;
  notes?: string;
  fields: OsticketCustomField[];
  created?: string;
  updated?: string;
}

export interface CreateCustomFieldRequest {
  name: string;
  label: string;
  fieldType: string;
  formId: number;
  required?: boolean;
  private?: boolean;
  editable?: boolean;
  hint?: string;
  configuration?: unknown;
}

export interface UpdateCustomFieldRequest {
  label?: string;
  required?: boolean;
  private?: boolean;
  editable?: boolean;
  hint?: string;
  configuration?: unknown;
}

// ── Pagination ───────────────────────────────────────────────────────────────

export interface OsticketPagination {
  page?: number;
  limit?: number;
}
