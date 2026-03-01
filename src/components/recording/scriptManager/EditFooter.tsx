
function EditFooter({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="border-t border-[var(--color-border)] px-5 py-3 flex items-center justify-end gap-3 bg-[var(--color-surface)]">
      <button
        onClick={mgr.handleCancelEdit}
        className="sor-btn-secondary"
      >
        {t('common.cancel', 'Cancel')}
      </button>
      <button
        onClick={mgr.handleSaveScript}
        disabled={!mgr.editName.trim() || !mgr.editScript.trim()}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-[var(--color-surfaceHover)] disabled:opacity-50 text-[var(--color-text)] rounded-lg transition-colors"
      >
        <Save size={14} />
        {t('common.save', 'Save')}
      </button>
    </div>
  );
}

export default EditFooter;
