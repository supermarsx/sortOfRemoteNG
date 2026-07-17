import React from "react";
import { Plus, Trash2, Copy, Edit2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TunnelChainManager } from "../../../hooks/network/useTunnelChainManager";
import {
  getTypeIcon,
  getTypeLabel,
  getProfileConfigSummary,
} from "./tunnelChainShared.helpers";

interface LayerProfilesTabProps {
  tunnelMgr: TunnelChainManager;
}

const LayerProfilesTab: React.FC<LayerProfilesTabProps> = ({ tunnelMgr }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text)]">
          {t("proxyChainMenu.layerProfiles.title", "Layer Profiles")}
        </h3>
        <button
          onClick={tunnelMgr.handleNewProfile}
          className="sor-btn-primary-sm"
        >
          <Plus size={14} />
          {t("proxyChainMenu.layerProfiles.newProfile", "New Profile")}
        </button>
      </div>

      <div className="text-sm text-[var(--color-textSecondary)]">
        {t(
          "proxyChainMenu.layerProfiles.description",
          "Reusable tunnel configurations. Add profiles to chains to compose complex multi-hop paths.",
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="sor-search-icon-abs" />
        <input
          type="text"
          value={tunnelMgr.profileSearch}
          onChange={(e) => tunnelMgr.setProfileSearch(e.target.value)}
          placeholder={t(
            "proxyChainMenu.layerProfiles.searchPlaceholder",
            "Search profiles...",
          )}
          className="sor-search-input"
        />
      </div>

      {/* Profile list */}
      <div className="space-y-2">
        {tunnelMgr.filteredProfiles.length === 0 ? (
          <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center">
            {tunnelMgr.profileSearch
              ? t(
                  "proxyChainMenu.layerProfiles.noMatches",
                  "No profiles match your search.",
                )
              : t(
                  "proxyChainMenu.layerProfiles.empty",
                  'No profiles saved. Click "New Profile" to create one.',
                )}
          </div>
        ) : (
          tunnelMgr.filteredProfiles.map((profile) => (
            <div key={profile.id} className="sor-selection-row">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--color-textSecondary)]">
                    {getTypeIcon(profile.type)}
                  </span>
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {profile.name}
                  </div>
                  <span className="sor-badge sor-badge-purple shrink-0">
                    {getTypeLabel(profile.type)}
                  </span>
                </div>
                {profile.description && (
                  <div className="text-xs text-[var(--color-textMuted)] mt-1 truncate">
                    {profile.description}
                  </div>
                )}
                <div className="text-xs text-[var(--color-textSecondary)] mt-1 font-mono truncate">
                  {getProfileConfigSummary(profile.config)}
                </div>
                {profile.tags && profile.tags.length > 0 && (
                  <div className="flex gap-1 mt-2">
                    {profile.tags.map((tag) => (
                      <span key={tag} className="sor-badge sor-badge-blue">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => tunnelMgr.handleDuplicateProfile(profile.id)}
                  className="sor-icon-btn"
                  title={t("proxyChainMenu.common.duplicate", "Duplicate")}
                >
                  <Copy size={14} />
                </button>
                <button
                  onClick={() => tunnelMgr.handleEditProfile(profile)}
                  className="sor-icon-btn"
                  title={t("proxyChainMenu.common.edit", "Edit")}
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => tunnelMgr.handleDeleteProfile(profile.id)}
                  className="sor-icon-btn-danger"
                  title={t("proxyChainMenu.common.delete", "Delete")}
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
};

export default LayerProfilesTab;
