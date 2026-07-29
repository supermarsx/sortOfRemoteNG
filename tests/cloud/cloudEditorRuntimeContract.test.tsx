import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CloudProviderOptions from "../../src/components/connectionEditor/CloudProviderOptions";
import type { Connection } from "../../src/types/connection/connection";
import {
  inspectOvhCloudCredentialBundle,
  normalizeCloudConnectionForEditor,
  normalizeCloudConnectionForPersistence,
  type CloudConnectionProtocol,
} from "../../src/utils/connection/cloudConnectionContract";
import {
  azureRuntimeAdapter,
  digitalOceanRuntimeAdapter,
  gcpRuntimeAdapter,
  herokuRuntimeAdapter,
  ibmCloudRuntimeAdapter,
  linodeRuntimeAdapter,
  ovhCloudRuntimeAdapter,
  scalewayRuntimeAdapter,
  type CloudRuntimeAdapter,
} from "../../src/utils/session/cloudRuntimeAdapters";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/components/ui/forms", () => ({
  PasswordInput: ({
    revealable: _revealable,
    isSaved: _isSaved,
    ...props
  }: any) => <input type="password" {...props} />,
}));
vi.mock("../../src/components/ui/InfoTooltip", () => ({
  InfoTooltip: () => null,
}));

const invokeMock = vi.mocked(invoke);
let latestForm!: Partial<Connection>;

const baseConnection: Omit<Connection, "protocol"> = {
  id: "cloud-editor-contract",
  name: "Cloud account",
  hostname: "",
  port: 0,
  isGroup: false,
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

const renderCloudEditor = (
  protocol: CloudConnectionProtocol,
  initial: Partial<Connection> = {},
) => {
  const Harness = () => {
    const [formData, setFormData] = useState<Partial<Connection>>({
      ...baseConnection,
      protocol,
      ...initial,
    });
    latestForm = formData;
    return (
      <CloudProviderOptions
        formData={formData}
        setFormData={setFormData}
      />
    );
  };

  render(<Harness />);
  return () =>
    normalizeCloudConnectionForPersistence(latestForm) as Connection;
};

const enter = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), {
    target: { value },
  });
};

interface CloudEditorContractCase {
  protocol: CloudConnectionProtocol;
  adapter: CloudRuntimeAdapter;
  fields: readonly (readonly [label: string, value: string])[];
  settingsKey: keyof Connection;
  expectedSettings: Record<string, unknown>;
  expectedPassword: string;
  secrets: readonly string[];
  expectedCalls: readonly (readonly [string, Record<string, unknown>?])[];
}

