# Security

## Goals

`pi-state-sync` reduces accidental publication of Pi credentials and runtime data while making configuration commits reproducible and reviewable.

The extension:

- stages only documented Pi configuration paths;
- refuses tracked credentials, sessions, caches, and package installations;
- detects likely literal secrets in `settings.json` and `models.json`;
- runs dotenvx pre-commit validation before creating a commit;
- uses argument-array process execution rather than shell-built commands;
- requires explicit commands for every commit, pull, and push;
- never force-pushes or auto-resolves conflicts.

## Out of scope

This is not a general secret scanner. Secrets can still appear in extensions, skills, prompts, themes, context files, Git history, commit messages, or other fields not recognized by the JSON check. Review `git diff --cached` before publishing state.

Git encryption is not access control. An encrypted `.env` remains recoverable by anyone who obtains `.env.keys` or `DOTENV_PRIVATE_KEY`. Rotate affected credentials and the dotenvx keypair after compromise.

A private Git repository can still leak through account compromise, CI logs, forks, backups, or incorrect repository visibility.

## Host-local files

Never commit:

- `auth.json` — Pi OAuth and stored credentials
- `.env.keys` — dotenvx private decryption keys
- `trust.json` — host-specific project trust decisions and paths
- `sessions/` — prompts, model output, tool calls, and attachments
- `models-store.json` — generated provider catalog state
- `npm/`, `git/`, `bin/` — generated package and helper installations

## Recommended practices

- Use a private repository for Pi state; `/pistate configure` creates GitHub repositories as private by default.
- Review the owner/repository shown before confirming remote creation or replacement.
- `configure reset` removes only `origin`; it never deletes local files, Git history, ignores, or the remote repository.
- Generated state README files contain clone instructions and the remote URL, but no credentials.
- Protect GitHub and npm accounts with hardware-backed MFA.
- Use SSH keys or a credential manager for Git; do not place Git tokens in state files.
- Store dotenvx private keys in a password manager when syncing many hosts.
- Reference provider secrets with `$ENV_VAR` or `!secret-manager-command`.
- Review staged changes before first push and after conflict resolution.
- Pin Pi package versions in `settings.json` when reproducibility matters.
- Re-authenticate Pi OAuth providers independently on each host.

## Reporting

Report vulnerabilities privately through the repository's GitHub security advisory interface. Do not include real credentials or private state repositories in reports.
