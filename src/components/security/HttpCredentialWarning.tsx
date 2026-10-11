import type { Connection } from "../../types/connection/connection";
import { configuredHttpCredentialOrigin } from "../../utils/auth/httpCredentialTransport";

export default function HttpCredentialWarning({
  connection,
}: {
  connection: Partial<Connection>;
}) {
  const origin = configuredHttpCredentialOrigin(connection);
  if (!origin) return null;
  return (
    <p role="note" className="mt-1 text-xs text-warning">
      HTTP transmits credentials unencrypted to {origin}.
    </p>
  );
}
