import { Mgr } from "./types";
import type { Connection } from "../../../types/connection";
import { Select } from "../../ui/forms";

function AssociationsTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-[var(--color-textSecondary)]">
        Associate chains with individual connections. These choices will be used
        when launching sessions.
      </div>
      <div className="space-y-3">
        {mgr.connectionOptions.map((connection) => (
          <div
            key={connection.id}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]/40 p-3"
          >
            <div className="text-sm font-medium text-[var(--color-text)] mb-2">
              {connection.name}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Connection Chain
                </label>
                <Select value={connection.connectionChainId || ""} onChange={(v: string) =>
                    mgr.updateConnectionChain(connection.id, v)} options={[{ value: '', label: 'None' }, ...mgr.connectionChains.map((chain) => ({ value: chain.id, label: chain.name }))]} className="sor-form-input" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Proxy Chain
                </label>
                <Select value={connection.proxyChainId || ""} onChange={(v: string) =>
                    mgr.updateProxyChain(connection.id, v)} options={[{ value: '', label: 'None' }, ...mgr.proxyChains.map((chain) => ({ value: chain.id, label: chain.name }))]} className="sor-form-input" />
              </div>
            </div>
          </div>
        ))}
        {mgr.connectionOptions.length === 0 && (
          <div className="text-sm text-[var(--color-textSecondary)]">
            No connections available.
          </div>
        )}
      </div>
    </div>
  );
}


export default AssociationsTab;
