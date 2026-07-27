import type { IntegrationProviderFields } from "../../types/connection/connection";

/**
 * Provider metadata is extensible, but these names are credential-shaped and
 * must only travel through the encrypted vault. Matching is case-insensitive
 * and ignores separators (`client_secret`, `ClientSecret`, and
 * `client-secret` are equivalent).
 */
const SECRET_PROVIDER_FIELD_NAMES = new Set([
  "password",
  "passphrase",
  "secret",
  "clientsecret",
  "apikey",
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "bearertoken",
  "token",
  "privatekey",
  "sshpassword",
  "sshprivatekey",
]);

const normalizeProviderFieldName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

export const isSecretProviderField = (name: string): boolean =>
  SECRET_PROVIDER_FIELD_NAMES.has(normalizeProviderFieldName(name));

/** Remove secret-shaped entries before any ordinary integration persistence. */
export const sanitizeIntegrationProviderFields = (
  fields: IntegrationProviderFields | undefined,
): IntegrationProviderFields =>
  Object.fromEntries(
    Object.entries(fields ?? {}).filter(([key]) => !isSecretProviderField(key)),
  ) as IntegrationProviderFields;

/** Equivalent sanitizer for the string-only instance config blob. */
export const sanitizeIntegrationStringFields = (
  fields: Record<string, string> | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(fields ?? {}).filter(([key]) => !isSecretProviderField(key)),
  );
