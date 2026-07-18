# Changelog

## 0.3.0

- Ask whether configuration should create a new repository, connect an existing repository, or remain local.
- Add `/pistate configure reset` to remove only `origin` while preserving local state and history.
- Generate a state-repository `README.md` with new-host setup and daily sync instructions.
- Verify existing GitHub repositories instead of offering to create them implicitly.

## 0.2.0

- Add `/pistate configure` to initialize the local state repository.
- Merge safe ignore rules without replacing existing `.gitignore` content.
- Offer to create a missing private GitHub repository through authenticated `gh`.
- Configure or confirm the `origin` remote.

## 0.1.1

- Publish under the `@moejay/pi-state-sync` npm scope.

## 0.1.0

- Add `/pistate status`, `snapshot`, `pull`, and `push` commands.
- Restrict snapshots to portable Pi configuration and resources.
- Reject tracked credentials, sessions, caches, and literal config secrets.
- Validate encrypted environment files with dotenvx before commits.
- Reload Pi resources after fast-forward pulls.
