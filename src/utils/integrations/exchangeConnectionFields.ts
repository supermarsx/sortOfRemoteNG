import type {
  IntegrationConnectionSettings,
  IntegrationProviderFields,
} from "../../types/connection/connection";
import type {
  ExchangeConnectionConfig,
  ExchangeEnvironment,
  OnPremAuthMethod,
} from "../../types/exchange";

export const EXCHANGE_INTEGRATION_KEY = "exchange";
export const EXCHANGE_CLIENT_SECRET_KEY = "clientSecret";
export const EXCHANGE_ON_PREM_PASSWORD_KEY = "onPremPassword";

export const EXCHANGE_ENVIRONMENTS: ExchangeEnvironment[] = [
  "online",
  "onPremises",
  "hybrid",
];

export const EXCHANGE_AUTH_METHODS: OnPremAuthMethod[] = [
  "kerberos",
  "negotiate",
  "basic",
  "ntlm",
];

export interface ExchangeConnectionProviderFields {
  environment: ExchangeEnvironment;
  timeoutSecs: string;
  tenantId: string;
  clientId: string;
  onlineUsername: string;
  organization: string;
  server: string;
  port: string;
  onPremUsername: string;
  useSsl: boolean;
  authMethod: OnPremAuthMethod;
  skipCertCheck: boolean;
}

export interface ExchangeConnectionSecrets {
  clientSecret: string;
  password: string;
}

export type ExchangeConnectionFormState = ExchangeConnectionProviderFields &
  ExchangeConnectionSecrets & {
    name: string;
  };

export const EMPTY_EXCHANGE_CONNECTION_FORM: ExchangeConnectionFormState = {
  name: "",
  environment: "online",
  timeoutSecs: "",
  tenantId: "",
  clientId: "",
  clientSecret: "",
  onlineUsername: "",
  organization: "",
  server: "",
  port: "",
  onPremUsername: "",
  password: "",
  useSsl: true,
  authMethod: "kerberos",
  skipCertCheck: false,
};

type ExchangeConnectionSecretPatch = Partial<ExchangeConnectionSecrets>;

const isExchangeEnvironment = (value: unknown): value is ExchangeEnvironment =>
  value === "online" || value === "onPremises" || value === "hybrid";

const isOnPremAuthMethod = (value: unknown): value is OnPremAuthMethod =>
  value === "kerberos" ||
  value === "negotiate" ||
  value === "basic" ||
  value === "ntlm";

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
};

const parsePositiveNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export function normalizeExchangeConnectionFields(
  fields: IntegrationProviderFields | Record<string, unknown> | undefined,
  fallback?: {
    host?: string;
    username?: string;
    timeout?: number;
  },
): ExchangeConnectionProviderFields {
  const raw = fields ?? {};
  const environment = isExchangeEnvironment(raw.environment)
    ? raw.environment
    : EMPTY_EXCHANGE_CONNECTION_FORM.environment;
  const authMethod = isOnPremAuthMethod(raw.authMethod)
    ? raw.authMethod
    : EMPTY_EXCHANGE_CONNECTION_FORM.authMethod;
  const fallbackTimeout =
    typeof fallback?.timeout === "number" && fallback.timeout > 0
      ? String(fallback.timeout)
      : "";

  return {
    environment,
    timeoutSecs: asString(raw.timeoutSecs, fallbackTimeout),
    tenantId: asString(raw.tenantId),
    clientId: asString(raw.clientId),
    onlineUsername: asString(raw.onlineUsername, fallback?.username ?? ""),
    organization: asString(raw.organization),
    server: asString(raw.server, fallback?.host ?? ""),
    port: asString(raw.port),
    onPremUsername: asString(raw.onPremUsername, fallback?.username ?? ""),
    useSsl: asBoolean(raw.useSsl, true),
    authMethod,
    skipCertCheck: asBoolean(raw.skipCertCheck, false),
  };
}

export function toExchangeProviderFields(
  fields: ExchangeConnectionProviderFields,
): IntegrationProviderFields {
  return {
    environment: fields.environment,
    timeoutSecs: fields.timeoutSecs.trim(),
    tenantId: fields.tenantId.trim(),
    clientId: fields.clientId.trim(),
    onlineUsername: fields.onlineUsername.trim(),
    organization: fields.organization.trim(),
    server: fields.server.trim(),
    port: fields.port.trim(),
    onPremUsername: fields.onPremUsername.trim(),
    useSsl: fields.useSsl,
    authMethod: fields.authMethod,
    skipCertCheck: fields.skipCertCheck,
  };
}

