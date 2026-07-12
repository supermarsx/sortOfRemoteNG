// MailServerPanel — the unified "Mail Server" integration panel SHELL (t42
// Wave M, lead t42-mail-L). Hosts the 8 mail-chain crates (postfix, dovecot,
// amavis, opendkim, cyrus-sasl, procmail, rspamd, clamav) as registry-driven
// sub-tabs.
//
// These are 8 INDEPENDENT daemons, so — unlike the cpanel/php shells — this shell
// owns NO connection and NO shared connect form. Each sub-tab is a self-contained
// mini-panel that manages its own connect lifecycle + persistence. The shell is a
// pure router: header + sub-tab bar + Suspense-mounted active tab, driven entirely
// by `./registry.ts`. It never changes as crates are added.

import React, { Suspense, useMemo, useState } from "react";
import { Mail, Loader2, Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import { mailSubTabs } from "./registry";

const MailServerPanel: React.FC<IntegrationPanelProps> = ({ isOpen }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string | null>(
    mailSubTabs[0]?.subTabKey ?? null,
  );

  const active = activeTab ?? mailSubTabs[0]?.subTabKey ?? null;

  const ActiveTab = useMemo(() => {
    if (!active) return null;
    const tab = mailSubTabs.find((tt) => tt.subTabKey === active);
    if (!tab) return null;
    return React.lazy(tab.importTab);
  }, [active]);

  if (!isOpen) return null;

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <Mail className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold text-[var(--color-text)]">
          {t("integrations.mail.title", "Mail Server")}
        </h2>
        <span className="text-xs font-normal text-[var(--color-textSecondary)]">
          {t(
            "integrations.mail.subtitle",
            "Manage the full mail chain — MTA, delivery, filtering, signing & auth.",
          )}
        </span>
      </div>

      {mailSubTabs.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-2">
            {mailSubTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.subTabKey}
                  onClick={() => setActiveTab(tab.subTabKey)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm ${
                    active === tab.subTabKey
                      ? "border-b-2 border-primary text-[var(--color-text)]"
                      : "text-[var(--color-textSecondary)]"
                  }`}
                >
                  <Icon size={14} />
                  {t(`integrations.mail.tabs.${tab.subTabKey}`, tab.label)}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              }
            >
              {ActiveTab && <ActiveTab active />}
            </Suspense>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-[var(--color-textSecondary)]">
          <Inbox className="h-8 w-8 opacity-50" />
          <p className="text-sm">
            {t(
              "integrations.mail.noTabs",
              "Mail services load here once registered.",
            )}
          </p>
        </div>
      )}
    </div>
  );
};

export default MailServerPanel;
