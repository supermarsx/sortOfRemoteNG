import React from "react";
import { PasswordInput } from "../ui/forms";
import { InfoTooltip } from "../ui/InfoTooltip";
import { Connection } from "../../types/connection/connection";
import {
  inspectOvhCloudCredentialBundle,
  isCloudConnectionProtocol,
  normalizeCloudConnectionForEditor,
  serializeOvhCloudCredentialBundle,
  type CloudConnectionProtocol,
  type OvhCloudCredentialBundle,
} from "../../utils/connection/cloudConnectionContract";

interface CloudProviderOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const CloudProviderOptions: React.FC<CloudProviderOptionsProps> = ({
  formData,
  setFormData,
}) => {
  if (!isCloudConnectionProtocol(formData.protocol)) return null;

  const provider = formData.protocol;
  const normalized = normalizeCloudConnectionForEditor(formData);

  type CloudSettingsKey =
    | "gcpSettings"
    | "azureSettings"
    | "digitalOceanSettings"
    | "ibmCloudSettings"
    | "herokuSettings"
    | "scalewaySettings"
    | "linodeSettings"
    | "ovhCloudSettings";

  const updateSettings = (
    key: CloudSettingsKey,
    updates: Record<string, unknown>,
  ) => {
    setFormData((prev) => {
      const current = normalizeCloudConnectionForEditor(prev);
      return {
        ...current,
        cloudProvider: undefined,
        [key]: {
          ...((current[key] ?? {}) as Record<string, unknown>),
          ...updates,
        },
      };
    });
  };

  const updatePassword = (password: string) => {
    setFormData((prev) => ({
      ...normalizeCloudConnectionForEditor(prev),
      cloudProvider: undefined,
      password,
    }));
  };

  const ovhInspection = inspectOvhCloudCredentialBundle(normalized.password);
  const updateOvhCredential = (
    key: keyof OvhCloudCredentialBundle,
    value: string,
  ) => {
    updatePassword(
      serializeOvhCloudCredentialBundle({
        ...ovhInspection.credentials,
        [key]: value,
      }),
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-[var(--color-textSecondary)]">
        {CLOUD_PROVIDER_NAMES[provider]} Configuration
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {provider === "gcp" && (
          <>
            <CloudField
              id="cloud-gcp-project-id"
              label="Project ID"
              tooltip="The unique identifier for the Google Cloud project."
              value={normalized.gcpSettings?.projectId ?? ""}
              onChange={(projectId) =>
                updateSettings("gcpSettings", { projectId })
              }
              placeholder="my-gcp-project"
            />
            <CloudField
              id="cloud-gcp-region"
              label="Region"
              tooltip="The default Google Cloud region for resource operations."
              value={normalized.gcpSettings?.region ?? ""}
              onChange={(region) =>
                updateSettings("gcpSettings", { region: region || undefined })
              }
              placeholder="europe-west1"
            />
            <CloudField
              id="cloud-gcp-zone"
              label="Zone"
              tooltip="The default Google Cloud compute zone."
              value={normalized.gcpSettings?.zone ?? ""}
              onChange={(zone) =>
                updateSettings("gcpSettings", { zone: zone || undefined })
              }
              placeholder="europe-west1-b"
            />
            <CloudField
              id="cloud-gcp-scopes"
              label="OAuth Scopes"
              tooltip="Comma-separated OAuth scopes. Empty uses the cloud-platform scope."
              value={normalized.gcpSettings?.scopes?.join(", ") ?? ""}
              onChange={(value) =>
                updateSettings("gcpSettings", {
                  scopes:
                    value
                      .split(",")
                      .map((scope) => scope.trim())
                      .filter(Boolean) || undefined,
                })
              }
              placeholder="https://www.googleapis.com/auth/cloud-platform"
            />
            <CloudField
              id="cloud-gcp-endpoint"
              label="API Endpoint Override"
              tooltip="Optional API endpoint override for controlled or private environments."
              value={normalized.gcpSettings?.endpointOverride ?? ""}
              onChange={(endpointOverride) =>
                updateSettings("gcpSettings", {
                  endpointOverride: endpointOverride || undefined,
                })
              }
              placeholder="https://compute.googleapis.com"
            />
            <CloudField
              id="cloud-gcp-service-account"
              label="Service Account JSON"
              tooltip="The service-account JSON is stored only in the protected connection credential."
              value={normalized.password ?? ""}
              onChange={updatePassword}
              placeholder="Paste service-account JSON"
              secret
            />
          </>
        )}

        {provider === "azure" && (
          <>
            <CloudField
              id="cloud-azure-tenant"
              label="Tenant ID"
              tooltip="The Microsoft Entra tenant ID."
              value={normalized.azureSettings?.tenantId ?? ""}
              onChange={(tenantId) =>
                updateSettings("azureSettings", { tenantId })
              }
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
            <CloudField
              id="cloud-azure-client"
              label="Client ID"
              tooltip="The application client ID used by the service principal."
              value={normalized.azureSettings?.clientId ?? ""}
              onChange={(clientId) =>
                updateSettings("azureSettings", { clientId })
              }
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
            <CloudField
              id="cloud-azure-subscription"
              label="Subscription ID"
              tooltip="The Azure subscription containing the managed resources."
              value={normalized.azureSettings?.subscriptionId ?? ""}
              onChange={(subscriptionId) =>
                updateSettings("azureSettings", { subscriptionId })
              }
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
            <CloudField
              id="cloud-azure-resource-group"
              label="Default Resource Group"
              tooltip="Optional default resource group for resource operations."
              value={normalized.azureSettings?.defaultResourceGroup ?? ""}
              onChange={(defaultResourceGroup) =>
                updateSettings("azureSettings", {
                  defaultResourceGroup: defaultResourceGroup || undefined,
                })
              }
              placeholder="my-resource-group"
            />
            <CloudField
              id="cloud-azure-region"
              label="Default Region"
              tooltip="Optional default Azure region."
              value={normalized.azureSettings?.defaultRegion ?? ""}
              onChange={(defaultRegion) =>
                updateSettings("azureSettings", {
                  defaultRegion: defaultRegion || undefined,
                })
              }
              placeholder="westeurope"
            />
            <CloudField
              id="cloud-azure-secret"
              label="Client Secret"
              tooltip="The client secret is stored only in the protected connection credential."
              value={normalized.password ?? ""}
              onChange={updatePassword}
              placeholder="Your client secret"
              secret
            />
          </>
        )}

        {provider === "digital-ocean" && (
          <>
            <CloudField
              id="cloud-do-token"
              label="API Token"
              tooltip="The DigitalOcean API token is stored only in the protected connection credential."
              value={normalized.password ?? ""}
              onChange={updatePassword}
              placeholder="Your API token"
              secret
            />
            <CloudField
              id="cloud-do-region"
              label="Region"
              tooltip="Optional default DigitalOcean region."
              value={normalized.digitalOceanSettings?.region ?? ""}
              onChange={(region) =>
                updateSettings("digitalOceanSettings", {
                  region: region || undefined,
                })
              }
              placeholder="lon1"
            />
          </>
        )}

        {provider === "ibm-csp" && (
          <>
            <CloudField
              id="cloud-ibm-key"
              label="API Key"
              tooltip="The IBM Cloud API key is stored only in the protected connection credential."
              value={normalized.password ?? ""}
              onChange={updatePassword}
              placeholder="Your IBM Cloud API key"
              secret
            />
            <CloudField
              id="cloud-ibm-region"
              label="Region"
              tooltip="Optional default IBM Cloud region."
              value={normalized.ibmCloudSettings?.region ?? ""}
              onChange={(region) =>
                updateSettings("ibmCloudSettings", {
                  region: region || undefined,
                })
              }
              placeholder="eu-gb"
            />
            <CloudField
              id="cloud-ibm-resource-group"
              label="Resource Group"
              tooltip="Optional IBM Cloud resource group."
              value={normalized.ibmCloudSettings?.resourceGroup ?? ""}
              onChange={(resourceGroup) =>
                updateSettings("ibmCloudSettings", {
                  resourceGroup: resourceGroup || undefined,
                })
              }
              placeholder="default"
            />
          </>
        )}

        {provider === "heroku" && (
          <>
            <CloudField
              id="cloud-heroku-key"
              label="API Key"
              tooltip="The Heroku API key is stored only in the protected connection credential."
              value={normalized.password ?? ""}
              onChange={updatePassword}
              placeholder="Your Heroku API key"
              secret
            />
            <CloudField
              id="cloud-heroku-app"
              label="App Name"
              tooltip="Optional Heroku app to use as the default resource context."
              value={normalized.herokuSettings?.appName ?? ""}
              onChange={(appName) =>
                updateSettings("herokuSettings", {
                  appName: appName || undefined,
                })
              }
              placeholder="my-heroku-app"
            />
            <CloudField
              id="cloud-heroku-region"
              label="Region"
              tooltip="Optional default Heroku region."
              value={normalized.herokuSettings?.region ?? ""}
              onChange={(region) =>
                updateSettings("herokuSettings", {
                  region: region || undefined,
                })
              }
              placeholder="eu"
            />
          </>
        )}

        {provider === "scaleway" && (
          <>
            <CloudField
              id="cloud-scaleway-key"
              label="API Key"
              tooltip="The Scaleway API key is stored only in the protected connection credential."
              value={normalized.password ?? ""}
              onChange={updatePassword}
              placeholder="Your Scaleway API key"
              secret
            />
            <CloudField
              id="cloud-scaleway-organization"
              label="Organization ID"
              tooltip="Optional Scaleway organization scope."
              value={normalized.scalewaySettings?.organizationId ?? ""}
              onChange={(organizationId) =>
                updateSettings("scalewaySettings", {
                  organizationId: organizationId || undefined,
                })
              }
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
            <CloudField
              id="cloud-scaleway-project"
              label="Project Name"
              tooltip="Optional Scaleway project scope."
              value={normalized.scalewaySettings?.projectName ?? ""}
              onChange={(projectName) =>
                updateSettings("scalewaySettings", {
                  projectName: projectName || undefined,
                })
              }
              placeholder="my-project"
            />
            <CloudField
              id="cloud-scaleway-region"
              label="Region"
              tooltip="Optional default Scaleway region."
              value={normalized.scalewaySettings?.region ?? ""}
              onChange={(region) =>
                updateSettings("scalewaySettings", {
                  region: region || undefined,
                })
              }
              placeholder="fr-par"
            />
          </>
        )}

        {provider === "linode" && (
          <>
            <CloudField
              id="cloud-linode-key"
              label="API Key"
              tooltip="The Linode API key is stored only in the protected connection credential."
              value={normalized.password ?? ""}
              onChange={updatePassword}
              placeholder="Your Linode API key"
              secret
            />
            <CloudField
              id="cloud-linode-region"
              label="Region"
              tooltip="Optional default Linode region."
              value={normalized.linodeSettings?.region ?? ""}
              onChange={(region) =>
                updateSettings("linodeSettings", {
                  region: region || undefined,
                })
              }
              placeholder="eu-west"
            />
          </>
        )}

        {provider === "ovhcloud" && (
          <>
            <CloudField
              id="cloud-ovh-api-key"
              label="OVHcloud API Key"
              tooltip="The application key is stored only inside the protected credential bundle."
              value={ovhInspection.credentials.apiKey}
              onChange={(apiKey) => updateOvhCredential("apiKey", apiKey)}
              placeholder="Application key"
              secret
            />
            <CloudField
              id="cloud-ovh-app-secret"
              label="Application Secret"
              tooltip="The application secret is stored only inside the protected credential bundle."
              value={ovhInspection.credentials.appSecret}
              onChange={(appSecret) =>
                updateOvhCredential("appSecret", appSecret)
              }
              placeholder="Application secret"
              secret
            />
            <CloudField
              id="cloud-ovh-consumer-key"
              label="Consumer Key"
              tooltip="The consumer key is stored only inside the protected credential bundle."
              value={ovhInspection.credentials.consumerKey}
              onChange={(consumerKey) =>
                updateOvhCredential("consumerKey", consumerKey)
              }
              placeholder="Consumer key"
              secret
            />
            <CloudField
              id="cloud-ovh-service"
              label="Service ID"
              tooltip="Optional OVHcloud service identifier."
              value={normalized.ovhCloudSettings?.serviceId ?? ""}
              onChange={(serviceId) =>
                updateSettings("ovhCloudSettings", {
                  serviceId: serviceId || undefined,
                })
              }
              placeholder="Service identifier"
            />
            <CloudField
              id="cloud-ovh-project"
              label="Project Name"
              tooltip="Optional OVHcloud project scope."
              value={normalized.ovhCloudSettings?.projectName ?? ""}
              onChange={(projectName) =>
                updateSettings("ovhCloudSettings", {
                  projectName: projectName || undefined,
                })
              }
              placeholder="my-project"
            />
            <CloudField
              id="cloud-ovh-region"
              label="Region"
              tooltip="Optional default OVHcloud region."
              value={normalized.ovhCloudSettings?.region ?? ""}
              onChange={(region) =>
                updateSettings("ovhCloudSettings", {
                  region: region || undefined,
                })
              }
              placeholder="GRA11"
            />
          </>
        )}
      </div>

      {provider === "ovhcloud" &&
        ["malformed", "incomplete"].includes(ovhInspection.status) && (
          <div
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-[var(--color-textSecondary)]"
          >
            {ovhInspection.status === "malformed"
              ? "The saved OVHcloud credential bundle is malformed. Its raw value remains masked; enter all three credentials to replace it safely."
              : "The OVHcloud credential bundle is incomplete. Enter the API key, application secret, and consumer key before connecting."}
          </div>
        )}
    </div>
  );
};

const CLOUD_PROVIDER_NAMES: Record<CloudConnectionProtocol, string> = {
  gcp: "Google Cloud",
  azure: "Microsoft Azure",
  "digital-ocean": "DigitalOcean",
  "ibm-csp": "IBM Cloud",
  heroku: "Heroku",
  scaleway: "Scaleway",
  linode: "Linode",
  ovhcloud: "OVHcloud",
};

interface CloudFieldProps {
  id: string;
  label: string;
  tooltip: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  secret?: boolean;
}

const CloudField: React.FC<CloudFieldProps> = ({
  id,
  label,
  tooltip,
  value,
  onChange,
  placeholder,
  secret = false,
}) => (
  <div>
    <label
      htmlFor={id}
      className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2"
    >
      {label} <InfoTooltip text={tooltip} />
    </label>
    {secret ? (
      <PasswordInput
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="sor-form-input"
        placeholder={placeholder}
        autoComplete="new-password"
      />
    ) : (
      <input
        id={id}
        aria-label={label}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="sor-form-input"
        placeholder={placeholder}
      />
    )}
  </div>
);

export default CloudProviderOptions;
