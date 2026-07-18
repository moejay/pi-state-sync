import assert from "node:assert/strict";
import test from "node:test";
import {
	findUnsafeSecretLiterals,
	isForbiddenTrackedPath,
	parseCommand,
} from "../extensions/pi-state/core.ts";

test("parseCommand separates action and free-form snapshot message", () => {
	assert.deepEqual(parseCommand("snapshot feat: sync config"), {
		action: "snapshot",
		rest: "feat: sync config",
	});
	assert.deepEqual(parseCommand(""), { action: "help", rest: "" });
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
