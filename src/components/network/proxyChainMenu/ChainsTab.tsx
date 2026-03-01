import { Mgr } from "./types";

function ChainsTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-6">
      {/* Saved Chains Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Saved Chains
          </h3>
          <button
            onClick={mgr.handleNewChain}
            className="sor-btn-primary-sm"
          >
            <Plus size={14} />
            New Chain
          </button>
        </div>

        <div className="text-sm text-[var(--color-textSecondary)]">
          Create reusable proxy chains that route traffic through multiple
          layers.
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-textSecondary)]" />
          <input
            type="text"
            value={mgr.chainSearch}
            onChange={(e) => mgr.setChainSearch(e.target.value)}
            placeholder="Search chains..."
            className="sor-search-input"
          />
        </div>

        {/* Saved Chains List */}
        <div className="space-y-2">
          {mgr.filteredSavedChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {mgr.chainSearch
                ? "No chains match your search."
                : 'No proxy chains saved. Click "New Chain" to create one.'}
            </div>
          ) : (
            mgr.filteredSavedChains.map((chain) => (
              <div
                key={chain.id}
                className="sor-selection-row"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {chain.name}
                    </div>
                    <span className="sor-badge sor-badge-purple">
                      {chain.layers.length} layer
                      {chain.layers.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {chain.description && (
                    <div className="text-xs text-[var(--color-textMuted)] mt-1">
                      {chain.description}
                    </div>
                  )}
                  <div className="text-xs text-[var(--color-textSecondary)] mt-1 font-mono">
                    {chain.layers.map((layer, i) => {
                      const profile = layer.proxyProfileId
                        ? mgr.savedProfiles.find(
                            (p) => p.id === layer.proxyProfileId,
                          )
                        : null;
                      return (
                        <span key={i}>
                          {i > 0 && " → "}
                          {layer.type === "proxy" && profile
                            ? `${profile.name}`
                            : layer.type}
                        </span>
                      );
                    })}
                  </div>
                  {chain.tags && chain.tags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {chain.tags.map((tag) => (
                        <span
                          key={tag}
                          className="sor-badge sor-badge-blue"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => mgr.handleDuplicateChain(chain.id)}
                    className="sor-icon-btn"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleEditChain(chain)}
                    className="sor-icon-btn"
                    title="Edit"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleDeleteChain(chain.id)}
                    className="sor-icon-btn-danger"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Active Chains Section */}
      <div className="border-t border-[var(--color-border)] pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Active Chains
          </h3>
          {mgr.isLoading && (
            <span className="text-xs text-[var(--color-textSecondary)]">
              Refreshing...
            </span>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-background)]/40 p-4">
          <div className="text-sm font-semibold text-[var(--color-textSecondary)] mb-3">
            Connection Chains
          </div>
          {mgr.connectionChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)]">
              No connection chains available.
            </div>
          ) : (
            mgr.connectionChains.map((chain) => (
              <div
                key={chain.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-3 py-2 mb-2 last:mb-0"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {chain.name}
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)]">
                    {chain.layers.length} layers · {chain.status}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {String(chain.status).toLowerCase() === "connected" ? (
                    <button
                      onClick={() => mgr.handleDisconnectChain(chain.id)}
                      className="px-3 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)]"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => mgr.handleConnectChain(chain.id)}
                      className="px-3 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)]/70 bg-[var(--color-background)]/40 p-4">
          <div className="text-sm font-semibold text-[var(--color-textSecondary)] mb-3">
            Proxy Chains
          </div>
          {mgr.proxyChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)]">
              No proxy chains available.
            </div>
          ) : (
            mgr.proxyChains.map((chain) => (
              <div
                key={chain.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-3 py-2 mb-2 last:mb-0"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {chain.name}
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)]">
                    {chain.layers.length} layers · {chain.status}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {String(chain.status).toLowerCase() === "connected" ? (
                    <button
                      onClick={() =>
                        mgr.handleDisconnectProxyChain(chain.id)
                      }
                      className="px-3 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)]"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => mgr.handleConnectProxyChain(chain.id)}
                      className="px-3 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default ChainsTab;
