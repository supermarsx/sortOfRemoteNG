// Shared shape and constructors for the built-in Bulk SSH Commander catalog.
//
// Built-in scripts live in code and are never persisted: the library seeds them
// ahead of the user's saved scripts, and the persistence sanitizer rejects any
// stored record whose id begins with "default-". Adding entries here therefore
// cannot modify or displace anything a user created.

export interface SavedBulkScript {
  id: string;
  name: string;
  description: string;
  script: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SCRIPT_TIMESTAMP = "2026-08-10T00:00:00.000Z";

export const lines = (...value: string[]): string => value.join("\n");

export const defineDefaultScript = (
  id: string,
  name: string,
  description: string,
  category: string,
  script: string,
): SavedBulkScript => ({
  id,
  name,
  description,
  category,
  script,
  createdAt: DEFAULT_SCRIPT_TIMESTAMP,
  updatedAt: DEFAULT_SCRIPT_TIMESTAMP,
});
