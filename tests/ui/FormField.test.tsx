import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "../../src/components/ui/forms/FormField";

describe("FormField", () => {
  it("renders label text", () => {
    render(
      <FormField label="Username">
        <input />
      </FormField>,
    );
    expect(screen.getByText("Username")).toBeTruthy();
  });

  it("renders children", () => {
    render(
      <FormField label="Email">
        <input data-testid="email-input" />
      </FormField>,
    );
    expect(screen.getByTestId("email-input")).toBeTruthy();
  });

  it("associates label with input via htmlFor", () => {
    render(
      <FormField label="Password" htmlFor="pw">
        <input id="pw" />
      </FormField>,
    );
    const label = screen.getByText("Password");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "pw");
  });

  it("shows required indicator when required is true", () => {
    render(
      <FormField label="Name" required>
        <input />
      </FormField>,
    );
    expect(screen.getByText("*")).toBeTruthy();
  });

  it("does not show required indicator when required is false", () => {
    render(
      <FormField label="Name">
        <input />
      </FormField>,
    );
    expect(screen.queryByText("*")).toBeNull();
  });

  it("renders error message when error prop is provided", () => {
    render(
      <FormField label="Email" error="Invalid email">
        <input />
      </FormField>,
    );
    expect(screen.getByText("Invalid email")).toBeTruthy();
  });

  it("renders hint text when hint prop is provided and no error", () => {
    render(
      <FormField label="Bio" hint="Max 200 characters">
        <input />
      </FormField>,
    );
    expect(screen.getByText("Max 200 characters")).toBeTruthy();
  });

  it("shows error instead of hint when both are provided", () => {
    render(
      <FormField label="Bio" hint="Max 200 characters" error="Too long">
        <input />
      </FormField>,
    );
    expect(screen.getByText("Too long")).toBeTruthy();
    expect(screen.queryByText("Max 200 characters")).toBeNull();
  });

  it("applies inline layout class when layout is inline", () => {
    render(
      <FormField label="Toggle" layout="inline">
        <input type="checkbox" />
      </FormField>,
    );
    const label = screen.getByText("Toggle");
    expect(label.className).toContain("sor-form-field-inline-label");
  });
});
