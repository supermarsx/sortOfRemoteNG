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
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/40 hover:bg-gray-800/60 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <ShieldQuestion size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-300">
            Security Questions
          </span>
          {questions.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded-full">
              {questions.length}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-gray-700">
          <p className="text-xs text-gray-500">
            Store security questions and answers for this connection's account recovery.
          </p>

          {/* Existing questions */}
          {questions.map((sq, i) => (
            <div key={i} className="bg-gray-800 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-300">{sq.question}</span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => toggleReveal(i)}
                    className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                    title={revealedAnswers.has(i) ? 'Hide answer' : 'Show answer'}
                  >
                    {revealedAnswers.has(i) ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeQuestion(i)}
                    className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400 transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="font-mono text-[11px] text-gray-400 bg-gray-700/50 rounded px-2 py-1">
                {revealedAnswers.has(i) ? sq.answer : '••••••••'}
              </div>
            </div>
          ))}

          {/* Add new question */}
          <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
            <input
              type="text"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              placeholder="Security question"
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs text-white placeholder-gray-500"
            />
            <input
              type="text"
              value={newAnswer}
              onChange={(e) => setNewAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addQuestion(); }}
              placeholder="Answer"
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs text-white font-mono placeholder-gray-500"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={addQuestion}
                disabled={!newQuestion.trim() || !newAnswer.trim()}
                className="flex items-center space-x-1 px-2.5 py-1 text-[10px] bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-600 text-white rounded transition-colors"
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
