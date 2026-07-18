# Design

## State model

Pi already persists configuration as files. `pi-state-sync` does not invent a second serialization format or copy files into a hidden database. It treats the configured Pi agent directory as the Git working tree.

The state root resolves in this order:

1. `PI_STATE_DIR`
2. `PI_CODING_AGENT_DIR`
3. `~/.pi/agent`

The selected path must be the root of its own Git repository. This prevents a mistaken fallback from committing an entire home or dotfiles repository.

## Command boundaries

- `status` is read-only.
- `snapshot` validates, stages only allowlisted paths, and commits locally.
- `pull` requires a clean tree and accepts fast-forward updates only.
- `push` uploads existing commits without creating or changing commits.

No command performs both commit and push. No lifecycle hook writes to Git.

## Why sessions are excluded

Pi session JSONL is portable, but it routinely embeds source snippets, shell output, model responses, tool metadata, and images. Configuration sync and transcript archival have different privacy and retention requirements, so this package handles configuration only.

## Why dotenvx runs before commit

Pi supports environment references and secret-manager commands in model configuration. dotenvx adds an encrypted, Git-friendly option for static values. Validation happens before commit so plaintext `.env` mistakes fail locally.

The extension uses its packaged dotenvx CLI when available and falls back to `dotenvx` on `PATH` for local development.

## Pull and reload

After a successful pull, the extension asks Pi to reload extensions, skills, prompts, themes, keybindings, settings, and context resources. If `.env` changed, it also asks for a process restart because environment injection occurred before Pi started.
