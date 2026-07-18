# Changelog

## 0.1.0

- Add `/pistate status`, `snapshot`, `pull`, and `push` commands.
- Restrict snapshots to portable Pi configuration and resources.
- Reject tracked credentials, sessions, caches, and literal config secrets.
- Validate encrypted environment files with dotenvx before commits.
- Reload Pi resources after fast-forward pulls.
