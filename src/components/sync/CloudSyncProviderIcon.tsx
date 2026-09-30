import type { CloudSyncProvider } from "../../types/settings/cloudSyncSettings";
import { CLOUD_SYNC_PROVIDER_ICONS } from "../../utils/icons/cloudSyncProviderIcons";

export function CloudSyncProviderIcon({
  provider,
  className = "w-5 h-5 text-primary",
}: {
  provider: CloudSyncProvider;
  className?: string;
}) {
  const Icon = CLOUD_SYNC_PROVIDER_ICONS[provider];
  return (
    <Icon
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      data-cloud-sync-provider={provider}
    />
  );
}
