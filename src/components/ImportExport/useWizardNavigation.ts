import { useCallback, useEffect, useRef, useState } from "react";

export interface WizardStep {
  id: string;
  label: string;
  description: string;
}

type StepErrors = Record<string, string | undefined>;

export interface WizardNavigation {
  currentStepId: string;
  currentStepIndex: number;
  completedStepIds: ReadonlySet<string>;
  stepErrors: StepErrors;
  isFirstStep: boolean;
  isLastStep: boolean;
  goBack: () => void;
  goNext: () => boolean;
  goToStep: (stepId: string) => void;
  clearStepError: (stepId?: string) => void;
}

/**
 * Keeps paging state independent from the form values owned by each tab.
 * The id-based state is important: conditional steps can appear/disappear
 * without leaving stale numeric positions or gaps in the visible stepper.
 */
export const useWizardNavigation = (
  steps: WizardStep[],
  validateStep: (stepId: string) => string | undefined,
  initialStepId = steps[0]?.id ?? "",
): WizardNavigation => {
  const [currentStepId, setCurrentStepId] = useState(initialStepId);
  const [completedStepIds, setCompletedStepIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [stepErrors, setStepErrors] = useState<StepErrors>({});
  const previousStepsRef = useRef(steps);

  useEffect(() => {
    if (steps.length === 0) return;

    if (!steps.some((step) => step.id === currentStepId)) {
      const previousIndex = Math.max(
        0,
        previousStepsRef.current.findIndex((step) => step.id === currentStepId),
      );
      setCurrentStepId(steps[Math.min(previousIndex, steps.length - 1)].id);
    }

    const visibleIds = new Set(steps.map((step) => step.id));
    setCompletedStepIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      if (next.size === current.size) return current;
      return next;
    });
    setStepErrors((current) => {
      const visibleEntries = Object.entries(current).filter(([id]) =>
        visibleIds.has(id),
      );
      return visibleEntries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(visibleEntries);
    });
    previousStepsRef.current = steps;
  }, [currentStepId, steps]);

  const currentStepIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === currentStepId),
  );

  const clearStepError = useCallback(
    (stepId = currentStepId) => {
      setStepErrors((current) => {
        if (!current[stepId]) return current;
        return { ...current, [stepId]: undefined };
      });
    },
    [currentStepId],
  );

  const goNext = useCallback(() => {
    const error = validateStep(currentStepId);
    if (error) {
      setStepErrors((current) => ({ ...current, [currentStepId]: error }));
      return false;
    }

    setStepErrors((current) => ({ ...current, [currentStepId]: undefined }));
    setCompletedStepIds((current) => new Set(current).add(currentStepId));
    const nextStep = steps[currentStepIndex + 1];
    if (nextStep) setCurrentStepId(nextStep.id);
    return true;
  }, [currentStepId, currentStepIndex, steps, validateStep]);

  const goBack = useCallback(() => {
    const previousStep = steps[currentStepIndex - 1];
    if (previousStep) setCurrentStepId(previousStep.id);
  }, [currentStepIndex, steps]);

  const goToStep = useCallback(
    (stepId: string) => {
      if (
        stepId === currentStepId ||
        completedStepIds.has(stepId) ||
        steps.findIndex((step) => step.id === stepId) < currentStepIndex
      ) {
        setCurrentStepId(stepId);
      }
    },
    [completedStepIds, currentStepId, currentStepIndex, steps],
  );

  return {
    currentStepId,
    currentStepIndex,
    completedStepIds,
    stepErrors,
    isFirstStep: currentStepIndex === 0,
    isLastStep: currentStepIndex === steps.length - 1,
    goBack,
    goNext,
    goToStep,
    clearStepError,
  };
};
