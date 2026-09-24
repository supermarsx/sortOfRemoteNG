import type { Connection } from "../../types/connection/connection";
import type {
  DatabaseCredentialFacets,
  DatabaseCredentialMetadata,
} from "../../types/security/databaseCredentialVault";

export const LOCAL_CREDENTIAL_FACETS = [
  "username",
  "password",
  "domain",
  "privateKey",
  "passphrase",
  "totp",
] as const;

/** The database vault cannot represent recovery codes or separate HTTP accounts. */
export function localCredentialFacets(
  connection: Partial<Connection>,
): DatabaseCredentialFacets {
  if (connection.totpConfigs?.some((config) => config.backupCodes?.length))
    throw new Error(
      "Keep recovery codes in the connection until they have been moved securely.",
    );
  const facets: DatabaseCredentialFacets = {};
  for (const field of LOCAL_CREDENTIAL_FACETS) {
    if (field === "totp") continue;
    const value = connection[field];
    if (
      value !== undefined &&
      (value !== "" || field === "password" || field === "passphrase")
    )
      facets[field] = value;
  }
  for (const [local, field] of [
    ["basicAuthUsername", "username"],
    ["basicAuthPassword", "password"],
  ] as const) {
    const value = connection[local];
    if (!value) continue;
    if (facets[field] && facets[field] !== value)
      throw new Error(
        "Separate HTTP and connection accounts must be converted individually.",
      );
    facets[field] = value;
  }
  const configs = connection.totpConfigs ?? [];
  const totp = configs.map((config) => ({
    id: crypto.randomUUID(),
    label:
      [config.issuer, config.account].filter(Boolean).join(" · ") ||
      "Authenticator",
    secret: config.secret.replace(/\s/g, "").toUpperCase(),
    digits: config.digits as 6 | 8,
    period: config.period,
    algorithm: config.algorithm,
  }));
  if (
    connection.totpSecret &&
    !totp.some(
      (item) =>
        item.secret === connection.totpSecret?.replace(/\s/g, "").toUpperCase(),
    )
  )
    totp.unshift({
      id: crypto.randomUUID(),
      label: "Connection authenticator",
      secret: connection.totpSecret.replace(/\s/g, "").toUpperCase(),
      digits: 6,
      period: 30,
      algorithm: "sha1",
    });
  if (totp.length) facets.totp = totp;
  if (!Object.values(facets).some((value) => value !== ""))
    throw new Error("No local credentials to convert.");
  return facets;
}

export function convertibleVaultFacets(
  row: DatabaseCredentialMetadata,
  connection: Partial<Connection>,
) {
  const needed: (typeof LOCAL_CREDENTIAL_FACETS)[number][] = ["username"];
  if (connection.protocol === "ssh" && connection.authType === "key")
    needed.push("privateKey", "passphrase", "password");
  else needed.push("password");
  if (connection.protocol === "rdp") needed.push("domain");
  if (
    connection.credentialSource?.kind === "vault" &&
    connection.credentialSource.totpId
  )
    needed.push("totp");
  return needed.filter((facet) => row.availableFacets.includes(facet));
}

/** Only ordinary credential fields are changed; proxy/hop secrets stay separate. */
export function clearLocalCredentialFields(): Partial<Connection> {
  return {
    username: "",
    password: "",
    domain: "",
    privateKey: "",
    passphrase: "",
    basicAuthUsername: "",
    basicAuthPassword: "",
    totpSecret: "",
    totpConfigs: [],
  };
}

export function vaultCredentialLocalFields(
  facets: DatabaseCredentialFacets,
  selectedTotpId?: string,
): Partial<Connection> {
  const fields = clearLocalCredentialFields();
  for (const field of LOCAL_CREDENTIAL_FACETS) {
    if (field !== "totp" && facets[field] !== undefined)
      fields[field] = facets[field];
  }
  if (
    selectedTotpId &&
    !facets.totp?.some((entry) => entry.id === selectedTotpId)
  )
    throw new Error("The selected authenticator is unavailable.");
  fields.totpConfigs =
    facets.totp
      ?.filter((entry) => entry.id === selectedTotpId)
      .map((entry) => ({
        id: entry.id,
        issuer: entry.label,
        account: facets.username ?? "",
        secret: entry.secret,
        digits: entry.digits,
        period: entry.period,
        algorithm: entry.algorithm,
      })) ?? [];
  const selected = facets.totp?.find((entry) => entry.id === selectedTotpId);
  // The legacy SSH field supports only the default TOTP parameters.
  if (
    selected &&
    selected.digits === 6 &&
    selected.period === 30 &&
    selected.algorithm === "sha1"
  )
    fields.totpSecret = selected.secret;
  return fields;
}
