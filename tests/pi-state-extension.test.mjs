import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function git(root, ...args) {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

test("snapshot commits allowlisted state and leaves credentials untracked", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-state-sync-"));
	try {
		git(root, "init", "-b", "main");
		git(root, "config", "user.name", "Pi State Test");
		git(root, "config", "user.email", "pi-state@example.invalid");
		mkdirSync(join(root, "extensions"), { recursive: true });
		writeFileSync(join(root, ".gitignore"), "auth.json\n.env.keys\nsessions/\nnpm/\ngit/\nbin/\nnode_modules/\n");
		writeFileSync(join(root, ".env"), "# encrypted values go here\n");
		writeFileSync(join(root, "settings.json"), "{}\n");
		writeFileSync(join(root, "extensions", "example.ts"), "export default () => {};\n");
		writeFileSync(join(root, "auth.json"), '{"token":"must-stay-local"}\n');

		process.env.PI_STATE_DIR = root;
		const { default: register } = await import(`../extensions/pi-state/index.ts?test=${Date.now()}`);

		let command;
		const notifications = [];
		const pi = {
			async exec(executable, args, options = {}) {
				const result = spawnSync(executable, args, {
					cwd: options.cwd,
					encoding: "utf8",
					timeout: options.timeout,
				});
				return {
					stdout: result.stdout ?? "",
					stderr: result.stderr ?? "",
					code: result.status ?? (result.error ? 1 : 0),
					killed: Boolean(result.signal),
				};
			},
			registerCommand(name, definition) {
				if (name === "pistate") command = definition;
			},
		};

		register(pi);
		assert.ok(command, "pistate command registered");

		await command.handler("snapshot test: save portable state", {
			ui: { notify: (message, level) => notifications.push({ message, level }) },
		});

		assert.equal(notifications.at(-1)?.level, "info", JSON.stringify(notifications));
		assert.equal(git(root, "log", "-1", "--pretty=%s"), "test: save portable state");
		assert.equal(git(root, "ls-files", "auth.json"), "");
		assert.match(git(root, "ls-files"), /settings\.json/);
		assert.deepEqual(notifications.at(-1), {
			message: "Committed: test: save portable state",
			level: "info",
		});
	} finally {
		delete process.env.PI_STATE_DIR;
		rmSync(root, { recursive: true, force: true });
	}
});
