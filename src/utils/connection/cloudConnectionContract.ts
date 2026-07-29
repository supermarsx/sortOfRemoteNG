import type {
  BuiltInConnectionProtocol,
  Connection,
} from "../../types/connection/connection";

export const CLOUD_CONNECTION_PROTOCOLS = [
  "gcp",
  "azure",
  "digital-ocean",
  "ibm-csp",
  "heroku",
  "scaleway",
  "linode",
  "ovhcloud",
] as const satisfies readonly BuiltInConnectionProtocol[];

export type CloudConnectionProtocol =
  (typeof CLOUD_CONNECTION_PROTOCOLS)[number];

export interface OvhCloudCredentialBundle {
  apiKey: string;
  appSecret: string;
  consumerKey: string;
}

export type OvhCloudCredentialInspection = {
  status: "empty" | "valid" | "incomplete" | "malformed";
  credentials: OvhCloudCredentialBundle;
};

type LegacyCloudProvider = Partial<
  NonNullable<Connection["cloudProvider"]>
> & {
  appSecret?: string;
  applicationSecret?: string;
  consumerKey?: string;
};

const EMPTY_OVH_CREDENTIALS: OvhCloudCredentialBundle = {
  apiKey: "",
  appSecret: "",
  consumerKey: "",
};

const hasSecret = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const preferString = (
  canonical: string | undefined,
  legacy: string | undefined,
): string | undefined =>
  typeof canonical === "string"
    ? canonical
    : typeof legacy === "string"
      ? legacy
      : undefined;

export const isCloudConnectionProtocol = (
  protocol: string | undefined,
): protocol is CloudConnectionProtocol =>
  !!protocol &&
  (CLOUD_CONNECTION_PROTOCOLS as readonly string[]).includes(protocol);

export const inspectOvhCloudCredentialBundle = (
  value: string | undefined,
): OvhCloudCredentialInspection => {
  if (!hasSecret(value)) {
    return {
      status: "empty",
      credentials: { ...EMPTY_OVH_CREDENTIALS },
    };
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        status: "malformed",
        credentials: { ...EMPTY_OVH_CREDENTIALS },
      };
    }

    const candidate = parsed as Record<string, unknown>;
    const credentials: OvhCloudCredentialBundle = {
      apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : "",
      appSecret:
        typeof candidate.appSecret === "string" ? candidate.appSecret : "",
      consumerKey:
        typeof candidate.consumerKey === "string"
          ? candidate.consumerKey
          : "",
    };
    return {
      status: Object.values(credentials).every(hasSecret)
        ? "valid"
        : "incomplete",
      credentials,
    };
  } catch {
    return {
      status: "malformed",
      credentials: { ...EMPTY_OVH_CREDENTIALS },
    };
  }
};

export const serializeOvhCloudCredentialBundle = (
  credentials: OvhCloudCredentialBundle,
): string =>
  JSON.stringify({
    apiKey: credentials.apiKey,
    appSecret: credentials.appSecret,
    consumerKey: credentials.consumerKey,
  });

const clearCloudSpecificFields = <T extends Partial<Connection>>(
  connection: T,
): T =>
  ({
    ...connection,
    cloudProvider: undefined,
    gcpSettings: undefined,
    azureSettings: undefined,
    digitalOceanSettings: undefined,
    ibmCloudSettings: undefined,
    herokuSettings: undefined,
    scalewaySettings: undefined,
    linodeSettings: undefined,
    ovhCloudSettings: undefined,
  }) as T;

/**
 * Resolves old `cloudProvider` records into the one canonical representation
 * consumed by the runtime adapters. Credential material is moved only to
 * `Connection.password`; provider settings remain non-secret.
 */
export const normalizeCloudConnectionForEditor = <
  T extends Partial<Connection>,
