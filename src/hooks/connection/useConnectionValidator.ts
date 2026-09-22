import { useMemo } from "react";
import { isEndpointFreeGoogleService } from "../../utils/connection/googleServiceAddressPolicy";
import { getFirstPartyGoogleHostedApplicationUrl } from "../../utils/connection/httpApplicationProfiles";

interface ValidationError {
  field: string;
  message: string;
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export function useConnectionValidator(
  connection: Partial<{
    name: string;
    hostname: string;
    port: number;
    protocol: string;
    httpApplication: { id?: string };
  }>,
) {
  return useMemo<ValidationResult>(() => {
    const errors: ValidationError[] = [];

    if (!connection.name?.trim()) {
      errors.push({ field: "name", message: "Connection name is required" });
    }

    const requiresEndpoint =
      !isEndpointFreeGoogleService(connection.protocol) &&
      !getFirstPartyGoogleHostedApplicationUrl(connection.httpApplication?.id);
    if (requiresEndpoint && !connection.hostname?.trim()) {
      errors.push({ field: "hostname", message: "Hostname is required" });
    } else if (requiresEndpoint && connection.hostname?.includes(" ")) {
      errors.push({
        field: "hostname",
        message: "Hostname cannot contain spaces",
      });
    }

    if (requiresEndpoint && connection.port !== undefined) {
      if (connection.port < 1 || connection.port > 65535) {
        errors.push({
          field: "port",
          message: "Port must be between 1 and 65535",
        });
      }
    }

    if (!connection.protocol) {
      errors.push({ field: "protocol", message: "Protocol is required" });
    }

    return { isValid: errors.length === 0, errors };
  }, [
    connection.name,
    connection.hostname,
    connection.port,
    connection.protocol,
    connection.httpApplication?.id,
  ]);
}
