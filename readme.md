# sortOfRemoteNG

[![CI Status](https://img.shields.io/github/actions/workflow/status/supermarsx/sortOfRemoteNG/ci.yml?label=CI&logo=github)](https://github.com/supermarsx/sortOfRemoteNG/actions)
[![Coverage](https://img.shields.io/badge/coverage-34.73%25-red)](https://github.com/supermarsx/sortOfRemoteNG/actions/workflows/ci.yml)
[![Downloads](https://img.shields.io/github/downloads/supermarsx/sortOfRemoteNG/total)](https://github.com/supermarsx/sortOfRemoteNG/releases)
[![Stars](https://img.shields.io/github/stars/supermarsx/sortOfRemoteNG?style=social)](https://github.com/supermarsx/sortOfRemoteNG/stargazers)
[![Forks](https://img.shields.io/github/forks/supermarsx/sortOfRemoteNG?style=social)](https://github.com/supermarsx/sortOfRemoteNG/network/members)
[![Watchers](https://img.shields.io/github/watchers/supermarsx/sortOfRemoteNG?style=social)](https://github.com/supermarsx/sortOfRemoteNG/watchers)
[![Open Issues](https://img.shields.io/github/issues/supermarsx/sortOfRemoteNG)](https://github.com/supermarsx/sortOfRemoteNG/issues)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/supermarsx/sortOfRemoteNG)](https://github.com/supermarsx/sortOfRemoteNG/commits)
[![License](https://img.shields.io/github/license/supermarsx/sortOfRemoteNG)](license.md)

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

## Language Switching

The interface is translated into multiple languages. Use the language selector in
the top bar or the settings dialog to switch between English, Spanish, French,
German and Portuguese (Portugal). Translation files are loaded on demand to keep the initial bundle
small.

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

## Aborting Scripts

Custom scripts executed through the `ScriptEngine` can be cancelled using an
`AbortSignal`. Create an `AbortController` and pass its signal to
`executeScript`. Any pending `http`, `ssh`, or `sleep` calls will reject with an
`AbortError` when the signal is triggered:

```ts
const controller = new AbortController();
const promise = engine.executeScript(script, context, controller.signal);
controller.abort(); // script stops immediately
```

This allows external callers to stop long running scripts and network requests
cleanly.

## License

Distributed under the MIT License. See [license.md](license.md) for details.
