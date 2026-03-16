import React from "react";
import { PasswordInput, Textarea} from '../ui/forms';
import { InfoTooltip } from '../ui/InfoTooltip';
import { Connection } from "../../types/connection/connection";

interface CloudProviderOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const CloudProviderOptions: React.FC<CloudProviderOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const updateCloudProvider = (
    updates: Partial<NonNullable<Connection["cloudProvider"]>>,
  ) => {
    setFormData((prev) => {
      const currentCloudProvider = prev.cloudProvider || {};
      const updatedCloudProvider = {
        ...currentCloudProvider,
        ...updates,
      } as NonNullable<Connection["cloudProvider"]>;

      // Ensure provider is set if not already present
      if (!updatedCloudProvider.provider && formData.protocol) {
        updatedCloudProvider.provider = formData.protocol as NonNullable<
          Connection["cloudProvider"]
        >["provider"];
      }

      return {
        ...prev,
        cloudProvider: updatedCloudProvider,
      };
    });
  };

  if (
    ![
      "gcp",
      "azure",
      "ibm-csp",
      "digital-ocean",
      "heroku",
      "scaleway",
      "linode",
      "ovhcloud",
    ].includes(formData.protocol || "")
  ) {
    return null;
  }

  const provider = formData.protocol;
  const cloudProvider = (formData.cloudProvider || {}) as Partial<
    NonNullable<Connection["cloudProvider"]>
  >;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-[var(--color-textSecondary)]">
        {provider === "gcp" && "Google Cloud Platform"}
        {provider === "azure" && "Microsoft Azure"}
        {provider === "ibm-csp" && "IBM Cloud"}
        {provider === "digital-ocean" && "Digital Ocean"}
        {provider === "heroku" && "Heroku"}
        {provider === "scaleway" && "Scaleway"}
        {provider === "linode" && "Linode"}
        {provider === "ovhcloud" && "OVH Cloud"}
        {" Configuration"}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {provider === "gcp" && (
          <>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Project ID <InfoTooltip text="The unique identifier for your Google Cloud Platform project." />
              </label>
              <input
                type="text"
                value={cloudProvider.projectId || ""}
                onChange={(e) =>
                  updateCloudProvider({ projectId: e.target.value })
                }
                className="sor-form-input"
                placeholder="my-gcp-project"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Zone <InfoTooltip text="The GCP zone where your compute instance is located (e.g. us-central1-a)." />
              </label>
              <input
                type="text"
                value={cloudProvider.zone || ""}
                onChange={(e) => updateCloudProvider({ zone: e.target.value })}
                className="sor-form-input"
                placeholder="us-central1-a"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Service Account Key (JSON) <InfoTooltip text="The JSON key file contents for a GCP service account used to authenticate API requests." />
              </label>
              <Textarea
                value={cloudProvider.serviceAccountKey || ""}
                onChange={(e) =>
                  updateCloudProvider({ serviceAccountKey: e.target.value })
                }
                
                rows={4}
                placeholder="Paste your GCP service account key JSON here"
              />
            </div>
          </>
        )}

        {provider === "azure" && (
          <>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Subscription ID <InfoTooltip text="The GUID of your Azure subscription that contains the target resources." />
              </label>
              <input
                type="text"
                value={cloudProvider.subscriptionId || ""}
                onChange={(e) =>
                  updateCloudProvider({ subscriptionId: e.target.value })
                }
                className="sor-form-input"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Resource Group <InfoTooltip text="The Azure resource group that contains the target virtual machine or resource." />
              </label>
              <input
                type="text"
                value={cloudProvider.resourceGroup || ""}
                onChange={(e) =>
                  updateCloudProvider({ resourceGroup: e.target.value })
                }
                className="sor-form-input"
                placeholder="my-resource-group"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Client ID <InfoTooltip text="The application (client) ID from your Azure AD app registration used for authentication." />
              </label>
              <input
                type="text"
                value={cloudProvider.clientId || ""}
                onChange={(e) =>
                  updateCloudProvider({ clientId: e.target.value })
                }
                className="sor-form-input"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Client Secret <InfoTooltip text="The secret key associated with the Azure AD app registration. Treat this like a password." />
              </label>
              <PasswordInput
                value={cloudProvider.clientSecret || ""}
                onChange={(e) =>
                  updateCloudProvider({ clientSecret: e.target.value })
                }
                className="sor-form-input"
                placeholder="Your client secret"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Tenant ID <InfoTooltip text="The Azure Active Directory tenant ID (directory ID) for your organization." />
              </label>
              <input
                type="text"
                value={cloudProvider.tenantId || ""}
                onChange={(e) =>
                  updateCloudProvider({ tenantId: e.target.value })
                }
                className="sor-form-input"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
          </>
        )}

        {(provider === "ibm-csp" || provider === "digital-ocean") && (
          <>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                API Key <InfoTooltip text="Your cloud provider API key used to authenticate management requests." />
              </label>
              <PasswordInput
                value={cloudProvider.apiKey || ""}
                onChange={(e) =>
                  updateCloudProvider({ apiKey: e.target.value })
                }
                className="sor-form-input"
                placeholder="Your API key"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Region <InfoTooltip text="The data center region where your cloud resources are hosted." />
              </label>
              <input
                type="text"
                value={cloudProvider.region || ""}
                onChange={(e) =>
                  updateCloudProvider({ region: e.target.value })
                }
                className="sor-form-input"
                placeholder={provider === "ibm-csp" ? "us-south" : "nyc1"}
              />
            </div>
          </>
        )}

        {provider === "heroku" && (
          <>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                API Key <InfoTooltip text="Your Heroku API key, found in the Heroku dashboard under Account Settings." />
              </label>
              <PasswordInput
                value={cloudProvider.apiKey || ""}
                onChange={(e) =>
                  updateCloudProvider({ apiKey: e.target.value })
                }
                className="sor-form-input"
                placeholder="Your Heroku API key"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                App Name <InfoTooltip text="The name of the Heroku application to connect to." />
              </label>
              <input
                type="text"
                value={cloudProvider.appName || ""}
                onChange={(e) =>
                  updateCloudProvider({ appName: e.target.value })
                }
                className="sor-form-input"
                placeholder="my-heroku-app"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Dyno Name (Optional) <InfoTooltip text="A specific Heroku dyno to target. Leave empty to connect to the default web dyno." />
              </label>
              <input
                type="text"
                value={cloudProvider.dynoName || ""}
                onChange={(e) =>
                  updateCloudProvider({ dynoName: e.target.value })
                }
                className="sor-form-input"
                placeholder="web.1"
              />
            </div>
          </>
        )}

        {(provider === "scaleway" ||
          provider === "linode" ||
          provider === "ovhcloud") && (
          <>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                API Key <InfoTooltip text="Your cloud provider API key used to authenticate management requests." />
              </label>
              <PasswordInput
                value={cloudProvider.apiKey || ""}
                onChange={(e) =>
                  updateCloudProvider({ apiKey: e.target.value })
                }
                className="sor-form-input"
                placeholder="Your API key"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Region <InfoTooltip text="The data center region where your cloud resources are hosted." />
              </label>
              <input
                type="text"
                value={cloudProvider.region || ""}
                onChange={(e) =>
                  updateCloudProvider({ region: e.target.value })
                }
                className="sor-form-input"
                placeholder={
                  provider === "scaleway"
                    ? "fr-par"
                    : provider === "linode"
                      ? "us-east"
                      : "eu-west"
                }
              />
            </div>
            {provider === "scaleway" && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  Organization ID <InfoTooltip text="Your Scaleway organization ID, used to scope API requests to the correct account." />
                </label>
                <input
                  type="text"
                  value={cloudProvider.organizationId || ""}
                  onChange={(e) =>
                    updateCloudProvider({ organizationId: e.target.value })
                  }
                  className="sor-form-input"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
            )}
            {(provider === "scaleway" || provider === "ovhcloud") && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  Project Name <InfoTooltip text="The name of the project within your cloud provider account that contains the target resources." />
                </label>
                <input
                  type="text"
                  value={cloudProvider.projectName || ""}
                  onChange={(e) =>
                    updateCloudProvider({ projectName: e.target.value })
                  }
                  className="sor-form-input"
                  placeholder="my-project"
                />
              </div>
            )}
            {provider === "ovhcloud" && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  Service ID <InfoTooltip text="The OVHcloud service identifier for the target hosting or infrastructure resource." />
                </label>
                <input
                  type="text"
                  value={cloudProvider.serviceId || ""}
                  onChange={(e) =>
                    updateCloudProvider({ serviceId: e.target.value })
                  }
                  className="sor-form-input"
                  placeholder="Service identifier"
                />
              </div>
            )}
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
            Instance ID/Name <InfoTooltip text="The unique identifier or name of the cloud instance to connect to." />
          </label>
          <input
            type="text"
            value={cloudProvider.instanceId || cloudProvider.instanceName || ""}
            onChange={(e) =>
              updateCloudProvider({
                instanceId: e.target.value,
                instanceName: e.target.value,
              })
            }
            className="sor-form-input"
            placeholder="Instance ID or name"
          />
        </div>
      </div>
    </div>
  );
};

export default CloudProviderOptions;
