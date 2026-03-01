import { Mgr } from "./types";

function ProfilesTab({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text)]">
          Saved Proxy Profiles
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={mgr.handleImportProfiles}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            title="Import Profiles"
          >
            <Upload size={12} />
            Import
          </button>
          <button
            onClick={mgr.handleExportProfiles}
            className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            title="Export Profiles"
          >
            <Download size={12} />
            Export
          </button>
          <button
            onClick={mgr.handleNewProfile}
            className="sor-btn-primary-sm"
          >
            <Plus size={14} />
            New Profile
          </button>
        </div>
      </div>

      <div className="text-sm text-[var(--color-textSecondary)]">
        Create and manage reusable proxy configurations that can be used across
        connections and chains.
      </div>

      {/* Search */}
      <div className="relative">
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
          <div className="text-sm text-[var(--color-textSecondary)] py-8 text-center">
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
                  <Edit2 size={14} />
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
  );
}

export default ProfilesTab;
