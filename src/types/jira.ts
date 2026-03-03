// ── TypeScript types for sorng-jira crate ────────────────────────────────────

// ── Connection ────────────────────────────────────────────────────────────────

export type JiraAuthMethod =
  | { Basic: { username: string; password: string } }
  | { ApiToken: { email: string; token: string } }
  | { Bearer: { token: string } }
  | { Pat: { token: string } };

export interface JiraConnectionConfig {
  name: string;
  host: string;
  auth: JiraAuthMethod;
  apiVersion?: string;
  timeoutSeconds?: number;
  skipTlsVerify?: boolean;
}

export interface JiraConnectionStatus {
  connected: boolean;
  serverTitle?: string;
  version?: string;
  deploymentType?: string;
  message?: string;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface JiraUser {
  self: string;
  accountId?: string;
  emailAddress?: string;
  displayName?: string;
  active?: boolean;
  avatarUrls?: Record<string, string>;
  key?: string;
  name?: string;
  timeZone?: string;
}

// ── Issues ───────────────────────────────────────────────────────────────────

export interface JiraChangeItem {
  field?: string;
  fieldtype?: string;
  fromString?: string;
  toString?: string;
}

export interface JiraChangelogEntry {
  id?: string;
  created?: string;
  author?: JiraUser;
  items: JiraChangeItem[];
}

export interface JiraChangelog {
  histories: JiraChangelogEntry[];
}

export interface JiraStatusCategory {
  id?: number;
  key?: string;
  name?: string;
  colorName?: string;
}

export interface JiraStatus {
  self: string;
  id?: string;
  name?: string;
  description?: string;
  statusCategory?: JiraStatusCategory;
}

export interface JiraTransition {
  id: string;
  name?: string;
  to?: JiraStatus;
  fields: Record<string, unknown>;
}

export interface JiraIssue {
  id: string;
  self: string;
  key: string;
  fields: Record<string, unknown>;
  changelog?: JiraChangelog;
  renderedFields?: Record<string, unknown>;
  transitions?: JiraTransition[];
}

export interface CreateIssueRequest {
  fields: Record<string, unknown>;
  update?: Record<string, unknown>;
}

export interface UpdateIssueRequest {
  fields?: Record<string, unknown>;
  update?: Record<string, unknown>;
}

export interface BulkCreateIssueRequest {
  issueUpdates: CreateIssueRequest[];
}

export interface BulkCreateIssueResponse {
  issues: JiraIssue[];
  errors: unknown[];
}

export interface TransitionId {
  id: string;
}

export interface TransitionRequest {
  transition: TransitionId;
  fields?: Record<string, unknown>;
  update?: Record<string, unknown>;
}

export interface JiraSearchRequest {
  jql: string;
  startAt?: number;
  maxResults?: number;
  fields?: string[];
  expand?: string[];
}

export interface JiraSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

// ── Priority ─────────────────────────────────────────────────────────────────

export interface JiraPriority {
  self: string;
  id?: string;
  name?: string;
  description?: string;
  iconUrl?: string;
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface JiraIssueType {
  self: string;
  id?: string;
  name?: string;
  description?: string;
  subtask?: boolean;
  iconUrl?: string;
}

export interface JiraProject {
  self: string;
  id?: string;
  key?: string;
  name?: string;
  description?: string;
  lead?: JiraUser;
  projectTypeKey?: string;
  avatarUrls?: Record<string, string>;
  issueTypes: JiraIssueType[];
  url?: string;
  archived: boolean;
}

export interface CreateProjectRequest {
  key: string;
  name: string;
  projectTypeKey: string;
  leadAccountId?: string;
  description?: string;
  url?: string;
  assigneeType?: string;
}

// ── Comments ─────────────────────────────────────────────────────────────────

export interface CommentVisibility {
  type: string;
  value: string;
}

export interface JiraComment {
  self: string;
  id?: string;
  author?: JiraUser;
  updateAuthor?: JiraUser;
  body?: unknown;
  created?: string;
  updated?: string;
  jsdPublic?: boolean;
}

export interface AddCommentRequest {
  body: unknown;
  visibility?: CommentVisibility;
}

export interface CommentsResponse {
  startAt: number;
  maxResults: number;
  total: number;
  comments: JiraComment[];
}

// ── Attachments ──────────────────────────────────────────────────────────────

export interface JiraAttachment {
  self: string;
  id?: string;
  filename?: string;
  author?: JiraUser;
  created?: string;
  size?: number;
  mimeType?: string;
  content?: string;
  thumbnail?: string;
}

// ── Worklogs ─────────────────────────────────────────────────────────────────

export interface JiraWorklog {
  self: string;
  id?: string;
  author?: JiraUser;
  updateAuthor?: JiraUser;
  comment?: unknown;
  started?: string;
  timeSpent?: string;
  timeSpentSeconds?: number;
  created?: string;
  updated?: string;
}

export interface AddWorklogRequest {
  timeSpentSeconds?: number;
  timeSpent?: string;
  comment?: unknown;
  started?: string;
}

export interface WorklogsResponse {
  startAt: number;
  maxResults: number;
  total: number;
  worklogs: JiraWorklog[];
}

// ── Boards (Agile) ──────────────────────────────────────────────────────────

export interface BoardLocation {
  projectId?: number;
  displayName?: string;
  projectName?: string;
  projectKey?: string;
}

export interface JiraBoard {
  id: number;
  self: string;
  name?: string;
  type?: string;
  location?: BoardLocation;
}

export interface BoardsResponse {
  maxResults: number;
  startAt: number;
  total?: number;
  isLast: boolean;
  values: JiraBoard[];
}

// ── Sprints (Agile) ─────────────────────────────────────────────────────────

export interface JiraSprint {
  id: number;
  self: string;
  name?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId?: number;
  goal?: string;
}

export interface SprintsResponse {
  maxResults: number;
  startAt: number;
  isLast: boolean;
  values: JiraSprint[];
}

export interface CreateSprintRequest {
  name: string;
  originBoardId: number;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

export interface UpdateSprintRequest {
  name?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

export interface MoveIssuesToSprintRequest {
  issues: string[];
}

// ── Fields ───────────────────────────────────────────────────────────────────

export interface JiraFieldSchema {
  type?: string;
  system?: string;
  custom?: string;
  customId?: number;
}

export interface JiraField {
  id?: string;
  name?: string;
  custom?: boolean;
  orderable?: boolean;
  navigable?: boolean;
  searchable?: boolean;
  clauseNames: string[];
  schema?: JiraFieldSchema;
}

// ── Dashboards ───────────────────────────────────────────────────────────────

export interface JiraDashboard {
  id?: string;
  self: string;
  name?: string;
  owner?: JiraUser;
  isFavourite?: boolean;
  popularity?: number;
  view?: string;
}

export interface DashboardsResponse {
  startAt: number;
  maxResults: number;
  total: number;
  dashboards: JiraDashboard[];
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface JiraFilter {
  self: string;
  id?: string;
  name?: string;
  description?: string;
  jql?: string;
  owner?: JiraUser;
  viewUrl?: string;
  searchUrl?: string;
  favourite?: boolean;
}

export interface CreateFilterRequest {
  name: string;
  jql: string;
  description?: string;
  favourite?: boolean;
}

export interface UpdateFilterRequest {
  name?: string;
  jql?: string;
  description?: string;
  favourite?: boolean;
}
