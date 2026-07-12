// Infrastructure-category integration descriptors (t42 Wave 1/2).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { lxdDescriptor } from "../../components/integrations/lxd/LxdPanel";
import { pfsenseDescriptor } from "../../components/integrations/pfsense/PfsensePanel";
import { netboxDescriptor } from "../../components/integrations/netbox/descriptor";
import { vmwareDesktopDescriptor } from "../../components/integrations/vmwareDesktop/VmwareDesktopPanel";
import { vmwareDescriptor } from "../../components/integrations/VmwarePanel";
import { cpanelDescriptor } from "../../components/integrations/cpanel/descriptor";

export const infraIntegrations: IntegrationDescriptor[] = [
  lxdDescriptor,
  pfsenseDescriptor,
  netboxDescriptor,
  vmwareDesktopDescriptor,
  vmwareDescriptor,
  cpanelDescriptor,
];
