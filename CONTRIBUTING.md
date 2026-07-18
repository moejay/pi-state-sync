# Contributing

## Setup

```bash
npm install
npm run check
```

Try the extension without installing it:

```bash
PI_STATE_DIR=/path/to/disposable/pi-state pi -e ./extensions/pi-state/index.ts
```

Use a disposable Git repository. `/pistate snapshot`, `pull`, and `push` intentionally mutate Git state.

## Pull requests

- Keep Git mutations explicit and fail closed on uncertain state.
- Do not add session synchronization or credential storage to this package.
- Add tests for path allowlist, credential rejection, and command behavior.
- Update README and changelog for user-visible behavior.
- Run `npm pack --dry-run` and inspect every included file.

## Security changes

Describe threat-model impact in the pull request. Never include real Pi state, session transcripts, credentials, dotenvx private keys, or private repository URLs in fixtures.
