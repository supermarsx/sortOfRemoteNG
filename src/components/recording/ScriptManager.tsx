/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { useScriptManager } from "../../hooks/recording/useScriptManager";
import FilterToolbar from "./scriptManager/FilterToolbar";
import ScriptList from "./scriptManager/ScriptList";
import DetailPane from "./scriptManager/DetailPane";

// Re-export shared types and constants for backward compatibility
export type { ManagedScript, ScriptLanguage, OSTag } from "./scriptManager/shared";
export { SCRIPTS_STORAGE_KEY, getDefaultScripts, OS_TAG_LABELS, OS_TAG_ICONS, languageLabels, languageIcons } from "./scriptManager/shared";

interface ScriptManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ScriptManager: React.FC<ScriptManagerProps> = ({ isOpen, onClose }) => {
  const mgr = useScriptManager(onClose);

  if (!isOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <FilterToolbar mgr={mgr} />
      <div className="flex-1 flex overflow-hidden">
        <ScriptList mgr={mgr} />
        <DetailPane mgr={mgr} />
      </div>
    </div>
  );
};

