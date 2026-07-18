import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	ALLOWED_PATHS,
	COMMANDS,
	buildStateReadme,
	githubSlugFromTarget,
	inspectPortableJson,
	isAllowedStatePath,
	isForbiddenTrackedPath,
	isSafeRemoteUrl,
	mergeGitignore,
	parseCommand,
	resolveStateRoot,
} from "./core.ts";

const ROOT = resolveStateRoot();
const GIT_TIMEOUT_MS = 60_000;
const require = createRequire(import.meta.url);

type ExecResult = Awaited<ReturnType<ExtensionAPI["exec"]>>;

function resolveDotenvxCli(): string | undefined {
	try {
		const packagePath = require.resolve("@dotenvx/dotenvx/package.json");
		return join(dirname(packagePath), "src", "cli", "dotenvx.js");
	} catch {
		return undefined;
	}
}

export default function piStateExtension(pi: ExtensionAPI) {
	async function gitAt(directory: string, args: string[], allowFailure = false): Promise<ExecResult> {
		const result = await pi.exec("git", ["-C", directory, ...args], { timeout: GIT_TIMEOUT_MS });
		if (!allowFailure && result.code !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed`);
		}
		return result;
	}

	async function git(args: string[], allowFailure = false): Promise<ExecResult> {
		return gitAt(ROOT, args, allowFailure);
	}

	async function assertRepositoryRoot(): Promise<void> {
		const result = await git(["rev-parse", "--show-toplevel"]);
		if (resolve(result.stdout.trim()) !== ROOT) {
			throw new Error(`PI state root is not its own Git repository: ${ROOT}`);
		}
	}

	async function gh(args: string[], allowFailure = false): Promise<ExecResult> {
		const result = await pi.exec("gh", args, { timeout: GIT_TIMEOUT_MS });
		if (!allowFailure && result.code !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim() || `gh ${args[0]} failed`);
		}
		return result;
	}

	async function resolveExistingRemote(target: string, ctx: ExtensionCommandContext): Promise<string | undefined> {
		let requested = target.trim();
		const auth = await gh(["auth", "status", "--hostname", "github.com"], true);
		let githubUser: string | undefined;
		if (auth.code === 0) {
			const user = await gh(["api", "user", "--jq", ".login"]);
			githubUser = user.stdout.trim();
		}
		if (!requested && ctx.hasUI) {
			requested = (await ctx.ui.input(
				"Existing repository or Git remote",
				githubUser ? `${githubUser}/pi-state` : "git@host:owner/pi-state.git",
			))?.trim() ?? "";
		}
		if (!requested) return undefined;
		if (!isSafeRemoteUrl(requested)) throw new Error("Invalid Git remote or GitHub owner/repository name");

		const slug = githubSlugFromTarget(requested);
		if (!slug) return requested;
		if (auth.code !== 0) throw new Error("GitHub CLI is not authenticated. Run: gh auth login");
		const lookup = await gh(["repo", "view", slug, "--json", "sshUrl", "--jq", ".sshUrl"], true);
		if (lookup.code !== 0 || !lookup.stdout.trim()) {
			throw new Error(`${slug} does not exist. Choose 'Create a new private GitHub repository'.`);
		}
		return lookup.stdout.trim();
	}

	async function importExistingRepository(target: string, ctx: ExtensionCommandContext): Promise<void> {
		const remoteUrl = await resolveExistingRemote(target, ctx);
		if (!remoteUrl) {
			ctx.ui.notify("Pi state configuration cancelled", "info");
			return;
		}
		const approved = !ctx.hasUI || await ctx.ui.confirm(
			"Import existing Pi state?",
			[
				`Clone ${remoteUrl} into ${ROOT}?`,
				"Portable Pi configuration will be replaced by the repository.",
				"Host-local credentials, sessions, package caches, and generated data will be kept.",
				"Replaced local configuration will be moved to a timestamped sibling backup.",
			].join("\n\n"),
		);
		if (!approved) {
			ctx.ui.notify("Existing repository import cancelled", "info");
			return;
		}

		const parent = dirname(ROOT);
		const temporaryRoot = mkdtempSync(join(parent, ".pi-state-sync-clone-"));
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const backupRoot = join(parent, `${basename(ROOT)}-backup-${stamp}`);
		const movedToBackup: string[] = [];
		const installedPaths: string[] = [];
		let applied = false;

		try {
			const clone = await pi.exec("git", ["clone", "--origin", "origin", "--", remoteUrl, temporaryRoot], {
				timeout: GIT_TIMEOUT_MS,
			});
			if (clone.code !== 0) throw new Error(clone.stderr.trim() || clone.stdout.trim() || "Git clone failed");

			const trackedResult = await gitAt(temporaryRoot, ["ls-files", "-z"]);
			const tracked = trackedResult.stdout.split("\0").filter(Boolean);
			const forbidden = tracked.filter(isForbiddenTrackedPath);
			if (forbidden.length > 0) {
				throw new Error(`Existing repository tracks private/runtime files: ${forbidden.join(", ")}`);
			}
			const unexpected = tracked.filter((path) => !isAllowedStatePath(path));
			if (unexpected.length > 0) {
				throw new Error(`Existing repository contains unsupported state paths: ${unexpected.join(", ")}`);
			}
			const configIssues = inspectPortableJson(temporaryRoot);
			if (configIssues.length > 0) {
				throw new Error(`Existing repository has unsafe or invalid config: ${configIssues.join(", ")}`);
			}

			mkdirSync(backupRoot, { recursive: true });
			for (const path of [...ALLOWED_PATHS, ".git"]) {
				const source = join(ROOT, path);
				if (!existsSync(source)) continue;
				const destination = join(backupRoot, path);
				mkdirSync(dirname(destination), { recursive: true });
				renameSync(source, destination);
				movedToBackup.push(path);
			}

			renameSync(join(temporaryRoot, ".git"), join(ROOT, ".git"));
			installedPaths.push(".git");
			for (const path of ALLOWED_PATHS) {
				const source = join(temporaryRoot, path);
				if (!existsSync(source)) continue;
				const destination = join(ROOT, path);
				mkdirSync(dirname(destination), { recursive: true });
				renameSync(source, destination);
				installedPaths.push(path);
			}

			const gitignorePath = join(ROOT, ".gitignore");
			const existingIgnore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
			const mergedIgnore = mergeGitignore(existingIgnore);
			if (mergedIgnore.added.length > 0) writeFileSync(gitignorePath, mergedIgnore.content, "utf8");
			const readmePath = join(ROOT, "README.md");
			if (!existsSync(readmePath)) writeFileSync(readmePath, buildStateReadme(remoteUrl), "utf8");

			const status = await git(["status", "--short"]);
			applied = true;
			ctx.ui.notify(
				[
					`Imported existing Pi state from ${remoteUrl}`,
					movedToBackup.length > 0 ? `Previous portable state backup: ${backupRoot}` : "No previous portable state needed backup",
					"Host-local credentials and runtime data were preserved",
					status.stdout.trim()
						? "Local safety/documentation changes remain; review /pistate status, then snapshot and push"
						: "State repository is clean and ready for /pistate pull",
					"Reloading Pi resources from the imported state",
				].join("\n"),
				"info",
			);
			await ctx.reload();
		} catch (error) {
			if (!applied) {
				for (const path of installedPaths.reverse()) rmSync(join(ROOT, path), { recursive: true, force: true });
				for (const path of movedToBackup.reverse()) {
					const source = join(backupRoot, path);
					if (!existsSync(source)) continue;
					const destination = join(ROOT, path);
					mkdirSync(dirname(destination), { recursive: true });
					renameSync(source, destination);
				}
			}
			throw error;
		} finally {
			rmSync(temporaryRoot, { recursive: true, force: true });
			if (existsSync(backupRoot) && movedToBackup.length === 0) rmSync(backupRoot, { recursive: true, force: true });
		}
	}

	type ConfigureMode = "new" | "existing" | "local" | "reset" | "auto";

	async function configureRepository(argument: string, ctx: ExtensionCommandContext): Promise<void> {
		const probe = await git(["rev-parse", "--show-toplevel"], true);
		const currentRoot = probe.code === 0 ? resolve(probe.stdout.trim()) : undefined;
		const currentOriginResult = currentRoot === ROOT
			? await git(["remote", "get-url", "origin"], true)
			: undefined;
		const currentOrigin = currentOriginResult?.code === 0 ? currentOriginResult.stdout.trim() : undefined;

		const words = argument.trim().split(/\s+/).filter(Boolean);
		const requestedMode = words[0] as ConfigureMode | undefined;
		let mode: ConfigureMode = ["new", "existing", "local", "reset"].includes(requestedMode ?? "")
			? requestedMode as ConfigureMode
			: argument.trim() ? "auto" : "local";
		let target = mode === "auto" ? argument.trim() : words.slice(1).join(" ");

		if (!argument.trim() && ctx.hasUI) {
			const choices = [
				"Create a new private GitHub repository",
				"Connect an existing repository",
				"Use a local repository only",
			];
			if (currentOrigin) choices.push("Reset remote configuration");
			const choice = await ctx.ui.select("How should Pi state be configured?", choices);
			if (!choice) {
				ctx.ui.notify("Pi state configuration cancelled", "info");
				return;
			}
			mode = choice.startsWith("Create")
				? "new"
				: choice.startsWith("Connect")
					? "existing"
					: choice.startsWith("Reset") ? "reset" : "local";
		}

		if (mode === "reset") {
			if (currentRoot !== ROOT || !currentOrigin) {
				ctx.ui.notify("No Pi state origin is configured", "info");
				return;
			}
			const approved = !ctx.hasUI || await ctx.ui.confirm(
				"Reset Pi state configuration?",
				`Remove origin ${currentOrigin}?\n\nLocal files, commits, and safety ignores will be kept.`,
			);
			if (!approved) {
				ctx.ui.notify("Pi state reset cancelled", "info");
				return;
			}
			await git(["remote", "remove", "origin"]);
			ctx.ui.notify("Removed Pi state origin. Local files and Git history were kept.", "info");
			return;
		}

		if (mode === "auto") mode = "existing";
		if (mode === "existing") {
			await importExistingRepository(target, ctx);
			return;
		}

		let initialized = false;
		if (currentRoot !== ROOT) {
			const detail = currentRoot
				? `Pi state is inside another Git repository:\n${currentRoot}\n\nCreate a dedicated repository at:\n${ROOT}`
				: `Create a Git repository for Pi state at:\n${ROOT}`;
			const approved = !ctx.hasUI || await ctx.ui.confirm("Configure Pi state", detail);
			if (!approved) {
				ctx.ui.notify("Pi state configuration cancelled", "info");
				return;
			}
			await git(["init", "-b", "main", "."]);
			initialized = true;
		}

		const gitignorePath = join(ROOT, ".gitignore");
		const existingIgnore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
		const mergedIgnore = mergeGitignore(existingIgnore);
		if (mergedIgnore.added.length > 0) writeFileSync(gitignorePath, mergedIgnore.content, "utf8");

		const auth = mode === "local"
			? undefined
			: await gh(["auth", "status", "--hostname", "github.com"], true);
		let githubUser: string | undefined;
		if (auth?.code === 0) {
			const user = await gh(["api", "user", "--jq", ".login"]);
			githubUser = user.stdout.trim();
		}

		if (!target && mode === "new" && ctx.hasUI) {
			target = (await ctx.ui.input(
				"New private GitHub repository",
				githubUser ? `${githubUser}/pi-state` : "owner/pi-state",
			))?.trim() ?? "";
			if (!target) {
				ctx.ui.notify("Pi state configuration cancelled", "info");
				return;
			}
		}

		let remoteUrl: string | undefined;
		if (mode === "new" && target) {
			if (!isSafeRemoteUrl(target)) throw new Error("Invalid GitHub owner/repository name");
			const slug = githubSlugFromTarget(target);
			if (!slug) throw new Error("New repository must use a GitHub owner/repository name");
			if (auth?.code !== 0) throw new Error("GitHub CLI is not authenticated. Run: gh auth login");
			const lookup = await gh(["repo", "view", slug, "--json", "sshUrl", "--jq", ".sshUrl"], true);
			if (lookup.code === 0) throw new Error(`${slug} already exists. Choose 'Connect an existing repository'.`);
			const create = !ctx.hasUI || await ctx.ui.confirm(
				"Create private GitHub repository?",
				`Create ${slug} as a private repository?`,
			);
			if (!create) {
				ctx.ui.notify("GitHub repository creation cancelled", "info");
				return;
			}
			await gh(["repo", "create", slug, "--private", "--description", "Private Pi configuration state"]);
			const created = await gh(["repo", "view", slug, "--json", "sshUrl", "--jq", ".sshUrl"]);
			remoteUrl = created.stdout.trim();
		}

		if (mode === "local" && currentOrigin) {
			const remove = ctx.hasUI && await ctx.ui.confirm(
				"Use local repository only?",
				`Remove existing origin ${currentOrigin}? Local history will be kept.`,
			);
			if (remove) await git(["remote", "remove", "origin"]);
		}

		if (remoteUrl) {
			const origin = await git(["remote", "get-url", "origin"], true);
			if (origin.code === 0 && origin.stdout.trim() !== remoteUrl) {
				const replace = !ctx.hasUI || await ctx.ui.confirm(
					"Replace Git remote?",
					`Current origin:\n${origin.stdout.trim()}\n\nNew origin:\n${remoteUrl}`,
				);
				if (!replace) {
					ctx.ui.notify("Kept existing Git origin", "info");
					return;
				}
				await git(["remote", "set-url", "origin", remoteUrl]);
			} else if (origin.code !== 0) {
				await git(["remote", "add", "origin", remoteUrl]);
			}
		}

		const finalOrigin = await git(["remote", "get-url", "origin"], true);
		const remoteStatus = finalOrigin.code === 0 ? finalOrigin.stdout.trim() : "not configured";
		const readmePath = join(ROOT, "README.md");
		let createdReadme = false;
		if (!existsSync(readmePath)) {
			const remoteHead = remoteStatus === "not configured"
				? undefined
				: await git(["ls-remote", "--exit-code", "origin", "HEAD"], true);
			if (!remoteHead || remoteHead.code === 2) {
				writeFileSync(readmePath, buildStateReadme(remoteStatus === "not configured" ? undefined : remoteStatus), "utf8");
				createdReadme = true;
			}
		}

		ctx.ui.notify(
			[
				initialized ? `Initialized Git repository: ${ROOT}` : `Git repository ready: ${ROOT}`,
				mergedIgnore.added.length > 0 ? `Protected ${mergedIgnore.added.length} local paths` : "Local paths already protected",
				createdReadme ? "Created README.md with new-host setup instructions" : "README.md preserved or available from origin",
				`Origin: ${remoteStatus}`,
				"Next: /pistate snapshot chore: initialize Pi state",
				remoteStatus !== "not configured" ? "Then: /pistate push" : "Optional: /pistate configure existing <remote>",
			].join("\n"),
			"info",
		);
	}

	async function assertNoTrackedRuntimeState(): Promise<void> {
		const result = await git(["ls-files", "-z"]);
		const forbidden = result.stdout.split("\0").filter(Boolean).filter(isForbiddenTrackedPath);
		if (forbidden.length > 0) {
			throw new Error(`Refusing to sync tracked private/runtime files: ${forbidden.join(", ")}`);
		}
	}

	function assertPortableConfig(): void {
		const issues = inspectPortableJson(ROOT);
		if (issues.length > 0) {
			throw new Error(
				`Possible literal secrets or invalid config. Use dotenvx env references instead: ${issues.join(", ")}`,
			);
		}
	}

	async function stageAllowedPaths(): Promise<void> {
		for (const path of ALLOWED_PATHS) {
			const result = await git(["add", "-A", "--", path], true);
			if (result.code !== 0 && existsSync(resolve(ROOT, path))) {
				throw new Error(result.stderr.trim() || `Could not stage ${path}`);
			}
		}

		const staged = await git(["diff", "--cached", "--name-only", "-z"]);
		const forbidden = staged.stdout.split("\0").filter(Boolean).filter(isForbiddenTrackedPath);
		if (forbidden.length > 0) {
			throw new Error(`Forbidden files are already staged: ${forbidden.join(", ")}`);
		}
	}

	async function runDotenvxPrecommit(): Promise<void> {
		const cli = resolveDotenvxCli();
		const command = cli ? process.execPath : "dotenvx";
		const args = cli ? [cli, "ext", "precommit", "."] : ["ext", "precommit", "."];
		const result = await pi.exec(command, args, { cwd: ROOT, timeout: GIT_TIMEOUT_MS });
		if (result.code !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim() || "dotenvx precommit check failed");
		}
	}

	pi.registerCommand("pistate", {
		description: "Manage Git-backed Pi state: configure, status, snapshot, pull, push",
		getArgumentCompletions: (prefix) => {
			if (prefix.startsWith("configure ")) {
				const modePrefix = prefix.slice("configure ".length);
				if (/\s/.test(modePrefix)) return null;
				const modes = ["new", "existing", "local", "reset"].filter((mode) => mode.startsWith(modePrefix));
				return modes.length > 0
					? modes.map((mode) => ({ value: `configure ${mode}`, label: mode }))
					: null;
			}
			if (/\s/.test(prefix)) return null;
			const matches = COMMANDS.filter((command) => command.startsWith(prefix));
			return matches.length > 0 ? matches.map((command) => ({ value: command, label: command })) : null;
		},
		handler: async (args, ctx) => {
			const { action, rest } = parseCommand(args);

			try {
				if (action === "configure") {
					await configureRepository(rest, ctx);
					return;
				}

				await assertRepositoryRoot();

				switch (action) {
					case "status": {
						const result = await git(["status", "--short"]);
						ctx.ui.notify(result.stdout.trim() || "Pi state clean", "info");
						return;
					}

					case "snapshot": {
						await assertNoTrackedRuntimeState();
						assertPortableConfig();
						await stageAllowedPaths();
						await runDotenvxPrecommit();

						const changed = await git(["diff", "--cached", "--quiet"], true);
						if (changed.code === 0) {
							ctx.ui.notify("No Pi state changes", "info");
							return;
						}
						if (changed.code !== 1) {
							throw new Error(changed.stderr.trim() || "Could not inspect staged changes");
						}

						const message = rest || "chore: update pi state";
						await git(["commit", "-m", message]);
						ctx.ui.notify(`Committed: ${message}`, "info");
						return;
					}

					case "pull": {
						const status = await git(["status", "--porcelain"]);
						if (status.stdout.trim()) {
							throw new Error("State repo dirty. Snapshot or discard changes first.");
						}

						const oldHead = await git(["rev-parse", "HEAD"]);
						await git(["pull", "--ff-only"]);
						await assertNoTrackedRuntimeState();
						assertPortableConfig();

						const newHead = await git(["rev-parse", "HEAD"]);
						const changedFiles = await git([
							"diff",
							"--name-only",
							oldHead.stdout.trim(),
							newHead.stdout.trim(),
						]);
						const envChanged = changedFiles.stdout.split("\n").includes(".env");
						ctx.ui.notify(envChanged ? "Pulled. Restart Pi to load changed secrets." : "Pulled Pi state", "info");
						await ctx.reload();
						return;
					}

					case "push": {
						await assertNoTrackedRuntimeState();
						assertPortableConfig();
						await git(["push"]);
						ctx.ui.notify("Pushed Pi state", "info");
						return;
					}

					default:
						ctx.ui.notify(
							"/pistate configure [new|existing|local|reset] [target] | status | snapshot [message] | pull | push",
							"info",
						);
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
