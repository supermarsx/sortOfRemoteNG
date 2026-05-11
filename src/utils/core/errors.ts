export class DatabaseNotFoundError extends Error {
  constructor(message: string = "Database not found") {
    super(message);
    this.name = "DatabaseNotFoundError";
  }
}

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
