// Proxmox VE integration panel — placeholder stub created by t67-e3 so the
// descriptor resolves for tsc/reachability. t67-e4 replaces this with the real
// adapter around `src/components/proxmox/ProxmoxPanel.tsx`.
import type { IntegrationPanelProps } from "../../../types/integrations/registry";

export default function ProxmoxIntegrationPanel({
  isOpen,
}: IntegrationPanelProps) {
  if (!isOpen) return null;
  return (
    <div data-testid="proxmox-integration-panel">Proxmox VE (loading)</div>
  );
}
