/**
 * These native Google clients choose their own service endpoints. Keep this
 * allowlist exact: Google Domains DDNS and generic protocols still need the
 * user-supplied destination. Hosted website profiles have a separate policy.
 * Connection retains hostname/port for compatibility; an absent native-service
 * port is represented by 0, and existing stored addresses are left untouched.
 */
export const isEndpointFreeGoogleService = (protocol: unknown): boolean =>
  protocol === "gcp" || protocol === "integration:gdrive";
