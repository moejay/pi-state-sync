import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ALLOWED_PATHS,
	COMMANDS,
	inspectPortableJson,
	isForbiddenTrackedPath,
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
	async function git(args: string[], allowFailure = false): Promise<ExecResult> {
		const result = await pi.exec("git", ["-C", ROOT, ...args], { timeout: GIT_TIMEOUT_MS });
		if (!allowFailure && result.code !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed`);
		}
		return result;
	}

	async function assertRepositoryRoot(): Promise<void> {
		const result = await git(["rev-parse", "--show-toplevel"]);
		if (resolve(result.stdout.trim()) !== ROOT) {
			throw new Error(`PI state root is not its own Git repository: ${ROOT}`);
		}
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
		description: "Manage Git-backed Pi state: status, snapshot, pull, push",
		getArgumentCompletions: (prefix) => {
			if (/\s/.test(prefix)) return null;
			const matches = COMMANDS.filter((command) => command.startsWith(prefix));
			return matches.length > 0 ? matches.map((command) => ({ value: command, label: command })) : null;
		},
		handler: async (args, ctx) => {
			const { action, rest } = parseCommand(args);

			try {
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
							"/pistate status | snapshot [message] | pull | push",
							"info",
						);
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
