// useOsticketTicketing — `ticketing` category slice for the osTicket integration
// (t42 §4b category c1, exec t42-osticket-c1).
//
// `osticketTicketingApi` pairs 1:1 with the 24 ticketing commands in
// `src-tauri/crates/sorng-osticket/src/commands.rs` (17 Tickets + 7 Users).
// Command ARGUMENT names are camelCase per Tauri's default param conversion
// (`ticketId`, `userId`, `staffId`, `deptId`, `mergeIds`, …); request-bearing
// commands pass their struct as `request`. The `request` STRUCT fields
// themselves stay snake_case — this crate has no serde rename (see
// `src/types/osticket/ticketing.ts`).
//
// Category tabs never open their own connection: the live `connectionId` comes
// from the shell via props and is threaded through as the `id` arg on every call.

import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  CreateTicketRequest,
  CreateUserRequest,
  OsticketTicket,
  OsticketUser,
  PostThreadRequest,
  TicketCollaborator,
  TicketSearchRequest,
  TicketSearchResponse,
  TicketThread,
  UpdateTicketRequest,
  UpdateUserRequest,
} from "../../../types/osticket/ticketing";

// ─── Low-level invoke wrappers (all 24 ticketing commands) ────────────────────

export const osticketTicketingApi = {
  // Tickets (17)
  listTickets: (id: string, page?: number, limit?: number) =>
    invoke<TicketSearchResponse>("osticket_list_tickets", { id, page, limit }),
  searchTickets: (id: string, request: TicketSearchRequest) =>
    invoke<TicketSearchResponse>("osticket_search_tickets", { id, request }),
  getTicket: (id: string, ticketId: number) =>
    invoke<OsticketTicket>("osticket_get_ticket", { id, ticketId }),
  createTicket: (id: string, request: CreateTicketRequest) =>
    invoke<OsticketTicket>("osticket_create_ticket", { id, request }),
  updateTicket: (id: string, ticketId: number, request: UpdateTicketRequest) =>
    invoke<OsticketTicket>("osticket_update_ticket", { id, ticketId, request }),
  deleteTicket: (id: string, ticketId: number) =>
    invoke<void>("osticket_delete_ticket", { id, ticketId }),
  closeTicket: (id: string, ticketId: number) =>
    invoke<OsticketTicket>("osticket_close_ticket", { id, ticketId }),
  reopenTicket: (id: string, ticketId: number) =>
    invoke<OsticketTicket>("osticket_reopen_ticket", { id, ticketId }),
  assignTicket: (
    id: string,
    ticketId: number,
    staffId?: number,
    teamId?: number,
  ) =>
    invoke<OsticketTicket>("osticket_assign_ticket", {
      id,
      ticketId,
      staffId,
      teamId,
    }),
  postTicketReply: (id: string, ticketId: number, request: PostThreadRequest) =>
    invoke<TicketThread>("osticket_post_ticket_reply", {
      id,
      ticketId,
      request,
    }),
  postTicketNote: (id: string, ticketId: number, request: PostThreadRequest) =>
    invoke<TicketThread>("osticket_post_ticket_note", { id, ticketId, request }),
  getTicketThreads: (id: string, ticketId: number) =>
    invoke<TicketThread[]>("osticket_get_ticket_threads", { id, ticketId }),
  addTicketCollaborator: (
    id: string,
    ticketId: number,
    userId: number,
    email?: string,
  ) =>
    invoke<TicketCollaborator>("osticket_add_ticket_collaborator", {
      id,
      ticketId,
      userId,
      email,
    }),
  getTicketCollaborators: (id: string, ticketId: number) =>
    invoke<TicketCollaborator[]>("osticket_get_ticket_collaborators", {
      id,
      ticketId,
    }),
  removeTicketCollaborator: (id: string, ticketId: number, userId: number) =>
    invoke<void>("osticket_remove_ticket_collaborator", {
      id,
      ticketId,
      userId,
    }),
  transferTicket: (id: string, ticketId: number, deptId: number) =>
    invoke<OsticketTicket>("osticket_transfer_ticket", { id, ticketId, deptId }),
  mergeTickets: (id: string, ticketId: number, mergeIds: number[]) =>
    invoke<OsticketTicket>("osticket_merge_tickets", {
      id,
      ticketId,
      mergeIds,
    }),

  // Users (7)
  listUsers: (id: string, page?: number, limit?: number) =>
    invoke<OsticketUser[]>("osticket_list_users", { id, page, limit }),
  getUser: (id: string, userId: number) =>
    invoke<OsticketUser>("osticket_get_user", { id, userId }),
  searchUsers: (id: string, email?: string, name?: string) =>
    invoke<OsticketUser[]>("osticket_search_users", { id, email, name }),
  createUser: (id: string, request: CreateUserRequest) =>
    invoke<OsticketUser>("osticket_create_user", { id, request }),
  updateUser: (id: string, userId: number, request: UpdateUserRequest) =>
    invoke<OsticketUser>("osticket_update_user", { id, userId, request }),
  deleteUser: (id: string, userId: number) =>
    invoke<void>("osticket_delete_user", { id, userId }),
  getUserTickets: (id: string, userId: number) =>
    invoke<OsticketTicket[]>("osticket_get_user_tickets", { id, userId }),
};

export type OsticketTicketingApi = typeof osticketTicketingApi;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseOsticketTicketing {
  /** The raw invoke wrappers (all 24 ticketing commands). */
  api: OsticketTicketingApi;
  /** Rows for the currently loaded list section (tickets or users). */
  items: unknown[];
  /** Total from the last ticket list/search, when the backend reports it. */
  total: number | null;
  loading: boolean;
  /** True while a create/update/delete/action command is in flight. */
  busy: boolean;
  error: string | null;
  /** Run a list loader and store its rows. Accepts either a bare array (users,
   *  user-tickets) or a `TicketSearchResponse` (`{ tickets, total }`). */
  loadList: (
    loader: () => Promise<TicketSearchResponse | unknown[]>,
  ) => Promise<void>;
  /** Run a mutation/detail action, surfacing loading + errors. Returns the
   *  result on success, or `null` on failure (error is set). */
  run: <T>(action: () => Promise<T>) => Promise<T | null>;
  clearItems: () => void;
  clearError: () => void;
}

function toMessage(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * State machine for the Ticketing tab: one active list (rows + total + loading)
 * plus a shared busy/error channel for detail fetches and mutations. It stays
 * resource-agnostic so the tab can point `loadList` at tickets or users and
 * `run` at any of the lifecycle/collaborator/user commands.
 */
export function useOsticketTicketing(): UseOsticketTicketing {
  const [items, setItems] = useState<unknown[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow earlier list load overwriting a newer one.
  const loadSeq = useRef(0);

  const loadList = useCallback(
    async (
      loader: () => Promise<TicketSearchResponse | unknown[]>,
    ): Promise<void> => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await loader();
        if (seq !== loadSeq.current) return;
        if (Array.isArray(res)) {
          setItems(res);
          setTotal(res.length);
        } else {
          const tickets = res.tickets ?? [];
          setItems(tickets);
          setTotal(res.total ?? tickets.length);
        }
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setError(toMessage(e));
        setItems([]);
        setTotal(null);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [],
  );

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await action();
      } catch (e) {
        setError(toMessage(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const clearItems = useCallback(() => {
    setItems([]);
    setTotal(null);
  }, []);
  const clearError = useCallback(() => setError(null), []);

  return {
    api: osticketTicketingApi,
    items,
    total,
    loading,
    busy,
    error,
    loadList,
    run,
    clearItems,
    clearError,
  };
}
