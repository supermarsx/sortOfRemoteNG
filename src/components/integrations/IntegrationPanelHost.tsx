import React, { Suspense, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FeatureErrorBoundary } from "../app/FeatureErrorBoundary";
import {
  findDescriptor,
  type IntegrationDescriptor,
} from "../../types/integrations/registry";

interface IntegrationPanelHostProps {
  /** Descriptor key to route to (from the hub selection). */
  descriptorKey: string;
  /** Which persisted instance to bind to, if any. */
  instanceId?: string;
  /** Close the panel and return to the hub. */
  onClose: () => void;
}

/**
 * Registry-driven dynamic-import dispatch for integration panels — the
 * data-driven analogue of `ToolTabViewer`. Instead of a hardcoded `&&` chain,
 * it resolves the descriptor by key and lazily imports its panel module. Every
 * integration plugs in purely by registering a descriptor; this host never
 * changes.
 */
export const IntegrationPanelHost: React.FC<IntegrationPanelHostProps> = ({
  descriptorKey,
  instanceId,
  onClose,
}) => {
  const { t } = useTranslation();
  const descriptor: IntegrationDescriptor | undefined = useMemo(
    () => findDescriptor(descriptorKey),
    [descriptorKey],
  );

  // `React.lazy` wants a stable component identity per descriptor; memoise on key.
  const LazyPanel = useMemo(() => {
    if (!descriptor) return null;
    return React.lazy(descriptor.importPanel);
  }, [descriptor]);

  if (!descriptor || !LazyPanel) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-textSecondary)]">
        {t(
          "integrations.notFound",
          "This integration is no longer available.",
        )}
      </div>
    );
  }

  return (
    <FeatureErrorBoundary
      boundaryKey={`${descriptorKey}:${instanceId ?? "new"}`}
      title={t("integrations.panelCrashed", "Integration panel crashed")}
      message={t(
        "integrations.panelCrashedDescription",
        "This integration panel hit a render error. You can retry without restarting the app.",
      )}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
      >
        <LazyPanel isOpen onClose={onClose} instanceId={instanceId} />
      </Suspense>
    </FeatureErrorBoundary>
  );
};

export default IntegrationPanelHost;
