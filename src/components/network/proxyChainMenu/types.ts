import type { useProxyChainManager } from "../../../hooks/network/useProxyChainManager";

export interface ProxyChainMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export type Mgr = ReturnType<typeof useProxyChainManager>;
