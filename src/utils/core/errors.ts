export class DatabaseNotFoundError extends Error {
  constructor(message: string = "Database not found") {
    super(message);
    this.name = "DatabaseNotFoundError";
  }
}

/**
 * @deprecated Use {@link DatabaseNotFoundError}. Kept temporarily so
 * `error instanceof CollectionNotFoundError` keeps catching the
 * renamed error class — alias point at the same constructor.
 */
export const CollectionNotFoundError = DatabaseNotFoundError;
export type CollectionNotFoundError = DatabaseNotFoundError;

export class InvalidPasswordError extends Error {
  constructor(message: string = "Invalid password") {
    super(message);
    this.name = "InvalidPasswordError";
  }
}

export class CorruptedDataError extends Error {
  constructor(message: string = "Corrupted data") {
    super(message);
    this.name = "CorruptedDataError";
  }
}
