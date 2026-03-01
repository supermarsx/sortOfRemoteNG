import { Plus, Trash2, Edit, Copy, Search } from "lucide-react";

function ProxiesTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-6">
      {/* Proxy Profiles Section */}
      <div className="sor-section-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Proxy Profiles
          </h3>
          <button
            onClick={mgr.handleNewProfile}
            className="sor-btn-primary-sm"
          >
            <Plus size={14} />
            New Profile
          </button>
        </div>
        <p className="text-sm text-[var(--color-textSecondary)] mb-4">
          Create and manage reusable proxy configurations that can be used
          across connections and chains.
        </p>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-textSecondary)]" />
          <input
            type="text"
            value={mgr.profileSearch}
            onChange={(e) => mgr.setProfileSearch(e.target.value)}
            placeholder="Search profiles..."
            className="sor-search-input"
          />
        </div>

        {/* Profile List */}
        <div className="space-y-2">
          {mgr.filteredProfiles.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {mgr.profileSearch
                ? "No profiles match your search."
                : 'No proxy profiles saved. Click "New Profile" to create one.'}
            </div>
          ) : (
            mgr.filteredProfiles.map((profile) => (
              <div
                key={profile.id}
                className="sor-selection-row"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {profile.name}
                    </div>
                    <span className="sor-badge sor-badge-purple uppercase">
                      {profile.config.type}
                    </span>
                    {profile.isDefault && (
                      <span className="sor-badge sor-badge-yellow">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)] mt-1 font-mono">
                    {profile.config.host}:{profile.config.port}
                    {profile.config.username &&
                      ` (${profile.config.username})`}
                  </div>
                  {profile.description && (
                    <div className="text-xs text-[var(--color-textMuted)] mt-1">
                      {profile.description}
                    </div>
                  )}
                  {profile.tags && profile.tags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {profile.tags.map((tag) => (
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
                    onClick={() => mgr.handleDuplicateProfile(profile.id)}
                    className="sor-icon-btn"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleEditProfile(profile)}
                    className="sor-icon-btn"
                    title="Edit"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => mgr.handleDeleteProfile(profile.id)}
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

      {/* Proxy Chains Section */}
      <div className="sor-section-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            Proxy Chains
          </h3>
          <button
            onClick={mgr.handleNewChain}
            className="sor-btn-primary-sm"
          >
            <Plus size={14} />
            New Chain
          </button>
        </div>
        <p className="text-sm text-[var(--color-textSecondary)] mb-4">
          Create reusable proxy chains that route traffic through multiple
          layers.
        </p>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-textSecondary)]" />
          <input
            type="text"
            value={mgr.chainSearch}
            onChange={(e) => mgr.setChainSearch(e.target.value)}
            placeholder="Search chains..."
            className="sor-search-input"
          />
        </div>

        {/* Chain List */}
        <div className="space-y-2">
          {mgr.filteredChains.length === 0 ? (
            <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
              {mgr.chainSearch
                ? "No chains match your search."
                : 'No proxy chains saved. Click "New Chain" to create one.'}
            </div>
          ) : (
            mgr.filteredChains.map((chain) => (
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
                            ? profile.name
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
                    <Edit size={14} />
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
    </div>
  );
}

export default ProxiesTab;
