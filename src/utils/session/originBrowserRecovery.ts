import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type { BrowserRecoveryAction } from "../../hooks/protocol/originBrowserFailureDetails";
import type {
  ConnectionEditorTabId,
  ConnectionEditorProtocolSubtabId,
} from "../../components/connection/editor/editorRegistry";

export const ORIGIN_BROWSER_RECOVERY_EVENT = "origin-browser-recovery";

export type BrowserRecoveryDestination =
  | Exclude<BrowserRecoveryAction, "permissions" | "browser-settings">
  | "quick-connect";

export interface OriginBrowserRecoveryRequest {
  action: BrowserRecoveryDestination;
  sessionId: string;
  connectionId: string;
  ownerDatabaseId?: string;
}

export interface ConnectionEditorRecoveryNavigation {
  requestId: string;
  connectionId: string;
  ownerDatabaseId: string;
  tab: ConnectionEditorTabId;
  subtab?: ConnectionEditorProtocolSubtabId;
}

export type BrowserRecoveryEditorSession = ConnectionSession & {
  browserRecoveryNavigation?: ConnectionEditorRecoveryNavigation;
};

// Only synchronous requests minted by the live renderer may open a tool.
// The lease is not event data or persisted session metadata.
const requests = new WeakMap<Event, () => void>();

export function requestOriginBrowserRecovery(
  request: OriginBrowserRecoveryRequest,
  assertCurrent: () => void,
): boolean {
  assertCurrent();
  const event = new CustomEvent(ORIGIN_BROWSER_RECOVERY_EVENT, {
    detail: Object.freeze({ ...request }),
    cancelable: true,
  });
  requests.set(event, assertCurrent);
  try {
    return !window.dispatchEvent(event);
  } finally {
    requests.delete(event);
  }
}

export function readOriginBrowserRecovery(event: Event) {
  const assertCurrent = requests.get(event);
  if (!assertCurrent || !(event instanceof CustomEvent)) return null;
  assertCurrent();
  return {
    request: event.detail as OriginBrowserRecoveryRequest,
    assertCurrent,
  };
}

export function browserRecoveryEditorTarget(
  action: BrowserRecoveryDestination,
  connection: Connection,
): Pick<ConnectionEditorRecoveryNavigation, "tab" | "subtab"> | null {
  switch (action) {
    case "connection":
      return { tab: "general" };
    case "application":
      return { tab: "protocol", subtab: "application" };
    case "credentials":
      return connection.credentialSource?.kind === "vault"
        ? { tab: "general" }
        : {
            tab: "protocol",
            subtab: connection.httpApplication
              ? "application"
              : "authentication",
          };
    case "network":
      return { tab: "protocol", subtab: "network-path" };
    case "browser-session":
    case "legacy-proxy":
      return { tab: "protocol", subtab: "advanced" };
    case "trust":
      return { tab: "protocol", subtab: "security" };
    default:
      return null;
  }
}
