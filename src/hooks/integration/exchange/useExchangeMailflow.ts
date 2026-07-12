// useExchangeMailflow — "Transport & Mail Flow" slice for the Exchange integration
// (t42-exchange-c2).
//
// Pairs 1:1 with the 33 mail-flow commands in
// `src-tauri/crates/sorng-exchange/src/commands.rs`:
//   Transport rules 7 · Connectors 6 · Message trace & queues 8 ·
//   Address policies & lists 5 · Remote domains 5 · Transport config 2
//
// ⚠️ Exchange is a SINGLETON service: `exchange_*` commands take NO connection id —
// they operate on the one active connection. Each invoke carries only its own
// command-specific args (camelCase 1:1 with the Rust `#[tauri::command]` params).
// Category tabs receive the connection `summary` via props and never re-connect.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AcceptedDomain,
  AddressList,
  Connector,
  CreateRemoteDomainRequest,
  CreateTransportRuleRequest,
  EmailAddressPolicy,
  MailQueue,
  MessageTraceRequest,
  MessageTraceResult,
  RemoteDomain,
  TransportConfig,
  TransportRule,
} from "../../../types/exchange/mailflow";

/** Arbitrary property bag for the `params: serde_json::Value` update commands. */
export type ExchangeParams = Record<string, unknown>;

// ─── Low-level invoke wrappers (all 33 commands) ──────────────────────────────

