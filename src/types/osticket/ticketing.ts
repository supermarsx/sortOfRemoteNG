// osTicket integration — `ticketing` category domain types (t42 §4b category c1,
// exec t42-osticket-c1). The Agent-Panel operational surface: ticket lifecycle +
// the requester/end-user directory.
//
// Mirror of the ticket/thread/user structs in
// `src-tauri/crates/sorng-osticket/src/types.rs`. This crate carries NO
// `#[serde(rename_all)]`, so every field below is the raw Rust snake_case name
// (`status_id`, `dept_id`, `thread_type`, `due_date`, `org_id`, …). The
// `request` objects passed to the create/update/search commands MUST use these
// snake_case keys verbatim; only the top-level command ARGUMENT names
// (`id`, `ticketId`, `userId`, `request`, …) follow Tauri's camelCase
// conversion. See `.orchestration/logs/t42-osticket-categories.md`.
//
// Re-exported from `./index` by the per-crate integrator (do not edit the barrel
// from here).

// ── Tickets ──────────────────────────────────────────────────────────────────

/** A single attachment on a ticket, thread entry, or canned response. */
export interface TicketAttachment {
  id?: number | null;
  name?: string | null;
  size?: number | null;
  content_type?: string | null;
  url?: string | null;
}

/** One thread entry (message / reply / internal note) on a ticket. */
export interface TicketThread {
  id?: number | null;
  /** e.g. `"message"`, `"response"`, `"note"`. */
  thread_type?: string | null;
  poster?: string | null;
  body?: string | null;
  created?: string | null;
  title?: string | null;
  attachments?: TicketAttachment[];
}

/** A collaborator (CC'd requester) on a ticket. */
export interface TicketCollaborator {
  user_id?: number | null;
  name?: string | null;
  email?: string | null;
}

/** A help-desk ticket. All fields optional — list/summary payloads omit the
 *  deep `threads` / `collaborators` / `attachments` collections. */
export interface OsticketTicket {
  id?: number | null;
  number?: string | null;
  subject?: string | null;
  status?: string | null;
  status_id?: number | null;
  priority?: string | null;
  priority_id?: number | null;
  department?: string | null;
  department_id?: number | null;
  topic?: string | null;
  topic_id?: number | null;
  user?: string | null;
  user_id?: number | null;
  staff?: string | null;
  staff_id?: number | null;
  team?: string | null;
  team_id?: number | null;
  sla?: string | null;
  sla_id?: number | null;
  due_date?: string | null;
  close_date?: string | null;
  created?: string | null;
  updated?: string | null;
  source?: string | null;
  ip_address?: string | null;
  is_overdue?: boolean;
  is_answered?: boolean;
  threads?: TicketThread[];
  collaborators?: TicketCollaborator[];
  attachments?: TicketAttachment[];
}

/** A base64-encoded attachment supplied when creating a ticket or thread entry. */
export interface CreateAttachment {
  filename: string;
  /** Base64-encoded content. */
  data: string;
  content_type?: string | null;
}

/** Body of `osticket_create_ticket` (`request` arg). */
export interface CreateTicketRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
  phone?: string | null;
  topic_id?: number | null;
  dept_id?: number | null;
  priority_id?: number | null;
  sla_id?: number | null;
  due_date?: string | null;
  source?: string | null;
  ip?: string | null;
  auto_respond?: boolean | null;
  alert?: boolean | null;
  internal_note?: string | null;
  attachments?: CreateAttachment[];
}

/** Body of `osticket_update_ticket` (`request` arg). All fields optional — only
 *  supplied fields are changed. */
export interface UpdateTicketRequest {
  status_id?: number | null;
  priority_id?: number | null;
  dept_id?: number | null;
  topic_id?: number | null;
  sla_id?: number | null;
  staff_id?: number | null;
  team_id?: number | null;
  due_date?: string | null;
  subject?: string | null;
}

/** Body of `osticket_post_ticket_reply` / `osticket_post_ticket_note`
 *  (`request` arg). A reply is agent-visible to the requester; a note is
 *  internal. `thread_type`/`poster` are optional overrides. */
export interface PostThreadRequest {
  body: string;
  thread_type?: string | null;
  poster?: string | null;
  title?: string | null;
  attachments?: CreateAttachment[];
}

/** Body of `osticket_search_tickets` (`request` arg). All filters optional. */
export interface TicketSearchRequest {
  status?: string | null;
  dept_id?: number | null;
  topic_id?: number | null;
  staff_id?: number | null;
  team_id?: number | null;
  user_id?: number | null;
  query?: string | null;
  is_overdue?: boolean | null;
  page?: number | null;
  limit?: number | null;
  sort_by?: string | null;
  sort_order?: string | null;
}

/** Result of `osticket_list_tickets` / `osticket_search_tickets`. */
export interface TicketSearchResponse {
  tickets?: OsticketTicket[];
  total?: number | null;
  page?: number | null;
  pages?: number | null;
}

// ── Users (requesters / end users) ───────────────────────────────────────────

/** A requester / end user in the osTicket user directory. */
export interface OsticketUser {
  id?: number | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  status?: string | null;
  created?: string | null;
  updated?: string | null;
  org_id?: number | null;
  default_email_id?: number | null;
  emails?: string[];
}

/** Body of `osticket_create_user` (`request` arg). */
export interface CreateUserRequest {
  name: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
  org_id?: number | null;
  password?: string | null;
}

/** Body of `osticket_update_user` (`request` arg). All fields optional. */
export interface UpdateUserRequest {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  org_id?: number | null;
}
