import assert from "node:assert/strict";
import { assertActionAllowed, assertOriginAllowed, loadPolicy, redactForLog } from "../src/policy.js";

const policy = loadPolicy();
assert.ok(policy.allowedOrigins.includes("http://127.0.0.1:3000"));

assertOriginAllowed("http://127.0.0.1:3000/member.html");
assert.throws(() => assertOriginAllowed("https://evil.example/"), /allowlist/);

assertActionAllowed("click", "Search");
assert.throws(() => assertActionAllowed("click", "Transfer"), /irreversible/);
assert.throws(() => assertActionAllowed("click", "Submit wire"), /irreversible/);

assert.throws(() => assertActionAllowed("type", "Password"), /sensitive/);
assert.equal(redactForLog("Password", "hunter2"), "[redacted]");
assert.equal(redactForLog("Member ID", "12345"), "12345");

console.log("policy ok");
