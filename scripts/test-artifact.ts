import assert from "node:assert/strict";
import { compileCapability } from "../src/artifact.js";

const capability = compileCapability({
  goal: "Look up member 12345 and read their current savings balance",
  entryUrl: "http://127.0.0.1:3000",
  recorded: [
    { kind: "type", locator: { by: "label", value: "Member ID" }, literal: "12345" },
    { kind: "click", locator: { by: "role", role: "button", name: "Search" } },
  ],
});

assert.equal(capability.id, "lookup-member");
assert.equal(capability.apiVersion, 1);
assert.equal(capability.steps[0]?.kind, "type");
if (capability.steps[0]?.kind === "type") {
  assert.equal(capability.steps[0].bindInput, "memberId");
  assert.equal(capability.steps[0].literal, undefined);
}
assert.equal(capability.steps[1]?.kind, "click");
assert.equal(capability.steps[2]?.kind, "extract");
if (capability.steps[2]?.kind === "extract") {
  assert.equal(capability.steps[2].bindOutput, "savingsBalance");
}
assert.equal(capability.checkpoint.notFoundText, "Record not found");
assert.equal(capability.checkpoint.validationText, "Member ID is required");
assert.equal(capability.checkpoint.appErrorText, "Application error");

console.log("artifact compile ok");
console.log(JSON.stringify(capability.steps, null, 2));
