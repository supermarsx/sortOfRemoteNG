import type { ComponentType } from "react";
import { Cloud, type LucideIcon } from "lucide-react";

import type {
  BuiltInConnectionProtocol,
  ConnectionSession,
} from "../../types/connection/connection";
import type { ConnectionTypeCategory } from "../../types/integrations/registry";

export type BuiltInCloudRuntimeProtocol = Extract<
  BuiltInConnectionProtocol,
  | "gcp"
  | "azure"
  | "digital-ocean"
  | "ibm-csp"
  | "heroku"
  | "scaleway"
  | "linode"
  | "ovhcloud"
>;

export interface BuiltInCloudSessionPanelProps {
  session: ConnectionSession;
  onClose?: () => void;
}

export interface BuiltInCloudRuntimeDescriptor<
  Protocol extends BuiltInCloudRuntimeProtocol = BuiltInCloudRuntimeProtocol,
> {
  protocol: Protocol;
  label: string;
  description: string;
  icon: LucideIcon;
  category: ConnectionTypeCategory;
  frontendPath: string;
  backendPath: string;
  testPath: string;
  importPanel: () => Promise<{
    default: ComponentType<BuiltInCloudSessionPanelProps>;
  }>;
}

export const gcpRuntimeDescriptor = {
  protocol: "gcp",
  label: "Google Cloud",
  description: "Manage Google Cloud resources with a saved service account.",
  icon: Cloud,
  category: "cloud",
  frontendPath: "src/components/cloud/GcpSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-gcp",
  testPath: "tests/cloud/CloudSessionPanel.test.tsx",
  importPanel: () => import("../../components/cloud/GcpSessionPanel"),
} satisfies BuiltInCloudRuntimeDescriptor<"gcp">;

export const azureRuntimeDescriptor = {
  protocol: "azure",
  label: "Microsoft Azure",
  description: "Manage Azure resources with a saved service principal.",
  icon: Cloud,
  category: "cloud",
  frontendPath: "src/components/cloud/AzureSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-azure",
  testPath: "tests/cloud/CloudSessionPanel.test.tsx",
  importPanel: () => import("../../components/cloud/AzureSessionPanel"),
} satisfies BuiltInCloudRuntimeDescriptor<"azure">;

export const digitalOceanRuntimeDescriptor = {
  protocol: "digital-ocean",
  label: "DigitalOcean",
  description: "Manage DigitalOcean resources with a saved API token.",
  icon: Cloud,
  category: "cloud",
  frontendPath: "src/components/cloud/DigitalOceanSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-cloud",
  testPath: "tests/cloud/CloudSessionPanel.test.tsx",
  importPanel: () => import("../../components/cloud/DigitalOceanSessionPanel"),
} satisfies BuiltInCloudRuntimeDescriptor<"digital-ocean">;

export const ibmCloudRuntimeDescriptor = {
  protocol: "ibm-csp",
  label: "IBM Cloud",
  description: "Manage IBM Cloud resources with a saved API key.",
  icon: Cloud,
  category: "cloud",
  frontendPath: "src/components/cloud/IbmCloudSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-cloud",
  testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
  importPanel: () => import("../../components/cloud/IbmCloudSessionPanel"),
} satisfies BuiltInCloudRuntimeDescriptor<"ibm-csp">;

export const herokuRuntimeDescriptor = {
  protocol: "heroku",
  label: "Heroku",
  description: "Manage Heroku applications with a saved API key.",
  icon: Cloud,
  category: "cloud",
  frontendPath: "src/components/cloud/HerokuSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-cloud",
  testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
  importPanel: () => import("../../components/cloud/HerokuSessionPanel"),
} satisfies BuiltInCloudRuntimeDescriptor<"heroku">;

export const scalewayRuntimeDescriptor = {
  protocol: "scaleway",
  label: "Scaleway",
  description: "Manage Scaleway resources with a saved API key.",
  icon: Cloud,
  category: "cloud",
  frontendPath: "src/components/cloud/ScalewaySessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-cloud",
  testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
  importPanel: () => import("../../components/cloud/ScalewaySessionPanel"),
} satisfies BuiltInCloudRuntimeDescriptor<"scaleway">;

