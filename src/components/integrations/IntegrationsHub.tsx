import React, { useState, useMemo, useCallback } from "react";
import { ArrowLeft, Plus, Puzzle, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  groupByCategory,
  integrationRegistry,
  type IntegrationCategory,
  type IntegrationDescriptor,
} from "../../types/integrations/registry";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import { IntegrationPanelHost } from "./IntegrationPanelHost";

interface IntegrationsHubProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_LABEL_KEYS: Record<IntegrationCategory, [string, string]> = {
  infra: ["integrations.category.infra", "Infrastructure"],
  web: ["integrations.category.web", "Web Servers"],
  database: ["integrations.category.database", "Databases"],
  "app-service": ["integrations.category.appService", "App Services"],
  mail: ["integrations.category.mail", "Mail"],
  vault: ["integrations.category.vault", "Vaults"],
};

interface Selection {
  descriptorKey: string;
  instanceId?: string;
}

/**
 * Integrations hub — the single Tool-surface entry point for all registered
 * backend integrations (t42, mechanism B). Renders the registry grouped by
 * category; selecting an integration (or one of its saved instances) opens its
 * panel via the registry-driven `IntegrationPanelHost`. Adding integrations is
 * pure registry work — this component never changes per-integration.
 */
export const IntegrationsHub: React.FC<IntegrationsHubProps> = () => {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<Selection | null>(null);
  const { instancesFor } = useIntegrationConfigStore();

  const groups = useMemo(() => groupByCategory(integrationRegistry), []);

  const openIntegration = useCallback(
    (descriptor: IntegrationDescriptor, instanceId?: string) => {
      setSelection({ descriptorKey: descriptor.key, instanceId });
    },
    [],
  );

  const backToHub = useCallback(() => setSelection(null), []);

  if (selection) {
    return (
      <div className="flex h-full flex-col bg-[var(--color-surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
          <button
            onClick={backToHub}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-sm"
            title={t("integrations.back", "Back to integrations")}
          >
            <ArrowLeft size={14} />
            {t("integrations.back", "Back to integrations")}
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <IntegrationPanelHost
            descriptorKey={selection.descriptorKey}
            instanceId={selection.instanceId}
            onClose={backToHub}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)]"
      data-testid="integrations-hub"
    >
      <div className="flex items-start justify-between border-b border-[var(--color-border)] px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]">
            <Puzzle className="h-5 w-5 text-primary" />
            {t("integrations.title", "Integrations")}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
            {t(
              "integrations.subtitle",
              "Connect and manage external services",
            )}
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center"
          data-testid="integrations-empty"
        >
          <Puzzle className="h-10 w-10 text-[var(--color-textMuted)]" />
          <p className="text-sm text-[var(--color-text)]">
            {t("integrations.empty", "No integrations available yet")}
          </p>
          <p className="max-w-sm text-xs text-[var(--color-textSecondary)]">
            {t(
              "integrations.emptyHint",
              "Integrations will appear here as they are added.",
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 p-6">
          {groups.map(({ category, items }) => {
            const [labelKey, labelDefault] = CATEGORY_LABEL_KEYS[category];
            return (
              <section key={category}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textMuted)]">
                  {t(labelKey, labelDefault)}
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((descriptor) => {
                    const Icon = descriptor.icon;
                    const instances = instancesFor(descriptor.key);
                    return (
                      <div
                        key={descriptor.key}
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3"
                        data-testid={`integration-card-${descriptor.key}`}
                      >
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => openIntegration(descriptor)}
                            className="flex min-w-0 items-center gap-2 text-left"
                          >
                            <Icon className="h-4 w-4 shrink-0 text-primary" />
                            <span className="truncate text-sm font-medium text-[var(--color-text)]">
                              {descriptor.label}
                            </span>
                          </button>
                          <button
                            onClick={() => openIntegration(descriptor)}
                            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
                            title={t("integrations.addInstance", "Add instance")}
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                        {instances.length > 0 && (
                          <ul className="mt-2 flex flex-col gap-1">
                            {instances.map((inst) => (
                              <li key={inst.id}>
                                <button
                                  onClick={() =>
                                    openIntegration(descriptor, inst.id)
                                  }
                                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
                                >
                                  <span className="truncate">
                                    {inst.name}
                                    {inst.host ? ` · ${inst.host}` : ""}
                                  </span>
                                  <ChevronRight
                                    size={12}
                                    className="shrink-0"
                                  />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default IntegrationsHub;
