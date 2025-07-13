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

## Appearance

The interface supports selectable color schemes (blue, green, purple, red, orange and teal). Use the settings dialog to choose your preferred scheme.

## Data Storage and Migration

sortOfRemoteNG now stores all persistent data in IndexedDB. When the application
starts, it checks for any `mremote-` keys in `localStorage` and moves them into
IndexedDB. After migration these keys are removed from `localStorage`.
Ensure your browser supports IndexedDB so settings and collections can be
preserved across sessions.
