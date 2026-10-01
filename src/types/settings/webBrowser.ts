import type { HttpProxyPolicy } from "../connection/httpProxyPolicy";

/** Global browser preferences; never grants permission to release credentials. */
export interface WebBrowserSettingsConfig {
  version: 1;
  showBookmarksBar: boolean;
  showSecurityInfo: boolean;
  showLoadingProgress: boolean;
  defaultZoomPercent: number;
  /** Sandbox capabilities for approved proxy documents only. */
  allowDownloads: boolean;
  allowPageDialogs: boolean;
  /** Ignore saved User-Agent header overrides so headers match the real runtime. */
  preferNativeUserAgent: boolean;
  /** Ignore saved Accept-Language overrides so requests match runtime languages. */
  preferNativeLanguage: boolean;
  /** Experimental, page-local WebDriver indicator suppression; not browser invisibility. */
  hideAutomationIndicator: boolean;
  minimumFormFillDelayMs: number;
  minimumFormSubmitDelayMs: number;
  /** Restrict DOM form auto-login to filling; never grants login consent. */
  manualFormSubmit: boolean;
  popupPolicy: "tabs" | "block";
  initialLoadTimeoutSeconds: number;
  documentReadyTimeoutSeconds: number;
  /** Used only when a connection has no explicitly saved proxy policy. */
  defaultPolicy: HttpProxyPolicy;
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