export const exchangeMailflowApi = {
  // Transport rules (7)
  listTransportRules: () =>
    invoke<TransportRule[]>("exchange_list_transport_rules"),
  getTransportRule: (identity: string) =>
    invoke<TransportRule>("exchange_get_transport_rule", { identity }),
  createTransportRule: (request: CreateTransportRuleRequest) =>
    invoke<TransportRule>("exchange_create_transport_rule", { request }),
  updateTransportRule: (identity: string, params: ExchangeParams) =>
    invoke<string>("exchange_update_transport_rule", { identity, params }),
  removeTransportRule: (identity: string) =>
    invoke<string>("exchange_remove_transport_rule", { identity }),
  enableTransportRule: (identity: string) =>
    invoke<string>("exchange_enable_transport_rule", { identity }),
  disableTransportRule: (identity: string) =>
    invoke<string>("exchange_disable_transport_rule", { identity }),

  // Connectors (6)
  listSendConnectors: () =>
    invoke<Connector[]>("exchange_list_send_connectors"),
  getSendConnector: (identity: string) =>
    invoke<Connector>("exchange_get_send_connector", { identity }),
  listReceiveConnectors: (server?: string | null) =>
    invoke<Connector[]>("exchange_list_receive_connectors", { server }),
  getReceiveConnector: (identity: string) =>
    invoke<Connector>("exchange_get_receive_connector", { identity }),
  listInboundConnectors: () =>
    invoke<Connector[]>("exchange_list_inbound_connectors"),
  listOutboundConnectors: () =>
    invoke<Connector[]>("exchange_list_outbound_connectors"),

  // Message trace & queues (8)
  messageTrace: (request: MessageTraceRequest) =>
    invoke<MessageTraceResult[]>("exchange_message_trace", { request }),
  messageTrackingLog: (args: {
    sender?: string | null;
    recipient?: string | null;
    start?: string | null;
    end?: string | null;
    server?: string | null;
    resultSize?: number | null;
  }) =>
    invoke<MessageTraceResult[]>("exchange_message_tracking_log", {
      sender: args.sender ?? null,
      recipient: args.recipient ?? null,
      start: args.start ?? null,
      end: args.end ?? null,
      server: args.server ?? null,
      resultSize: args.resultSize ?? null,
    }),
  listQueues: (server?: string | null) =>
    invoke<MailQueue[]>("exchange_list_queues", { server }),
  getQueue: (identity: string) =>
    invoke<MailQueue>("exchange_get_queue", { identity }),
  retryQueue: (identity: string) =>
    invoke<string>("exchange_retry_queue", { identity }),
  suspendQueue: (identity: string) =>
    invoke<string>("exchange_suspend_queue", { identity }),
  resumeQueue: (identity: string) =>
    invoke<string>("exchange_resume_queue", { identity }),
  queueSummary: () => invoke<MailQueue[]>("exchange_queue_summary"),

  // Address policies & lists (5)
  listAddressPolicies: () =>
    invoke<EmailAddressPolicy[]>("exchange_list_address_policies"),
  getAddressPolicy: (identity: string) =>
    invoke<EmailAddressPolicy>("exchange_get_address_policy", { identity }),
  applyAddressPolicy: (identity: string) =>
    invoke<string>("exchange_apply_address_policy", { identity }),
  listAcceptedDomains: () =>
    invoke<AcceptedDomain[]>("exchange_list_accepted_domains"),
  listAddressLists: () => invoke<AddressList[]>("exchange_list_address_lists"),

  // Remote domains (5)
  listRemoteDomains: () =>
    invoke<RemoteDomain[]>("exchange_list_remote_domains"),
  getRemoteDomain: (identity: string) =>
    invoke<RemoteDomain>("exchange_get_remote_domain", { identity }),
  createRemoteDomain: (request: CreateRemoteDomainRequest) =>
    invoke<RemoteDomain>("exchange_create_remote_domain", { request }),
  updateRemoteDomain: (identity: string, params: ExchangeParams) =>
    invoke<string>("exchange_update_remote_domain", { identity, params }),
  removeRemoteDomain: (identity: string) =>
    invoke<string>("exchange_remove_remote_domain", { identity }),

  // Transport config (2)
  getTransportConfig: () =>
    invoke<TransportConfig>("exchange_get_transport_config"),
  setTransportConfig: (params: ExchangeParams) =>
    invoke<string>("exchange_set_transport_config", { params }),
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** The mail-flow sub-domain a view can show. */
export type ExchangeMailflowView =
  | "transportRules"
  | "connectors"
  | "messageFlow"
  | "addressing"
  | "remoteDomains"
  | "transportConfig";

/** Which connector direction the Connectors view is showing. */
export type ConnectorScope = "send" | "receive" | "inbound" | "outbound";

export interface UseExchangeMailflow {
  transportRules: TransportRule[];
  connectors: Connector[];
  queues: MailQueue[];
  traceResults: MessageTraceResult[];
  addressPolicies: EmailAddressPolicy[];
  acceptedDomains: AcceptedDomain[];
  addressLists: AddressList[];
  remoteDomains: RemoteDomain[];
  transportConfig: TransportConfig | null;
  loading: boolean;
  error: string | null;

  loadTransportRules: () => Promise<void>;
  /** Load connectors for a direction; `receive` accepts an optional server filter. */
  loadConnectors: (scope: ConnectorScope, server?: string | null) => Promise<void>;
  runMessageTrace: (request: MessageTraceRequest) => Promise<void>;
  runTrackingLog: (args: {
    sender?: string | null;
    recipient?: string | null;
    start?: string | null;
    end?: string | null;
    server?: string | null;
    resultSize?: number | null;
  }) => Promise<void>;
  loadQueues: (server?: string | null) => Promise<void>;
  loadQueueSummary: () => Promise<void>;
  loadAddressing: () => Promise<void>;
  loadRemoteDomains: () => Promise<void>;
  loadTransportConfig: () => Promise<void>;

  clearError: () => void;
  api: typeof exchangeMailflowApi;
}

const toMessage = (e: unknown): string =>
  typeof e === "string" ? e : ((e as Error)?.message ?? String(e));

/**
 * Read/refresh state for the Transport & Mail Flow tab. Loaders fetch a single
 * group's data; mutations (create/update/enable/disable/remove, queue retry/
 * suspend/resume, apply policy, set config) are exposed on the returned `api` so
 * views can call them and then reload the affected group.
 */
export function useExchangeMailflow(): UseExchangeMailflow {
  const [transportRules, setTransportRules] = useState<TransportRule[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [queues, setQueues] = useState<MailQueue[]>([]);
  const [traceResults, setTraceResults] = useState<MessageTraceResult[]>([]);
  const [addressPolicies, setAddressPolicies] = useState<EmailAddressPolicy[]>(
    [],
  );
  const [acceptedDomains, setAcceptedDomains] = useState<AcceptedDomain[]>([]);
  const [addressLists, setAddressLists] = useState<AddressList[]>([]);
  const [remoteDomains, setRemoteDomains] = useState<RemoteDomain[]>([]);
  const [transportConfig, setTransportConfig] = useState<TransportConfig | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Run `fn` with shared loading/error handling. */
  const guard = useCallback(async (fn: () => Promise<void>): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTransportRules = useCallback(
    () =>
      guard(async () => {
        setTransportRules(await exchangeMailflowApi.listTransportRules());
      }),
    [guard],
  );

  const loadConnectors = useCallback(
    (scope: ConnectorScope, server?: string | null) =>
      guard(async () => {
        switch (scope) {
          case "send":
            setConnectors(await exchangeMailflowApi.listSendConnectors());
            break;
          case "receive":
            setConnectors(
              await exchangeMailflowApi.listReceiveConnectors(server ?? null),
            );
            break;
          case "inbound":
            setConnectors(await exchangeMailflowApi.listInboundConnectors());
            break;
          case "outbound":
            setConnectors(await exchangeMailflowApi.listOutboundConnectors());
            break;
        }
      }),
    [guard],
  );

  const runMessageTrace = useCallback(
    (request: MessageTraceRequest) =>
      guard(async () => {
        setTraceResults(await exchangeMailflowApi.messageTrace(request));
      }),
    [guard],
  );

  const runTrackingLog = useCallback(
    (args: {
      sender?: string | null;
      recipient?: string | null;
      start?: string | null;
      end?: string | null;
      server?: string | null;
      resultSize?: number | null;
    }) =>
      guard(async () => {
        setTraceResults(await exchangeMailflowApi.messageTrackingLog(args));
      }),
    [guard],
  );

  const loadQueues = useCallback(
    (server?: string | null) =>
      guard(async () => {
        setQueues(await exchangeMailflowApi.listQueues(server ?? null));
      }),
    [guard],
  );

  const loadQueueSummary = useCallback(
    () =>
      guard(async () => {
        setQueues(await exchangeMailflowApi.queueSummary());
      }),
    [guard],
  );

  const loadAddressing = useCallback(
    () =>
      guard(async () => {
        const [policies, domains, lists] = await Promise.all([
          exchangeMailflowApi.listAddressPolicies(),
          exchangeMailflowApi.listAcceptedDomains(),
          exchangeMailflowApi.listAddressLists(),
        ]);
        setAddressPolicies(policies);
        setAcceptedDomains(domains);
        setAddressLists(lists);
      }),
    [guard],
  );

  const loadRemoteDomains = useCallback(
    () =>
      guard(async () => {
        setRemoteDomains(await exchangeMailflowApi.listRemoteDomains());
      }),
    [guard],
  );

  const loadTransportConfig = useCallback(
    () =>
      guard(async () => {
        setTransportConfig(await exchangeMailflowApi.getTransportConfig());
      }),
    [guard],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    transportRules,
    connectors,
    queues,
    traceResults,
    addressPolicies,
    acceptedDomains,
    addressLists,
    remoteDomains,
    transportConfig,
    loading,
    error,
    loadTransportRules,
    loadConnectors,
    runMessageTrace,
    runTrackingLog,
    loadQueues,
    loadQueueSummary,
    loadAddressing,
    loadRemoteDomains,
    loadTransportConfig,
    clearError,
    api: exchangeMailflowApi,
  };
}
