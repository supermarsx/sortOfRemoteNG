/** Per-saved-connection reviewed destinations, not TLS or login grants. */
export interface HttpTrustedRedirectDestinations {
  version: 1;
  origins: string[];
  /** Missing is false. Anonymous HTTPS handoffs only, with normal TLS checks. */
  autoContinue?: boolean;
}
