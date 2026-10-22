import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PasswordDialog } from "../../src/components/security/PasswordDialog";
import CredentialEntryForm from "../../src/components/security/databaseCredentialVault/CredentialEntryForm";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import type { DatabaseCredentialEntry } from "../../src/types/security/databaseCredentialVault";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(false),
}));

describe("password generator form integration", () => {
  it("offers generation only for the setup password, without submitting or cancelling its modal", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <PasswordDialog
        isOpen
        mode="setup"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const trigger = await screen.findByRole("button", {
      name: "Generate password",
    });
    expect(
      screen.getAllByRole("button", { name: "Generate password" }),
    ).toHaveLength(1);
    const password = screen.getByLabelText("Password");
    fireEvent.change(password, { target: { value: "existing-password" } });
    fireEvent.click(trigger);
    expect(password).toHaveValue("existing-password");
    await screen.findByRole("button", { name: "Use password" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(password).toHaveValue("existing-password");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does not offer generation when unlocking existing data", async () => {
    render(
      <PasswordDialog
        isOpen
        mode="unlock"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByLabelText("Password");
    expect(
      screen.queryByRole("button", { name: "Generate password" }),
    ).not.toBeInTheDocument();
  });

  it("applies only to the vault password draft and never changes its authenticator seed or saves automatically", async () => {
    const save = vi.fn();
    function VaultFixture() {
      const [entry, setEntry] = useState<DatabaseCredentialEntry>({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Test login",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        facets: {
          password: "original-password",
          totp: [
            {
              id: "test-totp",
              label: "Test",
              secret: "JBSWY3DPEHPK3PXP",
              digits: 6,
              period: 30,
              algorithm: "sha1",
            },
          ],
        },
      });
      return (
        <CredentialEntryForm
          entry={entry}
          onChange={setEntry}
          onSave={save}
          onCancel={vi.fn()}
          busy={false}
        />
      );
    }
    render(<VaultFixture />);
    const password = screen.getByLabelText("Password", {
      selector: 'input[type="password"]',
    });
    const seed = screen.getByLabelText("Authenticator 1 seed");
    expect(
      screen.getAllByRole("button", { name: "Generate password" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
    expect(password).toHaveValue("original-password");
    fireEvent.click(
      await screen.findByRole("button", { name: "Use password" }),
    );
    expect((password as HTMLInputElement).value).not.toBe("original-password");
    expect((password as HTMLInputElement).value.length).toBeGreaterThanOrEqual(
      16,
    );
    expect(seed).toHaveValue("JBSWY3DPEHPK3PXP");
    expect(save).not.toHaveBeenCalled();
  });

  it("updates the HTTP authentication draft only after Use password", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    function HttpFixture() {
      const [formData, setFormData] = useState<Partial<Connection>>({
        protocol: "https",
        authType: "basic",
        basicAuthPassword: "existing-http-password",
      });
      return (
        <form onSubmit={submit}>
          <HTTPOptions
            formData={formData}
            setFormData={setFormData}
            sections={["authentication"]}
          />
        </form>
      );
    }
    render(<HttpFixture />);
    const password = screen.getByPlaceholderText("Password");
    fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
    expect(password).toHaveValue("existing-http-password");
    fireEvent.click(
      await screen.findByRole("button", { name: "Use password" }),
    );
    expect((password as HTMLInputElement).value).not.toBe(
      "existing-http-password",
    );
    expect(submit).not.toHaveBeenCalled();
  });
});
