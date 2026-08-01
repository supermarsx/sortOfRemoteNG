import { describe, expect, it } from "vitest";

import {
  builtInCloudRuntimeRegistry,
  findBuiltInCloudRuntime,
} from "../../src/utils/session/builtInCloudRuntimeRegistry";

describe("built-in cloud route registry", () => {
  it("publishes explicit provider metadata for every routed panel", () => {
    const expected = [
      {
        protocol: "gcp",
        label: "Google Cloud",
        description:
          "Manage Google Cloud resources with a saved service account.",
        frontendPath: "src/components/cloud/GcpSessionPanel.tsx",
        backendPath: "src-tauri/crates/sorng-gcp",
        testPath: "tests/cloud/CloudSessionPanel.test.tsx",
      },
      {
        protocol: "azure",
        label: "Microsoft Azure",
        description: "Manage Azure resources with a saved service principal.",
        frontendPath: "src/components/cloud/AzureSessionPanel.tsx",
        backendPath: "src-tauri/crates/sorng-azure",
        testPath: "tests/cloud/CloudSessionPanel.test.tsx",
      },
      {
        protocol: "digital-ocean",
        label: "DigitalOcean",
        description: "Manage DigitalOcean resources with a saved API token.",
        frontendPath: "src/components/cloud/DigitalOceanSessionPanel.tsx",
        backendPath: "src-tauri/crates/sorng-cloud",
        testPath: "tests/cloud/CloudSessionPanel.test.tsx",
      },
      {
        protocol: "ibm-csp",
        label: "IBM Cloud",
        description: "Manage IBM Cloud resources with a saved API key.",
        frontendPath: "src/components/cloud/IbmCloudSessionPanel.tsx",
        backendPath: "src-tauri/crates/sorng-cloud",
        testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
      },
      {
        protocol: "heroku",
        label: "Heroku",
        description: "Manage Heroku applications with a saved API key.",
        frontendPath: "src/components/cloud/HerokuSessionPanel.tsx",
        backendPath: "src-tauri/crates/sorng-cloud",
        testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
      },
      {
        protocol: "scaleway",
        label: "Scaleway",
        description: "Manage Scaleway resources with a saved API key.",
        frontendPath: "src/components/cloud/ScalewaySessionPanel.tsx",
        backendPath: "src-tauri/crates/sorng-cloud",
        testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
      },
      {
        protocol: "linode",
        label: "Linode",
        description: "Manage Linode resources with a saved API key.",
        frontendPath: "src/components/cloud/LinodeSessionPanel.tsx",
        backendPath: "src-tauri/crates/sorng-cloud",
        testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
      },
      {
        protocol: "ovhcloud",
        label: "OVHcloud",
        description:
          "Manage OVHcloud resources with protected API credentials.",
        frontendPath: "src/components/cloud/OvhCloudSessionPanel.tsx",
        backendPath: "src-tauri/crates/sorng-cloud",
        testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
      },
    ] as const;

    expect(builtInCloudRuntimeRegistry.map(({ protocol }) => protocol)).toEqual(
      expected.map(({ protocol }) => protocol),
    );
    for (const metadata of expected) {
      const descriptor = findBuiltInCloudRuntime(metadata.protocol);
      expect(descriptor).toMatchObject({
        ...metadata,
        category: "cloud",
      });
      expect(descriptor?.icon).toBeDefined();
    }
  });

  it("lazy-loads every registered cloud session panel", async () => {
    for (const descriptor of builtInCloudRuntimeRegistry) {
      expect(descriptor.category).toBe("cloud");
      const panelModule = await descriptor.importPanel();
      expect(panelModule.default, descriptor.protocol).toBeTypeOf("function");
    }
  });
});
