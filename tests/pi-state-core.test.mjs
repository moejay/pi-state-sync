import assert from "node:assert/strict";
import test from "node:test";
import {
	findUnsafeSecretLiterals,
	githubSlugFromTarget,
	isForbiddenTrackedPath,
	mergeGitignore,
	parseCommand,
} from "../extensions/pi-state/core.ts";

test("parseCommand separates action and free-form snapshot message", () => {
	assert.deepEqual(parseCommand("snapshot feat: sync config"), {
		action: "snapshot",
		rest: "feat: sync config",
	});
	assert.deepEqual(parseCommand(""), { action: "help", rest: "" });
});

test("configure helpers merge ignores and recognize GitHub repositories", () => {
	const merged = mergeGitignore("auth.json\ncustom-cache/\n");
	assert.equal(merged.added.includes("auth.json"), false);
	assert.equal(merged.added.includes(".env.keys"), true);
	assert.match(merged.content, /custom-cache\/.*pi-state-sync/s);
	assert.equal(githubSlugFromTarget("moejay/pi-state"), "moejay/pi-state");
	assert.equal(githubSlugFromTarget("git@github.com:moejay/pi-state.git"), "moejay/pi-state");
	assert.equal(githubSlugFromTarget("https://github.com/moejay/pi-state"), "moejay/pi-state");
	assert.equal(githubSlugFromTarget("git@example.com:moejay/pi-state.git"), undefined);
});

test("runtime and credential paths are forbidden", () => {
	for (const path of ["auth.json", ".env.keys", "sessions/a.jsonl", "npm/package.json", "git/repo/config"]) {
		assert.equal(isForbiddenTrackedPath(path), true, path);
	}
	assert.equal(isForbiddenTrackedPath("extensions/pi-state/index.ts"), false);
	assert.equal(isForbiddenTrackedPath(".env"), false);
});

test("literal secrets are rejected while env and command references are allowed", () => {
	const issues = findUnsafeSecretLiterals({
		providers: {
			unsafe: { apiKey: "sk-secret" },
			env: { apiKey: "$API_KEY" },
			command: { apiKey: "!op read op://vault/key" },
			ollama: { apiKey: "ollama" },
		},
	});
	assert.deepEqual(issues, ["$.providers.unsafe.apiKey"]);
});