const contractCases: readonly CloudEditorContractCase[] = [
  {
    protocol: "gcp",
    adapter: gcpRuntimeAdapter,
    fields: [
      ["Project ID", "project-a"],
      ["Region", "europe-west1"],
      ["Zone", "europe-west1-b"],
      ["OAuth Scopes", "scope-a, scope-b"],
      ["API Endpoint Override", "https://gcp.example.test"],
      [
        "Service Account JSON",
        '{"type":"service_account","private_key":"gcp-secret"}',
      ],
    ],
    settingsKey: "gcpSettings",
    expectedSettings: {
      projectId: "project-a",
      region: "europe-west1",
      zone: "europe-west1-b",
      scopes: ["scope-a", "scope-b"],
      endpointOverride: "https://gcp.example.test",
    },
    expectedPassword:
      '{"type":"service_account","private_key":"gcp-secret"}',
    secrets: ["gcp-secret"],
    expectedCalls: [
      [
        "connect_gcp",
        {
          config: {
            project_id: "project-a",
            service_account_key:
              '{"type":"service_account","private_key":"gcp-secret"}',
            region: "europe-west1",
            zone: "europe-west1-b",
            scopes: ["scope-a", "scope-b"],
            endpoint_override: "https://gcp.example.test",
          },
        },
      ],
    ],
  },
  {
    protocol: "azure",
    adapter: azureRuntimeAdapter,
    fields: [
      ["Tenant ID", "tenant-a"],
      ["Client ID", "client-a"],
      ["Subscription ID", "subscription-a"],
      ["Default Resource Group", "rg-a"],
      ["Default Region", "westeurope"],
      ["Client Secret", "azure-secret"],
    ],
    settingsKey: "azureSettings",
    expectedSettings: {
      tenantId: "tenant-a",
      clientId: "client-a",
      subscriptionId: "subscription-a",
      defaultResourceGroup: "rg-a",
      defaultRegion: "westeurope",
    },
    expectedPassword: "azure-secret",
    secrets: ["azure-secret"],
    expectedCalls: [
      [
        "azure_set_credentials",
        {
          tenantId: "tenant-a",
          clientId: "client-a",
          clientSecret: "azure-secret",
          subscriptionId: "subscription-a",
          defaultResourceGroup: "rg-a",
          defaultRegion: "westeurope",
        },
      ],
      ["azure_authenticate"],
    ],
  },
  {
    protocol: "digital-ocean",
    adapter: digitalOceanRuntimeAdapter,
    fields: [
      ["API Token", "do-secret"],
      ["Region", "lon1"],
    ],
    settingsKey: "digitalOceanSettings",
    expectedSettings: { region: "lon1" },
    expectedPassword: "do-secret",
    secrets: ["do-secret"],
    expectedCalls: [
      [
        "connect_digital_ocean",
        { config: { api_token: "do-secret", region: "lon1" } },
      ],
    ],
  },
  {
    protocol: "ibm-csp",
    adapter: ibmCloudRuntimeAdapter,
    fields: [
      ["API Key", "ibm-secret"],
      ["Region", "eu-gb"],
      ["Resource Group", "resource-group-a"],
    ],
    settingsKey: "ibmCloudSettings",
    expectedSettings: {
      region: "eu-gb",
      resourceGroup: "resource-group-a",
    },
    expectedPassword: "ibm-secret",
    secrets: ["ibm-secret"],
    expectedCalls: [
      [
        "connect_ibm",
        {
          config: {
            api_key: "ibm-secret",
            region: "eu-gb",
            resource_group: "resource-group-a",
          },
        },
      ],
    ],
  },
  {
    protocol: "heroku",
    adapter: herokuRuntimeAdapter,
    fields: [
      ["API Key", "heroku-secret"],
      ["App Name", "app-a"],
      ["Region", "eu"],
    ],
    settingsKey: "herokuSettings",
    expectedSettings: { appName: "app-a", region: "eu" },
    expectedPassword: "heroku-secret",
    secrets: ["heroku-secret"],
    expectedCalls: [
      [
        "connect_heroku",
        {
          config: {
            api_key: "heroku-secret",
            app_name: "app-a",
            region: "eu",
          },
        },
      ],
    ],
  },
  {
    protocol: "scaleway",
    adapter: scalewayRuntimeAdapter,
    fields: [
      ["API Key", "scaleway-secret"],
      ["Organization ID", "organization-a"],
      ["Project Name", "project-a"],
      ["Region", "fr-par"],
    ],
    settingsKey: "scalewaySettings",
    expectedSettings: {
      organizationId: "organization-a",
      projectName: "project-a",
      region: "fr-par",
    },
    expectedPassword: "scaleway-secret",
    secrets: ["scaleway-secret"],
    expectedCalls: [
      [
        "connect_scaleway",
        {
          config: {
            api_key: "scaleway-secret",
            organization_id: "organization-a",
            project_name: "project-a",
            region: "fr-par",
          },
        },
      ],
    ],
  },
  {
    protocol: "linode",
    adapter: linodeRuntimeAdapter,
    fields: [
      ["API Key", "linode-secret"],
      ["Region", "eu-west"],
    ],
    settingsKey: "linodeSettings",
    expectedSettings: { region: "eu-west" },
    expectedPassword: "linode-secret",
    secrets: ["linode-secret"],
    expectedCalls: [
      [
        "connect_linode",
        { config: { api_key: "linode-secret", region: "eu-west" } },
      ],
    ],
  },
  {
    protocol: "ovhcloud",
    adapter: ovhCloudRuntimeAdapter,
    fields: [
      ["OVHcloud API Key", "ovh-api-key"],
      ["Application Secret", "ovh-app-secret"],
      ["Consumer Key", "ovh-consumer-key"],
      ["Service ID", "service-a"],
      ["Project Name", "project-a"],
      ["Region", "GRA11"],
    ],
    settingsKey: "ovhCloudSettings",
    expectedSettings: {
      serviceId: "service-a",
      projectName: "project-a",
      region: "GRA11",
    },
    expectedPassword:
      '{"apiKey":"ovh-api-key","appSecret":"ovh-app-secret","consumerKey":"ovh-consumer-key"}',
    secrets: ["ovh-api-key", "ovh-app-secret", "ovh-consumer-key"],
    expectedCalls: [
      [
        "connect_ovh",
        {
          config: {
            api_key: "ovh-api-key",
            app_secret: "ovh-app-secret",
            consumer_key: "ovh-consumer-key",
            service_id: "service-a",
            project_name: "project-a",
            region: "GRA11",
          },
        },
      ],
    ],
  },
];

