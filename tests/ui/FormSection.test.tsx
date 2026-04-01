import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormSection } from "../../src/components/ui/forms/FormSection";

describe("FormSection", () => {
  it("renders children content", () => {
    render(
      <FormSection>
        <p data-testid="child">Hello</p>
      </FormSection>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("renders title when provided", () => {
    render(
      <FormSection title="General Settings">
        <p>content</p>
      </FormSection>,
    );
    expect(screen.getByText("General Settings")).toBeTruthy();
  });

  it("does not render heading when no title is provided", () => {
    const { container } = render(
      <FormSection>
        <p>content</p>
      </FormSection>,
    );
    expect(container.querySelector(".sor-form-section-heading")).toBeNull();
  });

  it("renders description below the title", () => {
    render(
      <FormSection title="Network" description="Configure network settings">
        <p>content</p>
      </FormSection>,
    );
    expect(screen.getByText("Configure network settings")).toBeTruthy();
  });

  it("renders icon before the title", () => {
    render(
      <FormSection title="Security" icon={<span data-testid="icon">🔒</span>}>
        <p>content</p>
      </FormSection>,
    );
    expect(screen.getByTestId("icon")).toBeTruthy();
    // Icon should appear before the title text
    const heading = screen.getByText("Security").closest(".sor-form-section-heading")!;
    expect(heading.querySelector("[data-testid='icon']")).toBeTruthy();
  });

  it("applies sm gap class", () => {
    const { container } = render(
      <FormSection gap="sm">
        <p>a</p>
        <p>b</p>
      </FormSection>,
    );
    expect(container.firstElementChild?.classList.contains("space-y-2")).toBe(true);
  });

  it("applies md gap class by default", () => {
    const { container } = render(
      <FormSection>
        <p>a</p>
      </FormSection>,
    );
    expect(container.firstElementChild?.classList.contains("space-y-4")).toBe(true);
  });

  it("applies lg gap class", () => {
    const { container } = render(
      <FormSection gap="lg">
        <p>a</p>
      </FormSection>,
    );
    expect(container.firstElementChild?.classList.contains("space-y-6")).toBe(true);
  });
});
