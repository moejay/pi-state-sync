# pi-state-sync

[![npm](https://img.shields.io/npm/v/pi-state-sync?color=22d3ee)](https://www.npmjs.com/package/pi-state-sync)
[![CI](https://github.com/moejay/pi-state-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/moejay/pi-state-sync/actions/workflows/ci.yml)
[![website](https://img.shields.io/badge/website-live-a78bfa)](https://moejay.github.io/pi-state-sync/)

[![pi-state-sync preview](./docs/pi-state-sync.png)](https://moejay.github.io/pi-state-sync/)

Git-backed configuration sync for [Pi](https://pi.dev), with dotenvx validation for encrypted secrets.

`pi-state-sync` adds four explicit commands for reviewing, committing, pulling, and pushing portable Pi configuration. Sessions, OAuth credentials, trust decisions, caches, and package installations stay local.

## Features

- Sync Pi settings, model definitions, context files, extensions, skills, prompts, and themes.
- Commit only an explicit allowlist—never `git add -A` across the whole Pi directory.
- Reject tracked credentials, sessions, package caches, and runtime state.
- Reject likely literal secrets in `settings.json` and `models.json`.
- Validate staged `.env` files with [dotenvx](https://dotenvx.com/docs/quickstart/encryption).
- Use `git pull --ff-only`; never hide conflicts with merges or force pushes.
- Reload Pi after a successful pull.
- Keep all writes user-triggered. No background commits or shutdown-time pushes.
- No session synchronization.

## Install

From npm:

```bash
pi install npm:pi-state-sync
```

From GitHub:

```bash
pi install git:github.com/moejay/pi-state-sync
```

Restart Pi or run `/reload` after installation.

## Quick start

Pi stores global configuration in `~/.pi/agent` by default. Make that directory a private Git repository:

```bash
cd ~/.pi/agent
git init -b main
git remote add origin git@github.com:YOUR_USER/YOUR_PRIVATE_PI_STATE.git
```

Add the recommended ignores from [`examples/.gitignore`](./examples/.gitignore), then in Pi:

```text
/pistate status
/pistate snapshot chore: initialize Pi state
/pistate push
```

On another host, clone the private state repository where Pi expects its configuration:

```bash
git clone git@github.com:YOUR_USER/YOUR_PRIVATE_PI_STATE.git ~/.pi/agent
pi
```

The committed `settings.json` contains the `pi-state-sync` package declaration, so Pi can restore the package. Authenticate separately on each host with `/login`.

If you use a custom config location, set `PI_CODING_AGENT_DIR` before starting Pi. `PI_STATE_DIR` can explicitly select the same Git-backed state root.

## Commands

| Command | Action |
|---|---|
| `/pistate status` | Show Git changes without modifying anything. |
| `/pistate snapshot [message]` | Validate, stage allowlisted state, and create a local commit. |
| `/pistate pull` | Require a clean tree, fast-forward pull, validate, then reload Pi. |
| `/pistate push` | Validate state and push existing commits. |

Typical workflow:

```text
/pistate snapshot chore: update Pi config
/pistate push
```

Other host:

```text
/pistate pull
```

`snapshot` does not push. `push` does not commit. This separation keeps network changes explicit.

## What is synchronized

Snapshot allowlist:

- `.env` and `.gitignore`
- `settings.json`, `models.json`, and `keybindings.json`
- `AGENTS.md`, `SYSTEM.md`, and `APPEND_SYSTEM.md`
- `extensions/`, `skills/`, `prompts/`, and `themes/`

Always local and rejected if tracked:

- `auth.json`
- `.env.keys`
- `trust.json`
- `models-store.json`
- `sessions/`
- `npm/`, `git/`, `bin/`, and `node_modules/`

## Secrets with dotenvx

OAuth tokens managed by Pi remain in ignored `auth.json`. For static API keys, commit an encrypted `.env` and keep its private key outside Git.

Install the dotenvx CLI for launching Pi with injected values:

```bash
npm install -g @dotenvx/dotenvx
```

Create or update an encrypted value:

```bash
cd ~/.pi/agent
dotenvx set ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY" -f .env
```

This produces:

- `.env` — encrypted values; commit this file.
- `.env.keys` — private decryption key; never commit this file.

Start Pi through dotenvx:

```bash
dotenvx run --strict --env-file ~/.pi/agent/.env -- pi
```

A reusable wrapper is available at [`examples/pix`](./examples/pix).

Custom provider configuration should reference injected variables:

```json
{
  "providers": {
    "my-proxy": {
      "baseUrl": "https://proxy.example.com",
      "api": "anthropic-messages",
      "apiKey": "$MY_PROXY_API_KEY",
      "models": []
    }
  }
}
```

You can keep `.env.keys` locally with mode `0600`, or supply `DOTENV_PRIVATE_KEY` through a password manager. Restart Pi after pulling a changed `.env`; an extension cannot replace its parent process environment.

## Safety model

`pi-state-sync` executes Git and dotenvx with argument arrays rather than shell interpolation. It does not read or display decrypted values.

Before commit or push it checks:

1. State root is its own Git repository, not an accidental parent repository.
2. Forbidden runtime or credential files are not tracked.
3. Likely secret fields in JSON use `$ENV_VAR`, `!secret-command`, or an accepted local placeholder.
4. Only allowlisted Pi paths are staged.
5. dotenvx's pre-commit validation succeeds.

Session transcripts are intentionally excluded because they can contain prompts, source code, command output, images, and secrets.

See [`docs/security.md`](./docs/security.md) for threat model and limitations.

## Conflict behavior

`/pistate pull` refuses dirty working trees and uses `git pull --ff-only`. If hosts diverge:

```bash
cd ~/.pi/agent
git fetch origin
git rebase origin/main
```

Resolve and review conflicts manually, then return to Pi. The extension never force-pushes, stashes, or auto-resolves configuration conflicts.

## Development

```bash
git clone https://github.com/moejay/pi-state-sync.git
cd pi-state-sync
npm install
npm run check
pi -e ./extensions/pi-state/index.ts
```

Preview package contents:

```bash
npm pack --dry-run
```

## Requirements

- Pi with extension and package support
- Git
- Node.js 20+
- dotenvx for encrypted environment validation and launch-time injection

## License

MIT
