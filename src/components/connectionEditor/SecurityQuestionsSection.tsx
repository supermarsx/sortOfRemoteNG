import React, { useState } from 'react';
import { ShieldQuestion, ChevronDown, ChevronUp, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { Connection, SecurityQuestion } from '../../types/connection';

interface SecurityQuestionsSectionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const SecurityQuestionsSection: React.FC<SecurityQuestionsSectionProps> = ({ formData, setFormData }) => {
  const [expanded, setExpanded] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());

  if (formData.isGroup) return null;

  const questions = formData.securityQuestions ?? [];

  const updateQuestions = (updated: SecurityQuestion[]) => {
    setFormData(prev => ({ ...prev, securityQuestions: updated.length > 0 ? updated : undefined }));
  };

  const addQuestion = () => {
    const q = newQuestion.trim();
    const a = newAnswer.trim();
    if (!q || !a) return;
    updateQuestions([...questions, { question: q, answer: a }]);
    setNewQuestion('');
    setNewAnswer('');
  };

  const removeQuestion = (index: number) => {
    const updated = [...questions];
    updated.splice(index, 1);
    revealedAnswers.delete(index);
    setRevealedAnswers(new Set(revealedAnswers));
    updateQuestions(updated);
  };

  const toggleReveal = (index: number) => {
    const next = new Set(revealedAnswers);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setRevealedAnswers(next);
  };

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-surface)]/40 hover:bg-[var(--color-surface)]/60 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <ShieldQuestion size={16} className="text-[var(--color-textSecondary)]" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            Security Questions
          </span>
          {questions.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-full">
              {questions.length}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-[var(--color-textSecondary)]" /> : <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />}
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-[var(--color-border)]">
          <p className="text-xs text-gray-500">
            Store security questions and answers for this connection's account recovery.
          </p>

          {/* Existing questions */}
          {questions.map((sq, i) => (
            <div key={i} className="bg-[var(--color-surface)] rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-textSecondary)]">{sq.question}</span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => toggleReveal(i)}
                    className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
                    title={revealedAnswers.has(i) ? 'Hide answer' : 'Show answer'}
                  >
                    {revealedAnswers.has(i) ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeQuestion(i)}
                    className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-red-400 transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="font-mono text-[11px] text-[var(--color-textSecondary)] bg-[var(--color-border)]/50 rounded px-2 py-1">
                {revealedAnswers.has(i) ? sq.answer : '••••••••'}
              </div>
            </div>
          ))}

          {/* Add new question */}
          <div className="bg-[var(--color-surface)]/50 rounded-lg p-3 space-y-2">
            <input
              type="text"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              placeholder="Security question"
              className="w-full px-2 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] placeholder-gray-500"
            />
            <input
              type="text"
              value={newAnswer}
              onChange={(e) => setNewAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addQuestion(); }}
              placeholder="Answer"
              className="w-full px-2 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] font-mono placeholder-gray-500"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={addQuestion}
                disabled={!newQuestion.trim() || !newAnswer.trim()}
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
