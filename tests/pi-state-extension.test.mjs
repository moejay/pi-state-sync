import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function git(root, ...args) {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

test("configure initializes a repository, protects local state, and adds origin", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-state-configure-"));
	try {
		process.env.PI_STATE_DIR = root;
		const { default: register } = await import(`../extensions/pi-state/index.ts?configure=${Date.now()}`);

		let command;
		const notifications = [];
		const pi = {
			async exec(executable, args, options = {}) {
				if (executable === "gh") return { stdout: "", stderr: "gh unavailable", code: 1, killed: false };
				if (executable === "git" && args.includes("ls-remote")) {
					return { stdout: "", stderr: "", code: 2, killed: false };
				}
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
		await command.handler("configure git@example.com:owner/pi-state.git", {
			hasUI: false,
			ui: { notify: (message, level) => notifications.push({ message, level }) },
		});

		assert.equal(git(root, "rev-parse", "--show-toplevel"), root);
		assert.equal(git(root, "remote", "get-url", "origin"), "git@example.com:owner/pi-state.git");
		const ignore = readFileSync(join(root, ".gitignore"), "utf8");
		assert.match(ignore, /auth\.json/);
		assert.match(ignore, /sessions\//);
		const readme = readFileSync(join(root, "README.md"), "utf8");
		assert.match(readme, /Set up a new host/);
		assert.match(readme, /git@example\.com:owner\/pi-state\.git/);
		assert.equal(notifications.at(-1)?.level, "info");
	} finally {
		delete process.env.PI_STATE_DIR;
		rmSync(root, { recursive: true, force: true });
	}
});

test("configure offers to create a missing private GitHub repository", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-state-github-"));
	try {
		process.env.PI_STATE_DIR = root;
		const { default: register } = await import(`../extensions/pi-state/index.ts?github=${Date.now()}`);

		let command;
		let created = false;
		const confirmations = [];
		const pi = {
			async exec(executable, args, options = {}) {
				if (executable === "gh") {
					if (args[0] === "auth") return { stdout: "", stderr: "", code: 0, killed: false };
					if (args[0] === "api") return { stdout: "moejay\n", stderr: "", code: 0, killed: false };
					if (args[0] === "repo" && args[1] === "create") {
						assert.ok(args.includes("--private"));
						created = true;
						return { stdout: "", stderr: "", code: 0, killed: false };
					}
					if (args[0] === "repo" && args[1] === "view") {
						return created
							? { stdout: "git@github.com:moejay/pi-state-test.git\n", stderr: "", code: 0, killed: false }
							: { stdout: "", stderr: "not found", code: 1, killed: false };
					}
				}
				if (executable === "git" && args.includes("ls-remote")) {
					return { stdout: "", stderr: "", code: 2, killed: false };
				}
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
		await command.handler("configure", {
			hasUI: true,
			ui: {
				select: async (_title, choices) => choices[0],
				confirm: async (title) => { confirmations.push(title); return true; },
				input: async () => "moejay/pi-state-test",
				notify: () => undefined,
			},
		});

		assert.equal(created, true);
		assert.ok(confirmations.includes("Create private GitHub repository?"));
		assert.equal(git(root, "remote", "get-url", "origin"), "git@github.com:moejay/pi-state-test.git");
		assert.match(readFileSync(join(root, "README.md"), "utf8"), /git@github\.com:moejay\/pi-state-test\.git/);
	} finally {
		delete process.env.PI_STATE_DIR;
		rmSync(root, { recursive: true, force: true });
	}
});

test("configure connects an existing repository without offering creation", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-state-existing-"));
	try {
		process.env.PI_STATE_DIR = root;
		const { default: register } = await import(`../extensions/pi-state/index.ts?existing=${Date.now()}`);
		let command;
		let createCalled = false;
		const pi = {
			async exec(executable, args, options = {}) {
				if (executable === "gh") {
					if (args[0] === "auth") return { stdout: "", stderr: "", code: 0, killed: false };
					if (args[0] === "api") return { stdout: "moejay\n", stderr: "", code: 0, killed: false };
					if (args[0] === "repo" && args[1] === "create") createCalled = true;
					if (args[0] === "repo" && args[1] === "view") {
						return { stdout: "git@github.com:moejay/existing-state.git\n", stderr: "", code: 0, killed: false };
					}
				}
				if (executable === "git" && args.includes("ls-remote")) {
					return { stdout: "abc\tHEAD\n", stderr: "", code: 0, killed: false };
				}
				const result = spawnSync(executable, args, { cwd: options.cwd, encoding: "utf8", timeout: options.timeout });
				return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 1, killed: false };
			},
			registerCommand(name, definition) { if (name === "pistate") command = definition; },
		};
		register(pi);
		await command.handler("configure", {
			hasUI: true,
			ui: {
				select: async (_title, choices) => choices[1],
				confirm: async () => true,
				input: async () => "moejay/existing-state",
				notify: () => undefined,
			},
		});
		assert.equal(createCalled, false);
		assert.equal(git(root, "remote", "get-url", "origin"), "git@github.com:moejay/existing-state.git");
	} finally {
		delete process.env.PI_STATE_DIR;
		rmSync(root, { recursive: true, force: true });
	}
});

test("configure reset removes only origin", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-state-reset-"));
	try {
		git(root, "init", "-b", "main");
		git(root, "remote", "add", "origin", "git@example.com:owner/state.git");
		process.env.PI_STATE_DIR = root;
		const { default: register } = await import(`../extensions/pi-state/index.ts?reset=${Date.now()}`);
		let command;
		const pi = {
			async exec(executable, args, options = {}) {
				const result = spawnSync(executable, args, { cwd: options.cwd, encoding: "utf8", timeout: options.timeout });
				return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 1, killed: false };
			},
			registerCommand(name, definition) { if (name === "pistate") command = definition; },
		};
		register(pi);
		await command.handler("configure reset", {
			hasUI: true,
			ui: { confirm: async () => true, notify: () => undefined },
		});
		assert.equal(git(root, "rev-parse", "--show-toplevel"), root);
		const origin = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" });
		assert.notEqual(origin.status, 0);
	} finally {
		delete process.env.PI_STATE_DIR;
		rmSync(root, { recursive: true, force: true });
	}
});

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
