# Publishing

The Pi package gallery discovers public npm packages carrying the `pi-package` keyword. No separate gallery manifest is required.

## Prerequisites

- Create `https://github.com/moejay/pi-state-sync`.
- Confirm `pi-state-sync` remains available on npm.
- Configure npm publishing through either an `NPM_TOKEN` GitHub secret or npm trusted publishing.
- Verify repository visibility and README links.

## Release checklist

1. Run validation:

   ```bash
   npm ci
   npm run check
   npm audit --omit=dev
   npm pack --dry-run
   ```

2. Inspect the tarball list. It must not contain personal Pi settings, `.env`, `.env.keys`, `auth.json`, sessions, unrelated extensions, or skills.
3. Update `CHANGELOG.md` and package version.
4. Commit and push the release.
5. Create and push a tag matching the package version, for example `v0.1.0`.
6. The tag-triggered publish workflow verifies the version and runs `npm publish --access public --provenance`.
7. Optionally create a GitHub release from the published tag.
8. Verify:

   ```bash
   npm view pi-state-sync version
   pi install npm:pi-state-sync
   ```

9. Wait for npm indexing, then verify `https://pi.dev/packages/pi-state-sync`.

## Gallery metadata

`package.json` provides:

- `pi-package` keyword for discovery;
- extension manifest under `pi.extensions`;
- preview image under `pi.image`;
- description, repository, homepage, bugs, author, and license metadata.

The gallery page uses the npm README as its main documentation, so installation, commands, screenshots, security behavior, and limitations belong there.

## Manual fallback

If CI publishing is unavailable:

```bash
npm login
npm publish --access public --provenance
```

Do not publish from a dirty worktree. Re-run `npm pack --dry-run` immediately before publishing.
