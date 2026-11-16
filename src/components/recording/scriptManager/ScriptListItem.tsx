import { useState } from "react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import MenuSurface from "../../ui/overlays/MenuSurface";
import { ManagedScript, languageLabels, OS_TAG_LABELS } from "./shared";
import { ScriptMetadataIcon } from "./ScriptMetadataIcon";
import AutomationSourceBadge from "./AutomationSourceBadge";
import { scriptOrigin } from "./scriptOrigins";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";

function ScriptListItem({
  script,
  mgr,
}: {
  script: ManagedScript;
  mgr: ScriptManagerMgr;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      onClick={() => mgr.handleSelectScript(script)}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      className={`p-3 rounded-lg cursor-pointer transition-colors group ${
        mgr.selectedScript?.id === script.id
          ? "bg-primary/20 border border-accent/40"
          : "hover:bg-[var(--color-surfaceHover)] border border-transparent"
      }`}
    >
      <div className="flex items-start gap-2">
        <ScriptMetadataIcon language={script.language} size={20} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[var(--color-text)] truncate">
              {script.name}
            </span>
            <AutomationSourceBadge
              source={scriptOrigin(
                script,
                mgr.snapshot?.entries.find(
                  (entry) => entry.payload.id === script.id,
                )?.provenance,
              )}
            />
          </div>
          {script.description && (
            <p className="text-xs text-[var(--color-textSecondary)] truncate mt-0.5">
              {script.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)] rounded">
              {script.category}
            </span>
            <span className="text-[10px] text-[var(--color-textMuted)]">
              {languageLabels[script.language]}
            </span>
            {script.osTags && script.osTags.length > 0 && (
              <div className="flex items-center gap-0.5">
                {script.osTags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px]"
                    title={OS_TAG_LABELS[tag]}
                  >
                    <ScriptMetadataIcon platform={tag} size={12} />
                  </span>
                ))}
                {script.osTags.length > 3 && (
                  <span className="text-[10px] text-[var(--color-textMuted)]">
                    +{script.osTags.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <MenuSurface
        isOpen={!!menu}
        onClose={() => setMenu(null)}
        position={menu}
        className="w-48 rounded-lg py-1"
        ariaLabel={t("scriptFavorites.scriptActions", "Script actions")}
      >
        <button
          type="button"
          role="menuitem"
          className="sor-menu-item text-xs py-1.5"
          disabled={mgr.busy}
          onClick={(event) => {
            event.stopPropagation();
            setMenu(null);
            mgr.handleEditScript(script);
          }}
        >
          <Pencil size={12} /> {t("scriptFavorites.edit", "Edit")}
        </button>
      </MenuSurface>
    </div>
  );
}

export default ScriptListItem;
