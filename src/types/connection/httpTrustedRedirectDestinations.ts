/** Per-saved-connection reviewed destinations, not TLS or login grants. */
export interface HttpTrustedRedirectDestinations {
  version: 1;
  origins: string[];
  /** @deprecated Accepted legacy input only; ignored. Trust itself permits repeat handoffs. */
  autoContinue?: boolean;
}
