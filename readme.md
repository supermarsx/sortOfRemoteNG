# sortOfRemoteNG

A sort of remoteNG inspired web app that runs on the browser. Very broken and non-functional though, it's an experiment.

## Testing

To run the unit tests, you **must** install dependencies first:

```bash
npm install
```

Then execute the tests:

```bash
npm test
```

Ensure that Node.js and npm are installed on your system before running the commands.

## Linting

To check code style, run:

```bash
npm run lint
```

All code should pass ESLint before committing.

## Authentication

The REST API uses a simple user store with bcrypt-hashed passwords and JWT tokens.

1. Users are defined in a JSON file (`users.json` by default) containing objects with
   `username` and `passwordHash` fields:

   ```json
   [{ "username": "admin", "passwordHash": "<bcrypt-hash>" }]
   ```

   Generate hashes with:

   ```bash
   node -e "require('bcryptjs').hash('password',10).then(console.log)"
   ```

2. Obtain a token via `POST /auth/login` with the username and password. Use the
   returned token in the `Authorization: Bearer <token>` header for all `/api`
   requests.

3. An API key can be supplied via the `X-API-Key` header.

Environment variables:

- `API_KEY` – optional API key (defaults to none).
- `JWT_SECRET` – secret for signing JWTs (defaults to `defaultsecret`).
- `USER_STORE_PATH` – path to the users file (defaults to `users.json`).
- `USER_STORE_SECRET` – passphrase used to encrypt the user store with AES-GCM.
  Plaintext stores are automatically migrated on first load when this is set.
- `PBKDF2_ITERATIONS` – overrides key derivation iterations (defaults to `150000`).

## Appearance

The interface supports selectable color schemes (blue, green, purple, red, orange and teal). Use the settings dialog to choose your preferred scheme.

## Data Storage and Migration

sortOfRemoteNG now stores all persistent data in IndexedDB. When the application
starts, it checks for any `mremote-` keys in `localStorage` and moves them into
IndexedDB. After migration these keys are removed from `localStorage`.
Ensure your browser supports IndexedDB so settings and collections can be
preserved across sessions.
