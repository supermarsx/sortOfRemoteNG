import { useMemo } from 'react';

interface ValidationError {
  field: string;
  message: string;
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export function useConnectionValidator(connection: Partial<{
  name: string;
  hostname: string;
  port: number;
  protocol: string;
}>) {
  return useMemo<ValidationResult>(() => {
    const errors: ValidationError[] = [];

    if (!connection.name?.trim()) {
      errors.push({ field: 'name', message: 'Connection name is required' });
    }

    if (!connection.hostname?.trim()) {
      errors.push({ field: 'hostname', message: 'Hostname is required' });
    } else if (connection.hostname.includes(' ')) {
      errors.push({ field: 'hostname', message: 'Hostname cannot contain spaces' });
    }

    if (connection.port !== undefined) {
      if (connection.port < 1 || connection.port > 65535) {
        errors.push({ field: 'port', message: 'Port must be between 1 and 65535' });
      }
    }

    if (!connection.protocol) {
      errors.push({ field: 'protocol', message: 'Protocol is required' });
    }

    return { isValid: errors.length === 0, errors };
  }, [connection.name, connection.hostname, connection.port, connection.protocol]);
}
