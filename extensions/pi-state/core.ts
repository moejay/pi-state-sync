import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const COMMANDS = ["status", "snapshot", "pull", "push"] as const;

export const ALLOWED_PATHS = [
	".env",
	".gitignore",
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
