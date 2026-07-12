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

  it("shows the empty state while the sub-tab registry is unpopulated", () => {
    // Lead ships the registry EMPTY; the 8 crate execs append their sub-tabs.
    expect(mailSubTabs).toHaveLength(0);
    render(<MailServerPanel isOpen onClose={() => {}} />);
    expect(
      screen.getByText("Mail services load here once registered."),
    ).toBeInTheDocument();
  });

  it("exposes a well-formed mail descriptor", () => {
    expect(mailDescriptor.key).toBe("mail");
    expect(mailDescriptor.category).toBe("mail");
    expect(mailDescriptor.label).toBe("Mail Server");
    expect(typeof mailDescriptor.importPanel).toBe("function");
  });
});
