import type { DatabaseCredentialMetadata } from "../../types/security/databaseCredentialVault";
import type { ConnectionCredentialInventoryRow } from "./connectionCredentialInventory";

export const CREDENTIAL_CATEGORIES = [
  "SMTP",
  "Active Directory",
  "User/password",
  "Digest",
  "Private key",
  "Remote access key",
  "VPN",
  "Other",
] as const;

/** Classification uses fixed metadata/presence only; it never inspects a secret. */
export function connectionCredentialCategories(
  row: Pick<ConnectionCredentialInventoryRow, "protocol" | "kinds">,
  authType?: string,
): string[] {
  const categories = new Set<string>();
  if (/^smtps?$/i.test(row.protocol)) categories.add("SMTP");
  if (/^(ldap|ldaps|active-directory)$/i.test(row.protocol))
    categories.add("Active Directory");
  if (row.kinds.includes("password") || row.kinds.includes("account"))
    categories.add("User/password");
  if (authType === "digest") categories.add("Digest");
  if (row.kinds.includes("privateKey") || row.kinds.includes("clientKey"))
    categories.add("Private key");
  if (/^(rustdesk|anydesk)$/i.test(row.protocol))
    categories.add("Remote access key");
  if (
    row.kinds.includes("vpn") ||
    /^(openvpn|wireguard|vpn|tailscale|zerotier)$/i.test(row.protocol)
  )
    categories.add("VPN");
  return categories.size ? [...categories] : ["Other"];
}

export function vaultCredentialCategories(
  row: Pick<DatabaseCredentialMetadata, "tags">,
): string[] {
  // Tags are choices made by the user, never inferred from secret facets,
  // connection protocols, authentication methods or saved assignments.
  return [...(row.tags ?? [])];
}
