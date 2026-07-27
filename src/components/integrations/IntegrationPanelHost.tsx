import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FeatureErrorBoundary } from "../app/FeatureErrorBoundary";
import { INTEGRATION_PROTOCOL_PREFIX } from "../../types/connection/connection";
import type { IntegrationConnectionLaunchSettings } from "../../types/connection/connection";
import {
  findDescriptor,
  type IntegrationDescriptor,
} from "../../types/integrations/registry";
import {
  IntegrationSessionLifecycleProvider,
  type IntegrationSessionStateEvent,
} from "../../hooks/integrations/IntegrationSessionLifecycle";
import {
  useIntegrationConfigStore,
  type IntegrationInstanceInput,
} from "../../hooks/integrations/useIntegrationConfigStore";
import { sanitizeIntegrationProviderFields } from "../../utils/integrations/providerFieldSanitizer";

interface IntegrationPanelHostProps {
  /** Canonical session id used to own reconnect and cleanup registrations. */
  sessionId?: string;
  /** Descriptor key to route to (from the hub selection). */
  descriptorKey?: string;
  /** Optional protocol route, for connection-backed sessions (`integration:key`). */
  protocol?: string;
  /** Which persisted instance to bind to, if any. */
  instanceId?: string;
  /** Non-secret settings from the connection that launched this panel. */
  integrationSettings?: IntegrationConnectionLaunchSettings;
  /** Canonical session-state bridge. Omitted for standalone Integration Hub panels. */
  onStateChange?: (event: IntegrationSessionStateEvent) => void;
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
  sessionId,
  descriptorKey,
  protocol,
  instanceId,
  integrationSettings,
  onStateChange,
  onClose,
}) => {
  const { t } = useTranslation();
  const {
    instances,
    isLoading: configLoading,
    error: configError,
    createInstance,
    updateInstance,
  } = useIntegrationConfigStore();
  const effectiveDescriptorKey =
    descriptorKey ??
    (protocol?.startsWith(INTEGRATION_PROTOCOL_PREFIX)
      ? protocol.slice(INTEGRATION_PROTOCOL_PREFIX.length)
      : undefined);
  const descriptor: IntegrationDescriptor | undefined = useMemo(
    () =>
      effectiveDescriptorKey
        ? findDescriptor(effectiveDescriptorKey)
        : undefined,
    [effectiveDescriptorKey],
  );
  const requestedInstanceId =
    instanceId || integrationSettings?.instanceId || undefined;
  const [resolvedInstanceId, setResolvedInstanceId] = useState<
    string | undefined
  >(requestedInstanceId);
  const [launchPreparing, setLaunchPreparing] = useState(
    Boolean(integrationSettings),
  );
  const [launchError, setLaunchError] = useState<string | null>(null);
  const preparedLaunchRef = useRef<{
    settings: IntegrationConnectionLaunchSettings;
    requestedInstanceId?: string;
    promise: Promise<string>;
  } | null>(null);

  useEffect(() => {
    if (!integrationSettings) {
      setResolvedInstanceId(requestedInstanceId);
      setLaunchPreparing(false);
      setLaunchError(null);
      preparedLaunchRef.current = null;
      return;
    }
    if (configLoading) return;
    let active = true;
    setLaunchPreparing(true);
    setLaunchError(null);

    let work = preparedLaunchRef.current;
    if (
      work?.settings !== integrationSettings ||
      work.requestedInstanceId !== requestedInstanceId
    ) {
      const promise = (async (): Promise<string> => {
        const existing = requestedInstanceId
          ? instances.find((candidate) => candidate.id === requestedInstanceId)
          : undefined;
        if (
          integrationSettings.descriptorKey === "mail" &&
          (!existing || !existing.integrationKey.startsWith("mail."))
        ) {
          throw new Error(
            "Select a saved Mail service instance before opening this session. Generic Mail instances cannot be routed to a service.",
          );
        }
        const fields: Record<string, string> = {
          ...(existing?.fields ?? {}),
        };
        for (const [key, value] of Object.entries(
          sanitizeIntegrationProviderFields(integrationSettings.providerFields),
        )) {
          // The connection editor may include runtime-only provider secrets in
          // this extensible record. Preserve only non-secret metadata here;
          // actual credentials are written through the encrypted vault below.
          if (value !== null) {
            fields[key] = String(value);
          }
        }
        if (integrationSettings.baseUrl) {
          fields.baseUrl = integrationSettings.baseUrl;
          fields.url ??= integrationSettings.baseUrl;
        }
        if (integrationSettings.username) {
          fields.username = integrationSettings.username;
        }
        if (integrationSettings.authToken) {
          fields.authMode = "bearer";
        } else if (integrationSettings.apiKey) {
          fields.authMode = "apiKey";
        } else if (integrationSettings.password) {
          fields.authMode = integrationSettings.username ? "basic" : "password";
        }
        if (integrationSettings.tlsVerify !== undefined) {
          fields.tlsVerify = String(integrationSettings.tlsVerify);
          fields.skipTlsVerify = String(!integrationSettings.tlsVerify);
          fields.tlsSkipVerify = String(!integrationSettings.tlsVerify);
          fields.acceptInvalidCerts = String(!integrationSettings.tlsVerify);
        }
        if (integrationSettings.timeout !== undefined) {
          fields.timeout = String(integrationSettings.timeout);
          fields.timeoutSecs ??= String(integrationSettings.timeout);
          fields.timeoutSeconds ??= String(integrationSettings.timeout);
        }

        const secrets: Record<string, string> = {
          ...(integrationSettings.providerSecrets ?? {}),
        };
        if (integrationSettings.authToken) {
          secrets.authToken = integrationSettings.authToken;
        }
        if (integrationSettings.apiKey) {
          secrets.apiKey = integrationSettings.apiKey;
        }
        if (integrationSettings.password) {
          secrets.password = integrationSettings.password;
        }
        const primarySecret =
          integrationSettings.authToken ||
          integrationSettings.apiKey ||
          integrationSettings.password ||
          Object.values(integrationSettings.providerSecrets ?? {}).find(
            Boolean,
          );
        const input: IntegrationInstanceInput = {
          integrationKey:
            existing?.integrationKey ?? integrationSettings.descriptorKey,
          name:
            integrationSettings.instanceName?.trim() ||
            existing?.name ||
            integrationSettings.descriptorLabel ||
            integrationSettings.descriptorKey,
          host: integrationSettings.host || existing?.host,
          fields,
          credentialRefId: integrationSettings.credentialRefId,
          credentialRefIds: integrationSettings.credentialRefIds,
          ...(primarySecret ? { secret: primarySecret } : {}),
          ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
        };
        const resolved = existing
          ? await updateInstance(existing.id, input)
          : await createInstance({
              ...input,
              ...(requestedInstanceId ? { id: requestedInstanceId } : {}),
            });
        return resolved.id;
      })();
      work = { settings: integrationSettings, requestedInstanceId, promise };
      preparedLaunchRef.current = work;
    }

    void work.promise.then(
      (resolvedId) => {
        if (active) {
          setResolvedInstanceId(resolvedId);
          setLaunchPreparing(false);
        }
      },
      (error) => {
        if (active) {
          setLaunchPreparing(false);
          setLaunchError(
            typeof error === "string"
              ? error
              : error instanceof Error
                ? error.message
                : String(error),
          );
        }
      },
    );

    return () => {
      active = false;
    };
  }, [
    configLoading,
    createInstance,
    instances,
    integrationSettings,
    requestedInstanceId,
    updateInstance,
  ]);

  // `React.lazy` wants a stable component identity per descriptor; memoise on key.
  const LazyPanel = useMemo(() => {
    if (!descriptor) return null;
    return React.lazy(descriptor.importPanel);
  }, [descriptor]);

  if (!descriptor || !LazyPanel) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-textSecondary)]">
        {t("integrations.notFound", "This integration is no longer available.")}
      </div>
    );
  }

  const panel =
    launchPreparing || (configLoading && Boolean(integrationSettings)) ? (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--color-textSecondary)]">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        {t(
          "integrations.preparingConnection",
          "Preparing secure integration settings…",
        )}
      </div>
    ) : launchError || (configError && Boolean(integrationSettings)) ? (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-lg rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-[var(--color-text)]">
          <div className="mb-1 font-semibold">
            {t(
              "integrations.settingsUnavailable",
              "Integration settings unavailable",
            )}
          </div>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {launchError || configError}
          </p>
        </div>
      </div>
    ) : (
      <FeatureErrorBoundary
        boundaryKey={`${effectiveDescriptorKey}:${resolvedInstanceId ?? "new"}`}
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
          <LazyPanel
            isOpen
            onClose={onClose}
            instanceId={resolvedInstanceId}
            integrationSettings={integrationSettings}
          />
        </Suspense>
      </FeatureErrorBoundary>
    );

  return sessionId ? (
    <IntegrationSessionLifecycleProvider
      sessionId={sessionId}
      onStateChange={onStateChange}
    >
      {panel}
    </IntegrationSessionLifecycleProvider>
  ) : (
    panel
  );
};

export default IntegrationPanelHost;
