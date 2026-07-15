import { useMemo, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Wizard } from "../../src/components/ImportExport/Wizard";
import {
  useWizardNavigation,
  type WizardStep,
} from "../../src/components/ImportExport/useWizardNavigation";

const WizardHarness = ({ onFinish = vi.fn() }: { onFinish?: () => void }) => {
  const [name, setName] = useState("");
  const [showOptional, setShowOptional] = useState(true);
  const steps = useMemo<WizardStep[]>(
    () => [
      { id: "details", label: "Details", description: "Enter details." },
      ...(showOptional
        ? [
            {
              id: "optional",
              label: "Optional",
              description: "Optional settings.",
            },
          ]
        : []),
      { id: "review", label: "Review", description: "Confirm the result." },
    ],
    [showOptional],
  );
  const navigation = useWizardNavigation(steps, (stepId) =>
    stepId === "details" && !name ? "A name is required." : undefined,
  );

  return (
    <Wizard
      id="test"
      steps={steps}
      navigation={navigation}
      finalAction={
        <button type="button" data-testid="finish" onClick={onFinish}>
          Finish
        </button>
      }
    >
      {navigation.currentStepId === "details" && (
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      )}
      {navigation.currentStepId === "optional" && (
        <button type="button" onClick={() => setShowOptional(false)}>
          Remove optional step
        </button>
      )}
      {navigation.currentStepId === "review" && <div>Reviewing {name}</div>}
    </Wizard>
  );
};

describe("Import/export Wizard", () => {
  it("validates each page, preserves state through Back, and exposes the final action only on review", () => {
    const onFinish = vi.fn();
    render(<WizardHarness onFinish={onFinish} />);

    expect(screen.queryByTestId("finish")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("test-wizard-next"));
    expect(screen.getByTestId("test-wizard-error")).toHaveTextContent(
      "A name is required.",
    );
    expect(screen.getByTestId("test-wizard-step-details")).toHaveAttribute(
      "data-state",
      "error",
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Preserved value" },
    });
    fireEvent.click(screen.getByTestId("test-wizard-next"));
    expect(screen.getByTestId("test-wizard-step-details")).toHaveAttribute(
      "data-state",
      "completed",
    );
    fireEvent.click(screen.getByTestId("test-wizard-back"));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Preserved value",
    );

    fireEvent.click(screen.getByTestId("test-wizard-next"));
    fireEvent.click(screen.getByTestId("test-wizard-next"));
    expect(screen.getByText("Reviewing Preserved value")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("finish"));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("recomputes numbering without gaps when the current conditional step disappears", async () => {
    render(<WizardHarness />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Dynamic" },
    });
    fireEvent.click(screen.getByTestId("test-wizard-next"));
    expect(screen.getByTestId("test-wizard-page-optional")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove optional step" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("test-wizard-page-review")).toBeInTheDocument();
    });
    expect(screen.getByTestId("test-wizard-step-review")).toHaveAttribute(
      "aria-label",
      "Step 2: Review",
    );
    expect(
      screen.queryByTestId("test-wizard-step-optional"),
    ).not.toBeInTheDocument();
  });

  it("supports arrow, Home, and End keyboard focus across the progress steps", () => {
    render(<WizardHarness />);
    const details = screen.getByTestId("test-wizard-step-details");
    const optional = screen.getByTestId("test-wizard-step-optional");
    const review = screen.getByTestId("test-wizard-step-review");

    details.focus();
    fireEvent.keyDown(details, { key: "ArrowRight" });
    expect(optional).toHaveFocus();
    fireEvent.keyDown(optional, { key: "End" });
    expect(review).toHaveFocus();
    fireEvent.keyDown(review, { key: "Home" });
    expect(details).toHaveFocus();
  });
});
