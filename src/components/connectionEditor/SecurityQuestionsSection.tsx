import React from 'react';
import { ShieldQuestion, ChevronDown, ChevronUp, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { Connection } from '../../types/connection';
import { useSecurityQuestionsSection } from '../../hooks/security/useSecurityQuestionsSection';

type Mgr = ReturnType<typeof useSecurityQuestionsSection>;

interface SecurityQuestionsSectionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const SecurityQuestionsSection: React.FC<SecurityQuestionsSectionProps> = ({ formData, setFormData }) => {
  const mgr = useSecurityQuestionsSection(formData, setFormData);

  if (formData.isGroup) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => mgr.setExpanded(!mgr.expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-surface)]/40 hover:bg-[var(--color-surface)]/60 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <ShieldQuestion size={16} className="text-[var(--color-textSecondary)]" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            Security Questions
          </span>
          {mgr.questions.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-full">
              {mgr.questions.length}
            </span>
          )}
        </div>
        {mgr.expanded ? <ChevronUp size={14} className="text-[var(--color-textSecondary)]" /> : <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />}
      </button>

      {mgr.expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-[var(--color-border)]">
          <p className="text-xs text-gray-500">
            Store security questions and answers for this connection's account recovery.
          </p>

          {/* Existing questions */}
          {mgr.questions.map((sq, i) => (
            <div key={i} className="bg-[var(--color-surface)] rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-textSecondary)]">{sq.question}</span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => mgr.toggleReveal(i)}
                    className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
                    title={mgr.revealedAnswers.has(i) ? 'Hide answer' : 'Show answer'}
                  >
                    {mgr.revealedAnswers.has(i) ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => mgr.removeQuestion(i)}
                    className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-red-400 transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="font-mono text-[11px] text-[var(--color-textSecondary)] bg-[var(--color-border)]/50 rounded px-2 py-1">
                {mgr.revealedAnswers.has(i) ? sq.answer : '••••••••'}
              </div>
            </div>
          ))}

          {/* Add new question */}
          <div className="bg-[var(--color-surface)]/50 rounded-lg p-3 space-y-2">
            <input
              type="text"
              value={mgr.newQuestion}
              onChange={(e) => mgr.setNewQuestion(e.target.value)}
              placeholder="Security question"
              className="w-full px-2 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] placeholder-gray-500"
            />
            <input
              type="text"
              value={mgr.newAnswer}
              onChange={(e) => mgr.setNewAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') mgr.addQuestion(); }}
              placeholder="Answer"
              className="w-full px-2 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] font-mono placeholder-gray-500"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={mgr.addQuestion}
                disabled={!mgr.newQuestion.trim() || !mgr.newAnswer.trim()}
                className="flex items-center space-x-1 px-2.5 py-1 text-[10px] bg-gray-600 hover:bg-gray-500 disabled:bg-[var(--color-border)] disabled:text-gray-600 text-[var(--color-text)] rounded transition-colors"
              >
                <Plus size={10} />
                <span>Add</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityQuestionsSection;
