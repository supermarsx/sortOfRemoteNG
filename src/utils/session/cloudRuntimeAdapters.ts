import { invoke } from "@tauri-apps/api/core";

import type { Connection } from "../../types/connection/connection";
import {
  inspectOvhCloudCredentialBundle,
  normalizeCloudConnectionForPersistence,
  type OvhCloudCredentialBundle,
} from "../connection/cloudConnectionContract";
import type {
  BuiltInCloudRuntimeHandle,
  BuiltInCloudRuntimeProtocol,
} from "./builtInCloudRuntimeRegistry";

export interface CloudRuntimeAdapter {
  protocol: BuiltInCloudRuntimeProtocol;
  displayName: string;
  validate: (connection: Connection) => string | null;
  summary: (connection: Connection) => string;
  connect: (connection: Connection) => Promise<BuiltInCloudRuntimeHandle>;
  disconnect: (
    handle: BuiltInCloudRuntimeHandle | undefined,
  ) => Promise<void>;
}

const defaultGcpScopes = [
  "https://www.googleapis.com/auth/cloud-platform",
];

const runtimeConnection = (connection: Connection): Connection =>
  normalizeCloudConnectionForPersistence(connection);

export const gcpRuntimeAdapter: CloudRuntimeAdapter = {
  protocol: "gcp",
  displayName: "Google Cloud",
  validate(connection) {
    const normalized = runtimeConnection(connection);
    if (!normalized.gcpSettings?.projectId.trim()) {
      return "Google Cloud requires a project ID.";
    }
    if (!normalized.password?.trim()) {
      return "Google Cloud requires service-account JSON in the saved credential.";
    }
    return null;
  },
  summary(connection) {
    const settings = runtimeConnection(connection).gcpSettings;
    return [
      settings?.projectId,
      settings?.zone ?? settings?.region,
    ]
      .filter(Boolean)
      .join(" / ");
  },
  async connect(connection) {
    const normalized = runtimeConnection(connection);
    const settings = normalized.gcpSettings!;
    const backendSessionId = await invoke<string>("connect_gcp", {
      config: {
        project_id: settings.projectId,
        service_account_key: normalized.password!,
        region: settings.region ?? null,
        zone: settings.zone ?? null,
        scopes: settings.scopes?.length
          ? settings.scopes
          : defaultGcpScopes,
        endpoint_override: settings.endpointOverride ?? null,
      },
    });
    return { backendSessionId };
  },
  async disconnect(handle) {
    if (!handle?.backendSessionId) return;
    await invoke<void>("disconnect_gcp", {
      sessionId: handle.backendSessionId,
    });
  },
};

export const azureRuntimeAdapter: CloudRuntimeAdapter = {
  protocol: "azure",
  displayName: "Microsoft Azure",
  validate(connection) {
    const normalized = runtimeConnection(connection);
    const settings = normalized.azureSettings;
    if (!settings?.tenantId.trim()) {
      return "Microsoft Azure requires a tenant ID.";
    }
    if (!settings.clientId.trim()) {
      return "Microsoft Azure requires a client ID.";
    }
    if (!settings.subscriptionId.trim()) {
      return "Microsoft Azure requires a subscription ID.";
    }
    if (!normalized.password?.trim()) {
      return "Microsoft Azure requires a client secret in the saved credential.";
    }
    return null;
  },
  summary(connection) {
    const settings = runtimeConnection(connection).azureSettings;
    return [settings?.subscriptionId, settings?.defaultRegion]
      .filter(Boolean)
      .join(" / ");
  },
  async connect(connection) {
    const normalized = runtimeConnection(connection);
    const settings = normalized.azureSettings!;
    await invoke<void>("azure_set_credentials", {
      tenantId: settings.tenantId,
      clientId: settings.clientId,
      clientSecret: normalized.password!,
      subscriptionId: settings.subscriptionId,
      defaultResourceGroup: settings.defaultResourceGroup ?? null,
      defaultRegion: settings.defaultRegion ?? null,
    });
    await invoke<void>("azure_authenticate");
    return {};
  },
  async disconnect() {
    await invoke<void>("azure_disconnect");
  },
};

export const digitalOceanRuntimeAdapter: CloudRuntimeAdapter = {
  protocol: "digital-ocean",
  displayName: "DigitalOcean",
  validate(connection) {
    if (!runtimeConnection(connection).password?.trim()) {
      return "DigitalOcean requires an API token in the saved credential.";
    }
    return null;
  },
  summary(connection) {
    return (
      runtimeConnection(connection).digitalOceanSettings?.region ??
      "All regions"
    );
  },
  async connect(connection) {
    const normalized = runtimeConnection(connection);
    const backendSessionId = await invoke<string>("connect_digital_ocean", {
      config: {
        api_token: normalized.password!,
        region: normalized.digitalOceanSettings?.region ?? null,
      },
    });
    return { backendSessionId };
  },
  async disconnect(handle) {
    if (!handle?.backendSessionId) return;
    await invoke<void>("disconnect_digital_ocean", {
      sessionId: handle.backendSessionId,
    });
  },
};

// Wave 6 providers all expose independent backend session handles. Secrets are
// read only from Connection.password and never copied into saved provider settings
// or frontend session state.
const wave6SecretPresent = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const wave6ConnectSession = async (
  command: string,
  config: Record<string, unknown>,
) => ({
  backendSessionId: await invoke<string>(command, { config }),
});

