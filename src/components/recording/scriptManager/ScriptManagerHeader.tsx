
import DialogHeader from "../../ui/overlays/DialogHeader";
import { useTranslation } from "react-i18next";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import { FileCode } from "lucide-react";
function ScriptManagerHeader({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <DialogHeader
      icon={FileCode}
      iconColor="text-purple-600 dark:text-purple-400"
      iconBg="bg-purple-500/20"
      title={t('scriptManager.title', 'Script Manager')}
      badge={`${mgr.filteredScripts.length} ${t('scriptManager.scripts', 'scripts')}`}
      onClose={mgr.onClose}
      sticky
    />
  );
}

export default ScriptManagerHeader;
