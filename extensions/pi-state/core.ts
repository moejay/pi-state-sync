import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const COMMANDS = ["configure", "status", "snapshot", "pull", "push"] as const;

export const GITIGNORE_ENTRIES = [
	".env.keys",
	"auth.json",
	"trust.json",
	"models-store.json",
	"sessions/",
	"npm/",
	"git/",
	"bin/",
	"node_modules/",
] as const;

export const ALLOWED_PATHS = [
	".env",
	".gitignore",
	"README.md",
	"settings.json",
	"models.json",
	"keybindings.json",
	"AGENTS.md",
	"SYSTEM.md",
	"APPEND_SYSTEM.md",
	"extensions",
	"skills",
	"prompts",
	"themes",
] as const;

const FORBIDDEN_FILES = new Set([
	".env.keys",
	"auth.json",
	"trust.json",
	"models-store.json",
]);

const FORBIDDEN_DIRECTORIES = ["sessions", "npm", "git", "bin", "node_modules"];
const SECRET_KEY_PATTERN = /(?:api[-_]?key|token|secret|password|authorization)/i;
const SAFE_LITERAL_SECRETS = new Set(["dummy", "local", "none", "ollama"]);

export interface ParsedCommand {
	action: (typeof COMMANDS)[number] | "help" | string;
	rest: string;
}

export function resolveStateRoot(): string {
	return resolve(
		process.env.PI_STATE_DIR ??
			process.env.PI_CODING_AGENT_DIR ??
			join(homedir(), ".pi", "agent"),
	);
}

export function parseCommand(input: string): ParsedCommand {
	const trimmed = input.trim();
	if (!trimmed) return { action: "help", rest: "" };

	const separator = trimmed.search(/\s/);
	if (separator === -1) return { action: trimmed, rest: "" };

	return {
		action: trimmed.slice(0, separator),
		rest: trimmed.slice(separator).trim(),
	};
}

export function buildStateReadme(remote?: string): string {
	const cloneSource = remote ?? "git@github.com:YOUR_USER/YOUR_PI_STATE.git";
	return `# Pi state

Private, Git-backed configuration shared across Pi installations.

Managed with [@moejay/pi-state-sync](https://github.com/moejay/pi-state-sync).

## What belongs here

- Pi settings and model definitions
- Extensions, skills, prompts, and themes
- Context and system prompt files
- Encrypted \`.env\` values

Host-local credentials, dotenvx private keys, trust decisions, sessions, package caches, and generated files are intentionally ignored.

## Set up a new host

Install Pi, then clone this repository as its agent directory:

\`\`\`bash
mv ~/.pi/agent ~/.pi/agent.backup 2>/dev/null || true
git clone ${cloneSource} ~/.pi/agent
pi
\`\`\`

If Pi does not restore the package automatically:

\`\`\`bash
pi install npm:@moejay/pi-state-sync
\`\`\`

Authenticate providers separately on every host:

\`\`\`text
/login
\`\`\`

Transfer \`.env.keys\` through a secure channel or provide \`DOTENV_PRIVATE_KEY\` from a password manager. Never commit either private key.

## Daily workflow

Before work on another host:

\`\`\`text
/pistate pull
\`\`\`

After changing Pi configuration:

\`\`\`text
/pistate status
/pistate snapshot chore: update Pi state
/pistate push
\`\`\`

## Safety

Review staged changes before the first push. This repository must remain private because configuration and instructions can still contain sensitive operational details.
`;
}

export function mergeGitignore(content: string): { content: string; added: string[] } {
	const existing = new Set(
		content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean),
	);
	const added = GITIGNORE_ENTRIES.filter((entry) => !existing.has(entry));
	if (added.length === 0) return { content, added: [] };

	let merged = content;
	if (merged && !merged.endsWith("\n")) merged += "\n";
	if (merged.trim()) merged += "\n";
	merged += `# pi-state-sync: host-local credentials and runtime data\n${added.join("\n")}\n`;
	return { content: merged, added: [...added] };
}

export function isSafeRemoteUrl(input: string): boolean {
	const remote = input.trim();
	return remote.length > 0 && !remote.startsWith("-") && !/[\s\0\r\n]/.test(remote);
}

export function githubSlugFromTarget(input: string): string | undefined {
	const target = input.trim().replace(/\.git$/, "");
	const direct = target.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+)$/);
	if (direct) return direct[1];

	const ssh = target.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
	if (ssh) return ssh[1];

	try {
		const url = new URL(target);
		if (url.hostname.toLowerCase() !== "github.com") return undefined;
		const path = url.pathname.replace(/^\/+|\/+$/g, "");
		return /^[^/]+\/[^/]+$/.test(path) ? path : undefined;
	} catch {
		return undefined;
	}
}

export function isForbiddenTrackedPath(input: string): boolean {
	const path = input.replaceAll("\\", "/").replace(/^\.\//, "");
	if (FORBIDDEN_FILES.has(path)) return true;
	return FORBIDDEN_DIRECTORIES.some((directory) => path === directory || path.startsWith(`${directory}/`));
}

export function findUnsafeSecretLiterals(value: unknown, path = "$", issues: string[] = []): string[] {
	if (Array.isArray(value)) {
		value.forEach((item, index) => findUnsafeSecretLiterals(item, `${path}[${index}]`, issues));
		return issues;
	}

	if (!value || typeof value !== "object") return issues;

	for (const [key, child] of Object.entries(value)) {
		const childPath = `${path}.${key}`;
		if (typeof child === "string" && SECRET_KEY_PATTERN.test(key) && !isSafeSecretReference(child)) {
			issues.push(childPath);
			continue;
		}
		findUnsafeSecretLiterals(child, childPath, issues);
	}

	return issues;
}

export function inspectPortableJson(root: string): string[] {
	const issues: string[] = [];
	for (const name of ["settings.json", "models.json"]) {
		const path = join(root, name);
		if (!existsSync(path)) continue;

		try {
			const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
			for (const issue of findUnsafeSecretLiterals(value)) {
				issues.push(`${name}:${issue}`);
			}
		} catch (error) {
			issues.push(`${name}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
		}
	}
	return issues;
}

function isSafeSecretReference(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.startsWith("$") || trimmed.startsWith("!") || SAFE_LITERAL_SECRETS.has(trimmed.toLowerCase());
}
