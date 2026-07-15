import React, { useRef } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { WizardNavigation, WizardStep } from "./useWizardNavigation";

export type { WizardNavigation, WizardStep } from "./useWizardNavigation";

interface WizardProps {
  id: string;
  steps: WizardStep[];
  navigation: WizardNavigation;
  children: React.ReactNode;
  finalAction?: React.ReactNode;
  nextLabel?: string;
}

export const Wizard: React.FC<WizardProps> = ({
  id,
  steps,
  navigation,
  children,
  finalAction,
  nextLabel = "Next",
}) => {
  const stepButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentStep = steps[navigation.currentStepIndex];
  const currentError = navigation.stepErrors[navigation.currentStepId];
  const headingId = `${id}-page-heading`;

  const focusStep = (index: number) => {
    const normalized = (index + steps.length) % steps.length;
    stepButtonRefs.current[normalized]?.focus();
  };

  const onStepKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusStep(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusStep(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusStep(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusStep(steps.length - 1);
    }
  };

  return (
    <div className="space-y-5" data-testid={`${id}-wizard`}>
      <nav aria-label={`${id} progress`} className="overflow-x-auto pb-1">
        <ol className="grid min-w-max grid-flow-col auto-cols-[minmax(9rem,1fr)] gap-2 sm:min-w-0 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
          {steps.map((step, index) => {
            const isCurrent = step.id === navigation.currentStepId;
            const isCompleted = navigation.completedStepIds.has(step.id);
            const error = navigation.stepErrors[step.id];
            const canOpen =
              isCurrent || isCompleted || index < navigation.currentStepIndex;
            return (
              <li key={step.id}>
                <button
                  ref={(element) => {
                    stepButtonRefs.current[index] = element;
                  }}
                  type="button"
                  aria-current={isCurrent ? "step" : undefined}
                  aria-disabled={!canOpen}
                  aria-label={`Step ${index + 1}: ${step.label}${
                    error
                      ? `, error: ${error}`
                      : isCompleted
                        ? ", completed"
                        : ""
                  }`}
                  data-testid={`${id}-wizard-step-${step.id}`}
                  data-state={
                    error
                      ? "error"
                      : isCurrent
                        ? "current"
                        : isCompleted
                          ? "completed"
                          : "upcoming"
                  }
                  onClick={() => canOpen && navigation.goToStep(step.id)}
                  onKeyDown={(event) => onStepKeyDown(event, index)}
                  className={`h-full w-full rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    error
                      ? "border-error/60 bg-error/10"
                      : isCurrent
                        ? "border-primary bg-primary/10"
                        : isCompleted
                          ? "border-success/40 bg-success/5"
                          : "border-[var(--color-border)] bg-[var(--color-surface)]"
                  } ${canOpen ? "cursor-pointer" : "cursor-default opacity-70"}`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        error
                          ? "bg-error/20 text-error"
                          : isCompleted
                            ? "bg-success/20 text-success"
                            : isCurrent
                              ? "bg-primary text-[var(--color-text)]"
                              : "bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)]"
                      }`}
                      aria-hidden="true"
                    >
                      {error ? (
                        <AlertCircle size={14} />
                      ) : isCompleted ? (
                        <Check size={14} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-[var(--color-text)]">
                        {step.label}
                      </span>
                      <span className="mt-0.5 hidden truncate text-[10px] text-[var(--color-textMuted)] lg:block">
                        {step.description}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section
        aria-labelledby={headingId}
        data-testid={`${id}-wizard-page-${currentStep?.id}`}
      >
        {currentStep && (
          <div className="mb-4">
            <div className="text-xs font-medium uppercase tracking-wide text-primary">
              Step {navigation.currentStepIndex + 1} of {steps.length}
            </div>
            <h4
              id={headingId}
              className="mt-1 text-base font-semibold text-[var(--color-text)]"
            >
              {currentStep.label}
            </h4>
            <p className="mt-1 text-sm text-[var(--color-textSecondary)]">
              {currentStep.description}
            </p>
          </div>
        )}
        {children}
      </section>

      {currentError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-error/40 bg-error/10 p-3 text-sm text-error"
          data-testid={`${id}-wizard-error`}
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{currentError}</span>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={navigation.goBack}
          disabled={navigation.isFirstStep}
          data-testid={`${id}-wizard-back`}
          className="sor-btn-secondary inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} />
          Back
        </button>
        {navigation.isLastStep ? (
          finalAction
        ) : (
          <button
            type="button"
            onClick={navigation.goNext}
            data-testid={`${id}-wizard-next`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-primary/90"
          >
            {nextLabel}
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

export const WizardTemplateCard: React.FC<{
  title: string;
  description: string;
  onApply: () => void;
  testId?: string;
}> = ({ title, description, onApply, testId }) => (
  <button
    type="button"
    onClick={onApply}
    data-testid={testId}
    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  >
    <span className="block text-sm font-medium text-[var(--color-text)]">
      {title}
    </span>
    <span className="mt-1 block text-xs text-[var(--color-textMuted)]">
      {description}
    </span>
  </button>
);
