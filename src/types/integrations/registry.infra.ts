// Infrastructure-category integration descriptors (t42 Wave 1/2).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { netboxDescriptor } from "../../components/integrations/netbox/descriptor";
import { cpanelDescriptor } from "../../components/integrations/cpanel/descriptor";
import { ansibleDescriptor } from "../../components/integrations/ansible/descriptor";
import {
  lxdDescriptor,
  pfsenseDescriptor,
  vmwareDesktopDescriptor,
  vmwareDescriptor,
} from "../../components/integrations/descriptors";

export const infraIntegrations: IntegrationDescriptor[] = [
  lxdDescriptor,
  pfsenseDescriptor,
  netboxDescriptor,
  vmwareDesktopDescriptor,
  vmwareDescriptor,
  cpanelDescriptor,
  ansibleDescriptor,
];