const wave6DisconnectSession = async (
  command: string,
  handle: { backendSessionId?: string } | undefined,
): Promise<void> => {
  const sessionId = handle?.backendSessionId;
  if (!sessionId) return;
  await invoke(command, { sessionId });
};

const readOvhCloudCredentialBundle = (
  connection: Connection,
): OvhCloudCredentialBundle | null => {
  const inspection = inspectOvhCloudCredentialBundle(
    runtimeConnection(connection).password,
  );
  return inspection.status === "valid" ? inspection.credentials : null;
};

export const ibmCloudRuntimeAdapter: CloudRuntimeAdapter = {
  protocol: "ibm-csp",
  displayName: "IBM Cloud",
  validate: (connection) =>
    wave6SecretPresent(runtimeConnection(connection).password)
      ? null
      : "IBM Cloud requires an API key in the saved password field.",
  summary: (connection) =>
    runtimeConnection(connection).ibmCloudSettings?.region ||
    "IBM Cloud account",
  connect: (connection) => {
    const normalized = runtimeConnection(connection);
    return wave6ConnectSession("connect_ibm", {
      api_key: normalized.password,
      region: normalized.ibmCloudSettings?.region ?? null,
      resource_group: normalized.ibmCloudSettings?.resourceGroup ?? null,
    });
  },
  disconnect: (handle) => wave6DisconnectSession("disconnect_ibm", handle),
};

export const herokuRuntimeAdapter: CloudRuntimeAdapter = {
  protocol: "heroku",
  displayName: "Heroku",
  validate: (connection) =>
    wave6SecretPresent(runtimeConnection(connection).password)
      ? null
      : "Heroku requires an API key in the saved password field.",
  summary: (connection) => {
    const normalized = runtimeConnection(connection);
    return (
      normalized.herokuSettings?.appName ||
      normalized.herokuSettings?.region ||
      "Heroku account"
    );
  },
  connect: (connection) => {
    const normalized = runtimeConnection(connection);
    return wave6ConnectSession("connect_heroku", {
      api_key: normalized.password,
      app_name: normalized.herokuSettings?.appName ?? null,
      region: normalized.herokuSettings?.region ?? null,
    });
  },
  disconnect: (handle) => wave6DisconnectSession("disconnect_heroku", handle),
};

export const scalewayRuntimeAdapter: CloudRuntimeAdapter = {
  protocol: "scaleway",
  displayName: "Scaleway",
  validate: (connection) =>
    wave6SecretPresent(runtimeConnection(connection).password)
      ? null
      : "Scaleway requires an API key in the saved password field.",
  summary: (connection) => {
    const normalized = runtimeConnection(connection);
    return (
      normalized.scalewaySettings?.projectName ||
      normalized.scalewaySettings?.organizationId ||
      normalized.scalewaySettings?.region ||
      "Scaleway account"
    );
  },
  connect: (connection) => {
    const normalized = runtimeConnection(connection);
    return wave6ConnectSession("connect_scaleway", {
      api_key: normalized.password,
      organization_id:
        normalized.scalewaySettings?.organizationId ?? null,
      project_name: normalized.scalewaySettings?.projectName ?? null,
      region: normalized.scalewaySettings?.region ?? null,
    });
  },
  disconnect: (handle) =>
    wave6DisconnectSession("disconnect_scaleway", handle),
};

export const linodeRuntimeAdapter: CloudRuntimeAdapter = {
  protocol: "linode",
  displayName: "Linode",
  validate: (connection) =>
    wave6SecretPresent(runtimeConnection(connection).password)
      ? null
      : "Linode requires an API key in the saved password field.",
  summary: (connection) =>
    runtimeConnection(connection).linodeSettings?.region ||
    "Linode account",
  connect: (connection) => {
    const normalized = runtimeConnection(connection);
    return wave6ConnectSession("connect_linode", {
      api_key: normalized.password,
      region: normalized.linodeSettings?.region ?? null,
    });
  },
  disconnect: (handle) => wave6DisconnectSession("disconnect_linode", handle),
};

export const ovhCloudRuntimeAdapter: CloudRuntimeAdapter = {
  protocol: "ovhcloud",
  displayName: "OVHcloud",
  validate: (connection) =>
    readOvhCloudCredentialBundle(connection)
      ? null
      : "OVHcloud requires password JSON containing apiKey, appSecret, and consumerKey.",
  summary: (connection) => {
    const normalized = runtimeConnection(connection);
    return (
      normalized.ovhCloudSettings?.projectName ||
      normalized.ovhCloudSettings?.serviceId ||
      normalized.ovhCloudSettings?.region ||
      "OVHcloud account"
    );
  },
  connect: (connection) => {
    const normalized = runtimeConnection(connection);
    const credentials = readOvhCloudCredentialBundle(connection);
    if (!credentials) {
      throw new Error(
        "OVHcloud requires password JSON containing apiKey, appSecret, and consumerKey.",
      );
    }
    return wave6ConnectSession("connect_ovh", {
      api_key: credentials.apiKey,
      app_secret: credentials.appSecret,
      consumer_key: credentials.consumerKey,
      service_id: normalized.ovhCloudSettings?.serviceId ?? null,
      project_name: normalized.ovhCloudSettings?.projectName ?? null,
      region: normalized.ovhCloudSettings?.region ?? null,
    });
  },
  disconnect: (handle) => wave6DisconnectSession("disconnect_ovh", handle),
};
