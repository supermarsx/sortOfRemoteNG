import ScriptListItem from "./ScriptListItem";
import EmptyState from "../../ui/display/EmptyState";
import { useTranslation } from "react-i18next";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import { FileCode } from "lucide-react";

function ScriptList({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="w-80 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]">
      <div className="flex-1 overflow-y-auto">
        {mgr.filteredScripts.length === 0 ? (
          <EmptyState
            icon={FileCode}
            message={t('scriptManager.noScripts', 'No scripts found')}
            className="p-8"
          />
        ) : (
          <div className="p-2 space-y-1">
            {mgr.filteredScripts.map(script => (
              <ScriptListItem key={script.id} script={script} mgr={mgr} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ScriptList;
