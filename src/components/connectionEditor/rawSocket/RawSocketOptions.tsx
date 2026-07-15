import { normalizeRawSocketSettings } from "../../../types/protocols/rawSocket";
import { useComposedControlledValue } from "../useComposedControlledValue";
import { AdvancedSection } from "./AdvancedSection";
import { ConnectionSection } from "./ConnectionSection";
import { DataSection } from "./DataSection";
import { NetworkPathSummarySection } from "./NetworkPathSummarySection";
import { RAW_SOCKET_EDITOR_SECTIONS } from "./searchMetadata";
import { TlsSection } from "./TlsSection";
import type { RawSocketOptionsProps } from "./types";

export function RawSocketOptions({
  value,
  onChange,
  sections,
  networkRoutes = ["direct"],
  targetHost,
  targetPort,
  disabled = false,
}: RawSocketOptionsProps) {
  const settings = normalizeRawSocketSettings(value);
  const [liveSettings, update] = useComposedControlledValue(settings, onChange);
  const visible = (id: (typeof RAW_SOCKET_EDITOR_SECTIONS)[number]["id"]) =>
    !sections || sections.includes(id);
  const common = { settings: liveSettings, update, disabled };

  return (
    <div
      aria-label="Raw Socket protocol settings"
      className="space-y-4"
      data-editor-search-section="raw-socket-options"
    >
      {visible("connection") && (
        <ConnectionSection
          {...common}
          targetHost={targetHost}
          targetPort={targetPort}
        />
      )}
      {visible("data") && <DataSection {...common} />}
      {visible("tls") && <TlsSection {...common} />}
      {visible("network-path") && (
        <NetworkPathSummarySection
          transport={settings.connection.transport}
          routes={networkRoutes}
        />
      )}
      {visible("advanced") && <AdvancedSection {...common} />}
    </div>
  );
}

export default RawSocketOptions;