>(
  connection: T,
): T => {
  if (!isCloudConnectionProtocol(connection.protocol)) return connection;

  const legacy = connection.cloudProvider as
    | LegacyCloudProvider
    | undefined;
  const canonicalPassword = hasSecret(connection.password)
    ? connection.password
    : undefined;
  const normalized = clearCloudSpecificFields(connection);

  switch (connection.protocol) {
    case "gcp":
      return {
        ...normalized,
        password:
          canonicalPassword ??
          preferString(undefined, legacy?.serviceAccountKey) ??
          "",
        gcpSettings: {
          projectId:
            preferString(
              connection.gcpSettings?.projectId,
              legacy?.projectId,
            ) ?? "",
          region: preferString(
            connection.gcpSettings?.region,
            legacy?.region,
          ),
          zone: preferString(connection.gcpSettings?.zone, legacy?.zone),
          scopes: connection.gcpSettings?.scopes,
          endpointOverride: connection.gcpSettings?.endpointOverride,
        },
      } as T;

    case "azure":
      return {
        ...normalized,
        password:
          canonicalPassword ??
          preferString(undefined, legacy?.clientSecret) ??
          "",
        azureSettings: {
          tenantId:
            preferString(
              connection.azureSettings?.tenantId,
              legacy?.tenantId,
            ) ?? "",
          clientId:
            preferString(
              connection.azureSettings?.clientId,
              legacy?.clientId,
            ) ?? "",
          subscriptionId:
            preferString(
              connection.azureSettings?.subscriptionId,
              legacy?.subscriptionId,
            ) ?? "",
          defaultResourceGroup: preferString(
            connection.azureSettings?.defaultResourceGroup,
            legacy?.resourceGroup ?? legacy?.projectId,
          ),
          defaultRegion: preferString(
            connection.azureSettings?.defaultRegion,
            legacy?.region,
          ),
        },
      } as T;

    case "digital-ocean":
      return {
        ...normalized,
        password:
          canonicalPassword ??
          preferString(undefined, legacy?.apiKey ?? legacy?.accessToken) ??
          "",
        digitalOceanSettings: {
          region: preferString(
            connection.digitalOceanSettings?.region,
            legacy?.region,
          ),
        },
      } as T;

    case "ibm-csp":
      return {
        ...normalized,
        password:
          canonicalPassword ??
          preferString(undefined, legacy?.apiKey ?? legacy?.accessToken) ??
          "",
        ibmCloudSettings: {
          region: preferString(
            connection.ibmCloudSettings?.region,
            legacy?.region,
          ),
          resourceGroup: preferString(
            connection.ibmCloudSettings?.resourceGroup,
            legacy?.projectName ?? legacy?.projectId,
          ),
        },
      } as T;

    case "heroku":
      return {
        ...normalized,
        password:
          canonicalPassword ??
          preferString(undefined, legacy?.apiKey ?? legacy?.accessToken) ??
          "",
        herokuSettings: {
          appName: preferString(
            connection.herokuSettings?.appName,
            legacy?.appName,
          ),
          region: preferString(
            connection.herokuSettings?.region,
            legacy?.region,
          ),
        },
      } as T;

    case "scaleway":
      return {
        ...normalized,
        password:
          canonicalPassword ??
          preferString(undefined, legacy?.apiKey ?? legacy?.accessToken) ??
          "",
        scalewaySettings: {
          organizationId: preferString(
            connection.scalewaySettings?.organizationId,
            legacy?.organizationId,
          ),
          projectName: preferString(
            connection.scalewaySettings?.projectName,
            legacy?.projectName,
          ),
          region: preferString(
            connection.scalewaySettings?.region,
            legacy?.region,
          ),
        },
      } as T;

    case "linode":
      return {
        ...normalized,
        password:
          canonicalPassword ??
          preferString(undefined, legacy?.apiKey ?? legacy?.accessToken) ??
          "",
        linodeSettings: {
          region: preferString(
            connection.linodeSettings?.region,
            legacy?.region,
          ),
        },
      } as T;

    case "ovhcloud": {
      const legacyCredentials: OvhCloudCredentialBundle = {
        apiKey: legacy?.apiKey ?? "",
        appSecret: legacy?.appSecret ?? legacy?.applicationSecret ?? "",
        consumerKey: legacy?.consumerKey ?? "",
      };
      const hasLegacyCredential = Object.values(legacyCredentials).some(
        hasSecret,
      );
      return {
        ...normalized,
        password:
          canonicalPassword ??
          (hasLegacyCredential
            ? serializeOvhCloudCredentialBundle(legacyCredentials)
            : ""),
        ovhCloudSettings: {
          serviceId: preferString(
            connection.ovhCloudSettings?.serviceId,
            legacy?.serviceId,
          ),
          projectName: preferString(
            connection.ovhCloudSettings?.projectName,
            legacy?.projectName,
          ),
          region: preferString(
            connection.ovhCloudSettings?.region,
            legacy?.region,
          ),
        },
      } as T;
    }
  }
};

export const normalizeCloudConnectionForPersistence =
  normalizeCloudConnectionForEditor;

export const cloudConnectionNeedsMigration = (
  connection: Partial<Connection>,
): boolean =>
  isCloudConnectionProtocol(connection.protocol) &&
  connection.cloudProvider !== undefined;

/**
 * Prevents a credential or provider-settings payload from being carried into
 * another protocol when the picker changes the connection type.
 */
export const transitionCloudConnectionProtocol = <
  T extends Partial<Connection>,
>(
  previous: Partial<Connection>,
  candidate: T,
): T => {
  if (previous.protocol === candidate.protocol) return candidate;
  if (
    !isCloudConnectionProtocol(previous.protocol) &&
    !isCloudConnectionProtocol(candidate.protocol)
  ) {
    return candidate;
  }

  const cleared = clearCloudSpecificFields({
    ...candidate,
    password: "",
  } as T);
  return isCloudConnectionProtocol(candidate.protocol)
    ? normalizeCloudConnectionForEditor(cleared)
    : cleared;
};
