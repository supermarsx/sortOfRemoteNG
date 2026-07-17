// Unified Mail Server integration descriptor (t42 Wave M, lead t42-mail-L).
//
// The single top-level hub entry for the whole mail chain — the 8 crates
// (postfix/dovecot/amavis/opendkim/cyrus-sasl/procmail/rspamd/clamav) live as
// sub-tabs INSIDE this one panel, not as 8 separate descriptors. Kept in a
// lightweight module separate from the (heavy) panel so the top-level registry
// can statically import the descriptor const WITHOUT eagerly bundling the panel —
// `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
//
// The Wave-M integrator appends `mailDescriptor` to
// `src/types/integrations/registry.mail.ts`:
//   import { mailDescriptor } from "../../components/integrations/mail/descriptor";

import { Mail } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const mailDescriptor: IntegrationDescriptor = {
  key: "mail",
  label: "Mail Server",
  category: "mail-server",
  icon: Mail,
  defaultConnectionIconKey: "mail",
  importPanel: () => import("./MailServerPanel"),
};
