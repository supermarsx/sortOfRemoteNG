import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import MailServerPanel from "./MailServerPanel";
import { mailDescriptor } from "./descriptor";
import { mailSubTabs } from "./registry";

describe("MailServerPanel", () => {
  it("renders the shell header when open", () => {
    render(<MailServerPanel isOpen onClose={() => {}} />);
    expect(screen.getByText("Mail Server")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <MailServerPanel isOpen={false} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the sub-tab bar for whatever crates are registered", () => {
    // The registry grows as the 8 crate execs append their sub-tabs; the shell
    // routes from it. Empty → empty state; non-empty → a button per sub-tab.
    render(<MailServerPanel isOpen onClose={() => {}} />);
    if (mailSubTabs.length === 0) {
      expect(
        screen.getByText("Mail services load here once registered."),
      ).toBeInTheDocument();
    } else {
      for (const tab of mailSubTabs) {
        expect(
          screen.getByRole("button", { name: new RegExp(tab.label, "i") }),
        ).toBeInTheDocument();
      }
    }
  });

  it("exposes a well-formed mail descriptor", () => {
    expect(mailDescriptor.key).toBe("mail");
    expect(mailDescriptor.category).toBe("mail-server");
    expect(mailDescriptor.label).toBe("Mail Server");
    expect(typeof mailDescriptor.importPanel).toBe("function");
  });
});