export function exchangeProviderFieldsToInstanceFields(
  fields: ExchangeConnectionProviderFields,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(toExchangeProviderFields(fields)).map(([key, value]) => [
      key,
      String(value ?? ""),
    ]),
  );
}

export function exchangeConnectionHost(
  fields: ExchangeConnectionProviderFields,
): string {
  if (
    (fields.environment === "onPremises" || fields.environment === "hybrid") &&
    fields.server.trim()
  ) {
    return fields.server.trim();
  }
  return fields.organization.trim() || fields.tenantId.trim();
}

export function exchangeConnectionUsername(
  fields: ExchangeConnectionProviderFields,
): string {
  if (fields.environment === "onPremises" && fields.onPremUsername.trim()) {
    return fields.onPremUsername.trim();
  }
  return fields.onlineUsername.trim() || fields.onPremUsername.trim();
}

export function exchangeConnectionTimeout(
  fields: ExchangeConnectionProviderFields,
  fallback?: number,
): number | undefined {
  return parsePositiveNumber(fields.timeoutSecs) ?? fallback;
}

export function exchangeFormFromConnectionSettings(
  settings?: IntegrationConnectionSettings & {
    providerSecrets?: Partial<Record<keyof ExchangeConnectionSecrets, string>>;
  },
): ExchangeConnectionFormState {
  const fields = normalizeExchangeConnectionFields(settings?.providerFields, {
    host: settings?.host,
    username: settings?.username,
    timeout: settings?.timeout,
  });

  return {
    ...EMPTY_EXCHANGE_CONNECTION_FORM,
    ...fields,
    name: settings?.instanceName ?? settings?.descriptorLabel ?? "",
    clientSecret: settings?.providerSecrets?.clientSecret ?? "",
    password: settings?.providerSecrets?.password ?? "",
  };
}

export function exchangeFormFromInstance(
  name: string | undefined,
  fields: Record<string, string> | undefined,
  secrets: ExchangeConnectionSecretPatch,
): ExchangeConnectionFormState {
  return {
    ...EMPTY_EXCHANGE_CONNECTION_FORM,
    ...normalizeExchangeConnectionFields(fields),
    name: name ?? "",
    clientSecret: secrets.clientSecret ?? "",
    password: secrets.password ?? "",
  };
}

export function exchangeFormProviderFields(
  form: ExchangeConnectionFormState,
): ExchangeConnectionProviderFields {
  return {
    environment: form.environment,
    timeoutSecs: form.timeoutSecs,
    tenantId: form.tenantId,
    clientId: form.clientId,
    onlineUsername: form.onlineUsername,
    organization: form.organization,
    server: form.server,
    port: form.port,
    onPremUsername: form.onPremUsername,
    useSsl: form.useSsl,
    authMethod: form.authMethod,
    skipCertCheck: form.skipCertCheck,
  };
}

export function exchangeSecretsForVault(
  form: ExchangeConnectionFormState,
): Record<string, string> {
  const secrets: Record<string, string> = {};
  if (
    (form.environment === "online" || form.environment === "hybrid") &&
    form.clientSecret
  ) {
    secrets[EXCHANGE_CLIENT_SECRET_KEY] = form.clientSecret;
  }
  if (
    (form.environment === "onPremises" || form.environment === "hybrid") &&
    form.password
  ) {
    secrets[EXCHANGE_ON_PREM_PASSWORD_KEY] = form.password;
  }
  return secrets;
}

export function exchangeConfigFromForm(
  form: ExchangeConnectionFormState,
): ExchangeConnectionConfig {
  const timeoutSecs = parsePositiveNumber(form.timeoutSecs) ?? null;
  const config: ExchangeConnectionConfig = {
    environment: form.environment,
    timeoutSecs,
  };

  if (form.environment === "online" || form.environment === "hybrid") {
    config.online = {
      tenantId: form.tenantId.trim(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret || null,
      username: form.onlineUsername.trim() || null,
      organization: form.organization.trim() || null,
    };
  }

  if (form.environment === "onPremises" || form.environment === "hybrid") {
    const port = parsePositiveNumber(form.port) ?? 443;
    config.onPrem = {
      server: form.server.trim(),
      port,
      username: form.onPremUsername.trim(),
      password: form.password,
      useSsl: form.useSsl,
      authMethod: form.authMethod,
      skipCertCheck: form.skipCertCheck,
    };
  }

  return config;
}
