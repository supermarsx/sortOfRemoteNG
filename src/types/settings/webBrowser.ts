import type { HttpProxyPolicy } from "../connection/httpProxyPolicy";
import type { WebsiteDomainPermissionsSettings } from "./websiteDomainPermissions";
import type {
  BrowserNativePreferences,
  BrowserSessionRetention,
} from "./browserSession";

export type WebBrowserEngine = "real-origin" | "legacy";

/** Global browser preferences; never grants permission to release credentials. */
export interface WebBrowserSettingsConfig extends BrowserNativePreferences {
  version: 1;
  /** Missing preferences select real-origin; runtime availability remains separately gated. */
  engine?: WebBrowserEngine;
  /** Warm the native engine once while idle after an owning database unlocks. */
  idlePrewarmEnabled?: boolean;
  showBookmarksBar: boolean;
  showSecurityInfo: boolean;
  showLoadingProgress: boolean;
  defaultZoomPercent: number;
  /** Sandbox capabilities for approved proxy documents only. */
  allowDownloads: boolean;
  allowPageDialogs: boolean;
  /** Global native-engine XML transformations. Changes require an app restart. */
  xsltEnabled?: boolean;
  /** Ignore saved User-Agent header overrides so headers match the real runtime. */
  preferNativeUserAgent: boolean;
  /** Ignore saved Accept-Language overrides so requests match runtime languages. */
  preferNativeLanguage: boolean;
  minimumFormFillDelayMs: number;
  minimumFormSubmitDelayMs: number;
  /** Restrict DOM form auto-login to filling; never grants login consent. */
  manualFormSubmit: boolean;
  popupPolicy: "tabs" | "block";
  initialLoadTimeoutSeconds: number;
  documentReadyTimeoutSeconds: number;
  /** Used only when a connection has no explicitly saved proxy policy. */
  defaultPolicy: HttpProxyPolicy;
  /** Native real-origin request policy; legacy iframe routing is unchanged. */
  domainPermissions?: WebsiteDomainPermissionsSettings;
  /** Requested retention only; runtime capabilities determine the effective mode. */
  sessionRetention?: BrowserSessionRetention;
}

/** Applied when creating a native proxy session, including its derived routes. */
export interface InternalProxySettings {
  version: 1;
  connectTimeoutSeconds: number;
  requestTimeoutSeconds: number;
  poolIdleTimeoutSeconds: number;
  maxIdleConnectionsPerHost: number;
  /** Zero disables TCP keepalive, not the application's proxy health checks. */
  tcpKeepaliveSeconds: number;
}
