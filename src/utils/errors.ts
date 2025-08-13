export class CollectionNotFoundError extends Error {
  constructor(message: string = "Collection not found") {
    super(message);
    this.name = "CollectionNotFoundError";
  }
}

export class InvalidPasswordError extends Error {
  constructor(message: string = "Invalid password") {
    super(message);
    this.name = "InvalidPasswordError";
  }
}