describe("cloud editor to runtime contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => "cloud-session");
  });

  it.each(contractCases)(
    "$protocol persists only adapter settings and invokes the matching command",
    async (testCase) => {
      const savedConnection = renderCloudEditor(testCase.protocol);
      for (const [label, value] of testCase.fields) enter(label, value);

      const saved = savedConnection();
      expect(saved.cloudProvider).toBeUndefined();
      expect(saved[testCase.settingsKey]).toEqual(testCase.expectedSettings);
      expect(saved.password).toBe(testCase.expectedPassword);

      const outsideProtectedCredential = {
        ...saved,
        password: undefined,
      };
      for (const secret of testCase.secrets) {
        expect(JSON.stringify(outsideProtectedCredential)).not.toContain(
          secret,
        );
      }

      expect(testCase.adapter.validate(saved)).toBeNull();
      await testCase.adapter.connect(saved);
      expect(invokeMock.mock.calls).toEqual(testCase.expectedCalls);
    },
  );
});

describe("legacy cloud migration and OVHcloud recovery", () => {
  it.each([
    {
      protocol: "gcp",
      legacy: {
        provider: "gcp",
        projectId: "legacy-project",
        region: "legacy-region",
        zone: "legacy-zone",
        serviceAccountKey: "legacy-gcp-secret",
      },
      settingsKey: "gcpSettings",
      expectedSettings: {
        projectId: "legacy-project",
        region: "legacy-region",
        zone: "legacy-zone",
      },
      expectedPassword: "legacy-gcp-secret",
    },
    {
      protocol: "azure",
      legacy: {
        provider: "azure",
        tenantId: "legacy-tenant",
        clientId: "legacy-client",
        subscriptionId: "legacy-subscription",
        resourceGroup: "legacy-rg",
        region: "legacy-region",
        clientSecret: "legacy-azure-secret",
      },
      settingsKey: "azureSettings",
      expectedSettings: {
        tenantId: "legacy-tenant",
        clientId: "legacy-client",
        subscriptionId: "legacy-subscription",
        defaultResourceGroup: "legacy-rg",
        defaultRegion: "legacy-region",
      },
      expectedPassword: "legacy-azure-secret",
    },
    {
      protocol: "digital-ocean",
      legacy: {
        provider: "digital-ocean",
        apiKey: "legacy-do-secret",
        region: "legacy-region",
      },
      settingsKey: "digitalOceanSettings",
      expectedSettings: { region: "legacy-region" },
      expectedPassword: "legacy-do-secret",
    },
    {
      protocol: "ibm-csp",
      legacy: {
        provider: "ibm-csp",
        apiKey: "legacy-ibm-secret",
        region: "legacy-region",
        projectName: "legacy-resource-group",
      },
      settingsKey: "ibmCloudSettings",
      expectedSettings: {
        region: "legacy-region",
        resourceGroup: "legacy-resource-group",
      },
      expectedPassword: "legacy-ibm-secret",
    },
    {
      protocol: "heroku",
      legacy: {
        provider: "heroku",
        apiKey: "legacy-heroku-secret",
        appName: "legacy-app",
        region: "legacy-region",
        dynoName: "retired-dyno",
      },
      settingsKey: "herokuSettings",
      expectedSettings: {
        appName: "legacy-app",
        region: "legacy-region",
      },
      expectedPassword: "legacy-heroku-secret",
    },
    {
      protocol: "scaleway",
      legacy: {
        provider: "scaleway",
        apiKey: "legacy-scaleway-secret",
        organizationId: "legacy-org",
        projectName: "legacy-project",
        region: "legacy-region",
      },
      settingsKey: "scalewaySettings",
      expectedSettings: {
        organizationId: "legacy-org",
        projectName: "legacy-project",
        region: "legacy-region",
      },
      expectedPassword: "legacy-scaleway-secret",
    },
    {
      protocol: "linode",
      legacy: {
        provider: "linode",
        apiKey: "legacy-linode-secret",
        region: "legacy-region",
      },
      settingsKey: "linodeSettings",
      expectedSettings: { region: "legacy-region" },
      expectedPassword: "legacy-linode-secret",
    },
    {
      protocol: "ovhcloud",
      legacy: {
        provider: "ovhcloud",
        apiKey: "legacy-ovh-key",
        appSecret: "legacy-ovh-secret",
        consumerKey: "legacy-ovh-consumer",
        serviceId: "legacy-service",
        projectName: "legacy-project",
        region: "legacy-region",
      },
      settingsKey: "ovhCloudSettings",
      expectedSettings: {
        serviceId: "legacy-service",
        projectName: "legacy-project",
        region: "legacy-region",
      },
      expectedPassword:
        '{"apiKey":"legacy-ovh-key","appSecret":"legacy-ovh-secret","consumerKey":"legacy-ovh-consumer"}',
    },
  ] as const)(
    "migrates $protocol without retaining the legacy provider object",
    ({ protocol, legacy, settingsKey, expectedSettings, expectedPassword }) => {
      const normalized = normalizeCloudConnectionForEditor({
        ...baseConnection,
        protocol,
        cloudProvider: legacy,
      } as Connection);

      expect(normalized.cloudProvider).toBeUndefined();
      expect(normalized[settingsKey]).toMatchObject(expectedSettings);
      expect(normalized.password).toBe(expectedPassword);
      expect(
        JSON.stringify({ ...normalized, password: undefined }),
      ).not.toContain(expectedPassword);
      expect(JSON.stringify(normalized)).not.toContain("retired-dyno");
    },
  );

  it("masks malformed OVHcloud JSON and replaces it with a complete bundle", () => {
    const readSaved = renderCloudEditor("ovhcloud", {
      password: "{malformed-legacy-json",
      cloudProvider: {
        provider: "ovhcloud",
        apiKey: "legacy-value-must-not-leak",
      },
    });

    expect(
      inspectOvhCloudCredentialBundle("{malformed-legacy-json").status,
    ).toBe("malformed");
    expect(screen.getByRole("alert")).toHaveTextContent(
      /raw value remains masked/i,
    );
    for (const label of [
      "OVHcloud API Key",
      "Application Secret",
      "Consumer Key",
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
    expect(
      screen.queryByDisplayValue("{malformed-legacy-json"),
    ).not.toBeInTheDocument();

    enter("OVHcloud API Key", "replacement-key");
    enter("Application Secret", "replacement-secret");
    enter("Consumer Key", "replacement-consumer");

    const saved = readSaved();
    expect(inspectOvhCloudCredentialBundle(saved.password)).toEqual({
      status: "valid",
      credentials: {
        apiKey: "replacement-key",
        appSecret: "replacement-secret",
        consumerKey: "replacement-consumer",
      },
    });
    expect(saved.cloudProvider).toBeUndefined();
    expect(JSON.stringify(saved.ovhCloudSettings)).not.toContain(
      "replacement",
    );
    expect(
      JSON.stringify({ ...saved, password: undefined }),
    ).not.toContain("replacement");
  });
});
