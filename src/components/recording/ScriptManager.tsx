import React from 'react';
import { useScriptManager } from "../../hooks/recording/useScriptManager";
import Modal from "../ui/overlays/Modal";
import ScriptManagerHeader from "./scriptManager/ScriptManagerHeader";
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      backdropClassName="bg-black/50"
      panelClassName="sor-manager-panel max-w-5xl mx-4 relative"
    >
      {/* Background glow effects - only show in dark mode */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:opacity-100 opacity-0">
        <div className="absolute top-[20%] left-[15%] w-80 h-80 bg-purple-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-[25%] right-[10%] w-72 h-72 bg-blue-500/6 rounded-full blur-3xl" />
        <div className="absolute top-[60%] left-[40%] w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-surface)]">
        <ScriptManagerHeader mgr={mgr} />
        <FilterToolbar mgr={mgr} />
        <div className="flex-1 flex overflow-hidden">
          <ScriptList mgr={mgr} />
          <DetailPane mgr={mgr} />
        </div>
      </div>
    </Modal>
  );
};