export const linodeRuntimeDescriptor = {
  protocol: "linode",
  label: "Linode",
  description: "Manage Linode resources with a saved API key.",
  icon: Cloud,
  category: "cloud",
  frontendPath: "src/components/cloud/LinodeSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-cloud",
  testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
  importPanel: () => import("../../components/cloud/LinodeSessionPanel"),
} satisfies BuiltInCloudRuntimeDescriptor<"linode">;

export const ovhCloudRuntimeDescriptor = {
  protocol: "ovhcloud",
  label: "OVHcloud",
  description: "Manage OVHcloud resources with protected API credentials.",
  icon: Cloud,
  category: "cloud",
  frontendPath: "src/components/cloud/OvhCloudSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-cloud",
  testPath: "tests/cloud/CloudProviderSessionPanels.test.tsx",
  importPanel: () => import("../../components/cloud/OvhCloudSessionPanel"),
} satisfies BuiltInCloudRuntimeDescriptor<"ovhcloud">;
export const builtInCloudRuntimeRegistry = [
  gcpRuntimeDescriptor,
  azureRuntimeDescriptor,
  digitalOceanRuntimeDescriptor,
  ibmCloudRuntimeDescriptor,
  herokuRuntimeDescriptor,
  scalewayRuntimeDescriptor,
  linodeRuntimeDescriptor,
  ovhCloudRuntimeDescriptor,
] as const;

export function findBuiltInCloudRuntime(
  protocol: string,
): BuiltInCloudRuntimeDescriptor | undefined {
  return builtInCloudRuntimeRegistry.find(
    (descriptor) => descriptor.protocol === protocol,
  );
}

export interface BuiltInCloudRuntimeHandle {
  backendSessionId?: string;
}

interface CloudRuntimeLease {
  sessionId: string;
  connectPromise: Promise<BuiltInCloudRuntimeHandle> | null;
  teardownPromise: Promise<void> | null;
}

const runtimeLeases = new Map<string, CloudRuntimeLease>();

function leaseKey(
  protocol: BuiltInCloudRuntimeProtocol,
  sessionId: string,
): string {
  return protocol === "azure" ? protocol : `${protocol}:${sessionId}`;
}

export function claimBuiltInCloudRuntime(
  protocol: BuiltInCloudRuntimeProtocol,
  sessionId: string,
): boolean {
  const key = leaseKey(protocol, sessionId);
  const current = runtimeLeases.get(key);
  if (current) {
    return current.sessionId === sessionId && !current.teardownPromise;
  }
  runtimeLeases.set(key, {
    sessionId,
    connectPromise: null,
    teardownPromise: null,
  });
  return true;
}

export function connectBuiltInCloudRuntime(
  protocol: BuiltInCloudRuntimeProtocol,
  sessionId: string,
  connect: () => Promise<BuiltInCloudRuntimeHandle>,
): Promise<BuiltInCloudRuntimeHandle> {
  const lease = runtimeLeases.get(leaseKey(protocol, sessionId));
  if (!lease || lease.sessionId !== sessionId || lease.teardownPromise) {
    return Promise.reject(new Error(`${protocol} runtime is not available`));
  }
  if (!lease.connectPromise) {
    lease.connectPromise = Promise.resolve().then(connect);
  }
  return lease.connectPromise;
}

export function teardownBuiltInCloudRuntime(
  protocol: BuiltInCloudRuntimeProtocol,
  sessionId: string,
  disconnect: (
    handle: BuiltInCloudRuntimeHandle | undefined,
  ) => Promise<unknown>,
): Promise<void> {
  const key = leaseKey(protocol, sessionId);
  const lease = runtimeLeases.get(key);
  if (!lease || lease.sessionId !== sessionId) return Promise.resolve();
  if (lease.teardownPromise) return lease.teardownPromise;

  const teardownPromise = Promise.resolve()
    .then(async () => {
      let handle: BuiltInCloudRuntimeHandle | undefined;
      try {
        handle = (await lease.connectPromise) ?? undefined;
      } catch {
        // Azure still needs token cleanup after failed authentication.
      }
      await disconnect(handle);
    })
    .then(() => {
      if (runtimeLeases.get(key) === lease) runtimeLeases.delete(key);
    });
  lease.teardownPromise = teardownPromise.catch((error) => {
    if (runtimeLeases.get(key) === lease) {
      lease.teardownPromise = null;
    }
    throw error;
  });
  return lease.teardownPromise;
}

export function resetBuiltInCloudRuntimeLeasesForTests(): void {
  runtimeLeases.clear();
}
