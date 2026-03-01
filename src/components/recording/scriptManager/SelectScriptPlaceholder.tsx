
function SelectScriptPlaceholder({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={FolderOpen}
      iconSize={48}
      message={t('scriptManager.selectScript', 'Select a script')}
      hint={t('scriptManager.selectScriptHint', 'Choose a script from the list to view or edit')}
      className="flex-1"
    >
      <button
        onClick={mgr.handleNewScript}
        className="inline-flex items-center gap-2 px-4 py-2 mt-4 text-sm bg-purple-600 hover:bg-purple-700 text-[var(--color-text)] rounded-lg transition-colors"
      >
        <Plus size={14} />
        {t('scriptManager.createNew', 'Create New Script')}
      </button>
    </EmptyState>
  );
}

export default SelectScriptPlaceholder;
