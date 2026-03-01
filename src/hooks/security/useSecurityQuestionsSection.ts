import { useState, useCallback, useMemo } from 'react';
import { Connection, SecurityQuestion } from '../../types/connection';

export function useSecurityQuestionsSection(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
) {
  const [expanded, setExpanded] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());

  const questions = useMemo(() => formData.securityQuestions ?? [], [formData.securityQuestions]);

  const updateQuestions = useCallback(
    (updated: SecurityQuestion[]) => {
      setFormData((prev) => ({
        ...prev,
        securityQuestions: updated.length > 0 ? updated : undefined,
      }));
    },
    [setFormData],
  );

  const addQuestion = useCallback(() => {
    const q = newQuestion.trim();
    const a = newAnswer.trim();
    if (!q || !a) return;
    updateQuestions([...questions, { question: q, answer: a }]);
    setNewQuestion('');
    setNewAnswer('');
  }, [newQuestion, newAnswer, questions, updateQuestions]);

  const removeQuestion = useCallback(
    (index: number) => {
      const updated = [...questions];
      updated.splice(index, 1);
      setRevealedAnswers((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      updateQuestions(updated);
    },
    [questions, updateQuestions],
  );

  const toggleReveal = useCallback((index: number) => {
    setRevealedAnswers((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  return {
    expanded,
    setExpanded,
    newQuestion,
    setNewQuestion,
    newAnswer,
    setNewAnswer,
    revealedAnswers,
    questions,
    addQuestion,
    removeQuestion,
    toggleReveal,
  };
}
