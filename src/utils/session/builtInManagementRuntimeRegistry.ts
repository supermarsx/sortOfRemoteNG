import type { ComponentType } from "react";
import type {
  BuiltInConnectionProtocol,
  ConnectionSession,
} from "../../types/connection/connection";
import type { ConnectionTypeCategory } from "../../types/integrations/registry";
import type { IdracSessionPanelProps } from "../../components/idrac/IdracSessionPanel";

export interface BuiltInManagementRuntimeDescriptor<
  Protocol extends BuiltInConnectionProtocol = BuiltInConnectionProtocol,
> {
  protocol: Protocol;
  label: string;
  category: ConnectionTypeCategory;
  frontendPath: string;
  backendPath: string;
  testPath: string;
  importPanel: () => Promise<{
    default: ComponentType<BuiltInManagementSessionPanelProps>;
  }>;
}

export interface BuiltInManagementSessionPanelProps {
  session: ConnectionSession;
  onClose?: () => void;
}

export const idracRuntimeDescriptor = {
  protocol: "idrac",
  label: "Dell iDRAC",
  category: "lights-out",
  frontendPath: "src/components/idrac/IdracSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-idrac",
  testPath: "tests/idrac/IdracSessionPanel.test.tsx",
  importPanel: () => import("../../components/idrac/IdracSessionPanel"),
} satisfies BuiltInManagementRuntimeDescriptor<"idrac"> & {
  importPanel: () => Promise<{
    default: ComponentType<IdracSessionPanelProps>;
  }>;
};

export const iloRuntimeDescriptor = {
  protocol: "ilo",
  label: "HPE iLO",
  category: "lights-out",
  frontendPath: "src/components/hardware/IloSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-ilo",
  testPath: "tests/hardware/BmcSessionPanel.test.tsx",
  importPanel: () => import("../../components/hardware/IloSessionPanel"),
} satisfies BuiltInManagementRuntimeDescriptor<"ilo">;

export const lenovoRuntimeDescriptor = {
  protocol: "lenovo",
  label: "Lenovo XClarity",
  category: "lights-out",
  frontendPath: "src/components/hardware/LenovoSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-lenovo",
  testPath: "tests/hardware/BmcSessionPanel.test.tsx",
  importPanel: () => import("../../components/hardware/LenovoSessionPanel"),
} satisfies BuiltInManagementRuntimeDescriptor<"lenovo">;

export const supermicroRuntimeDescriptor = {
  protocol: "supermicro",
  label: "Supermicro BMC",
  category: "lights-out",
  frontendPath: "src/components/hardware/SupermicroSessionPanel.tsx",
  backendPath: "src-tauri/crates/sorng-supermicro",
  testPath: "tests/hardware/BmcSessionPanel.test.tsx",
  importPanel: () => import("../../components/hardware/SupermicroSessionPanel"),
} satisfies BuiltInManagementRuntimeDescriptor<"supermicro">;

export const builtInManagementRuntimeRegistry = [
  idracRuntimeDescriptor,
  iloRuntimeDescriptor,
  lenovoRuntimeDescriptor,
  supermicroRuntimeDescriptor,
] as const;

export function findBuiltInManagementRuntime(
  protocol: string,
): BuiltInManagementRuntimeDescriptor | undefined {
  return builtInManagementRuntimeRegistry.find(
    (descriptor) => descriptor.protocol === protocol,
  );
}

export type BuiltInManagementRuntimeProtocol =
  (typeof builtInManagementRuntimeRegistry)[number]["protocol"];

interface BuiltInManagementRuntimeLease {
  sessionId: string;
  teardownPromise: Promise<void> | null;
}

const activeRuntimeLeases = new Map<
  BuiltInManagementRuntimeProtocol,
  BuiltInManagementRuntimeLease
>();

export function claimBuiltInManagementRuntime(
  protocol: BuiltInManagementRuntimeProtocol,
  sessionId: string,
): boolean {
  const lease = activeRuntimeLeases.get(protocol);
  if (lease) return lease.sessionId === sessionId;
  activeRuntimeLeases.set(protocol, { sessionId, teardownPromise: null });
  return true;
}

export function teardownBuiltInManagementRuntime(
  protocol: BuiltInManagementRuntimeProtocol,
  sessionId: string,
  disconnect: () => Promise<unknown>,
): Promise<void> {
  const lease = activeRuntimeLeases.get(protocol);
  if (!lease || lease.sessionId !== sessionId) return Promise.resolve();
  if (lease.teardownPromise) return lease.teardownPromise;

  const teardownPromise = Promise.resolve()
    .then(disconnect)
    .then(() => {
      if (activeRuntimeLeases.get(protocol) === lease) {
        activeRuntimeLeases.delete(protocol);
      }
    });
  lease.teardownPromise = teardownPromise.catch((error) => {
    if (activeRuntimeLeases.get(protocol) === lease) {
      lease.teardownPromise = null;
    }
    throw error;
  });
  return lease.teardownPromise;
}

export function resetBuiltInManagementRuntimeLeasesForTests(): void {
  activeRuntimeLeases.clear();
}

/**
 * The registered native iDRAC service is process-global and its command family
 * has no session-id argument. Fail closed rather than allowing a second tab to
 * overwrite the first tab's device and credentials.
 */
export function claimIdracRuntime(sessionId: string): boolean {
  return claimBuiltInManagementRuntime("idrac", sessionId);
}

/**
 * Start or join the lease's teardown. The lease stays occupied until the
 * disconnect settles, including handled failure, so another tab cannot connect
 * while the process-global native service is still shutting down.
 */
export function teardownIdracRuntime(
  sessionId: string,
  disconnect: () => Promise<unknown>,
): Promise<void> {
  return teardownBuiltInManagementRuntime("idrac", sessionId, disconnect);
}

export function resetIdracRuntimeLeaseForTests(): void {
  resetBuiltInManagementRuntimeLeasesForTests();
}
