import React, { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  PasswordInput,
  PasswordInputProps,
} from "../../src/components/ui/forms/PasswordInput";
import { Modal } from "../../src/components/ui/overlays/Modal";

vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openGenerator() {
  const trigger = screen.getByRole("button", { name: "Generate password" });
  fireEvent.click(trigger);
  await screen.findByRole("dialog", { name: "Generate password" });
  return trigger;
}

const proposal = () =>
  screen.getByLabelText("Proposed password") as HTMLTextAreaElement;

describe("password generator shared input integration", () => {
  it("keeps the generator inside its parent modal's accessible subtree", async () => {
    const cancel = vi.fn();
    render(
      <Modal isOpen onClose={cancel} ariaLabel="Edit credentials">
        <PasswordInput generateable aria-label="Password" />
      </Modal>,
    );
    await openGenerator();
    const parent = screen.getByRole("dialog", { name: "Edit credentials" });
    const generator = screen.getByRole("dialog", { name: "Generate password" });
    expect(parent).toContainElement(generator);
    const length = screen.getByRole("spinbutton", { name: "Length" });
    await waitFor(() => expect(length).toHaveFocus());
    fireEvent.keyDown(length, { key: "Escape" });
    expect(cancel).not.toHaveBeenCalled();
    expect(parent).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Generate password" }),
    ).not.toBeInTheDocument();
  });

  it("discards drafts on outside dismissal and resets session settings without persisting them", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(
      <PasswordInput generateable aria-label="Password" defaultValue="old" />,
    );
    const trigger = await openGenerator();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), {
      target: { value: "30" },
    });
    expect(proposal().value).toHaveLength(30);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("old");
    expect(trigger).toHaveFocus();
    await openGenerator();
    expect(proposal().value).toHaveLength(20);
    expect(storage).not.toHaveBeenCalled();
  });

  it("removes an open generator when the destination becomes read-only", async () => {
    const changed = vi.fn();
    const { rerender } = render(
      <PasswordInput
        generateable
        aria-label="Password"
        value="old"
        onChange={changed}
      />,
    );
    await openGenerator();
    rerender(
      <PasswordInput
        generateable
        readOnly
        aria-label="Password"
        value="old"
        onChange={changed}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("old");
    expect(changed).not.toHaveBeenCalled();
  });
  it("applies only on explicit Use through controlled change and input handlers, preserving ref and name", async () => {
    const ref = createRef<HTMLInputElement>();
    const changed = vi.fn();
    const input = vi.fn();
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
    function Form() {
      const [value, setValue] = useState("existing-password");
      return (
        <form onSubmit={submitted}>
          <PasswordInput
            generateable
            ref={ref}
            aria-label="Account password"
            name="password"
            value={value}
            onInput={input}
            onChange={(event) => {
              changed(event.target.name, event.target.value);
              setValue(event.target.value);
            }}
          />
        </form>
      );
    }
    render(<Form />);
    await openGenerator();
    expect(ref.current).toBe(screen.getByLabelText("Account password"));
    expect(ref.current).toHaveValue("existing-password");
    expect(changed).not.toHaveBeenCalled();
    const generated = proposal().value;
    expect(generated).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Use password" }));
    expect(ref.current).toHaveValue(generated);
    expect(changed).toHaveBeenCalledExactlyOnceWith("password", generated);
    expect(input).toHaveBeenCalledTimes(1);
    expect(ref.current).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(submitted).not.toHaveBeenCalled();
  });

  it("updates an uncontrolled field and its form value", async () => {
    const ref = vi.fn();
    render(
      <form aria-label="Credentials">
        <PasswordInput
          generateable
          ref={ref}
          aria-label="Password"
          name="secret"
          defaultValue="old"
        />
      </form>,
    );
    await openGenerator();
    const generated = proposal().value;
    fireEvent.click(screen.getByRole("button", { name: "Use password" }));
    const field = screen.getByLabelText("Password");
    expect(ref).toHaveBeenCalledWith(field);
    expect(field).toHaveValue(generated);
    expect(
      new FormData(screen.getByRole("form") as HTMLFormElement).get("secret"),
    ).toBe(generated);
  });

  it.each(["Cancel", "Escape"])(
    "%s preserves the value and returns focus without closing a parent modal",
    async (action) => {
      const parentEscape = vi.fn();
      document.addEventListener("keydown", parentEscape);
      try {
        const changed = vi.fn();
        render(
          <PasswordInput
            generateable
            aria-label="Password"
            defaultValue="old"
            onChange={changed}
          />,
        );
        const trigger = await openGenerator();
        expect(trigger).not.toHaveAttribute("title");
        expect(trigger).toHaveAttribute("aria-expanded", "true");
        await waitFor(() =>
          expect(
            screen.getByRole("spinbutton", { name: "Length" }),
          ).toHaveFocus(),
        );
        if (action === "Cancel")
          fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        else fireEvent.keyDown(document.activeElement!, { key: "Escape" });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByLabelText("Password")).toHaveValue("old");
        expect(changed).not.toHaveBeenCalled();
        expect(parentEscape).not.toHaveBeenCalled();
        expect(trigger).toHaveFocus();
        expect(trigger).toHaveAttribute("aria-expanded", "false");
      } finally {
        document.removeEventListener("keydown", parentEscape);
      }
    },
  );

  it("contains keyboard focus and prevents Enter in settings from submitting the surrounding form", async () => {
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submitted}>
        <PasswordInput generateable aria-label="Password" />
      </form>,
    );
    await openGenerator();
    const length = screen.getByRole("spinbutton", { name: "Length" });
    await waitFor(() => expect(length).toHaveFocus());
    expect(fireEvent.keyDown(length, { key: "Enter", cancelable: true })).toBe(
      false,
    );
    fireEvent.keyDown(length, { key: "Tab", shiftKey: true });
    const use = screen.getByRole("button", { name: "Use password" });
    expect(use).toHaveFocus();
    fireEvent.keyDown(use, { key: "Tab" });
    expect(length).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(submitted).not.toHaveBeenCalled();
  });

  it("writes to the clipboard only after Copy, and does not apply the copied draft", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), { clipboard: { writeText } }),
    );
    render(
      <PasswordInput generateable aria-label="Password" defaultValue="old" />,
    );
    await openGenerator();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(writeText).not.toHaveBeenCalled();
    const generated = proposal().value;
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Password copied."),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(generated);
    expect(screen.getByLabelText("Password")).toHaveValue("old");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it.each<PasswordInputProps>([
    {},
    { generateable: false },
    { generateable: true, disabled: true },
    { generateable: true, readOnly: true },
    { generateable: true, autoComplete: "one-time-code" },
    { generateable: true, value: "fixed" },
  ])("omits generation for an ineligible field (%j)", (props) => {
    render(<PasswordInput aria-label="Secret" {...props} />);
    expect(
      screen.queryByRole("button", { name: "Generate password" }),
    ).not.toBeInTheDocument();
  });

  it("clears invalid drafts, explains the error, and restores a usable draft after correction", async () => {
    render(
      <PasswordInput generateable aria-label="Password" defaultValue="old" />,
    );
    await openGenerator();
    const length = screen.getByRole("spinbutton", { name: "Length" });
    fireEvent.change(length, { target: { value: "7" } });
    expect(screen.getByRole("alert")).toHaveTextContent("whole-number length");
    expect(length).toHaveAttribute("aria-invalid", "true");
    expect(proposal()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Use password" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    fireEvent.change(length, { target: { value: "12" } });
    expect(proposal().value).toHaveLength(12);
    for (const name of [/Lowercase/, /Uppercase/, /Digits/, /Symbols/])
      fireEvent.click(screen.getByRole("checkbox", { name }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "at least one character type",
    );
    expect(proposal()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Use password" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Digits/ }));
    expect(proposal().value).toMatch(/^[2-9]{12}$/);
    expect(screen.getByRole("button", { name: "Use password" })).toBeEnabled();
    expect(screen.getByLabelText("Password")).toHaveValue("old");
  });

  it("honors the destination field's length limit without truncating a generated password", async () => {
    render(<PasswordInput generateable aria-label="Password" maxLength={12} />);
    await openGenerator();
    expect(proposal().value).toHaveLength(12);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), {
      target: { value: "13" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("from 8 to 12");
    expect(proposal()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Use password" })).toBeDisabled();
  });

  it("reports unavailable secure randomness and preserves the original password", async () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
      throw new Error("unavailable");
    });
    render(
      <PasswordInput generateable aria-label="Password" defaultValue="old" />,
    );
    await openGenerator();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Secure password generation is unavailable",
    );
    expect(proposal()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Use password" })).toBeDisabled();
    expect(screen.getByLabelText("Password")).toHaveValue("old");
  });
});
