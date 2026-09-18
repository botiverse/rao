import { expect, it } from "vitest";
import { accountUsageMessage } from "./account-usage";

it("distinguishes missing capability, unsupported auth and unknown causes", () => {
  expect(accountUsageMessage({ kind: "unsupported", reason: "capability_unavailable" })).toContain(
    "does not provide",
  );
  expect(accountUsageMessage({ kind: "unsupported", reason: "unsupported_auth_mode" })).toContain(
    "authentication mode",
  );
  expect(accountUsageMessage({ kind: "unsupported" })).toContain(
    "did not report a specific reason",
  );
  expect(accountUsageMessage({ kind: "reauth_required", reason: "scope_missing" })).toContain(
    "permissions",
  );
});

it("does not infer an authentication failure from unavailable quota", () => {
  expect(accountUsageMessage({ kind: "unsupported", reason: "quota_unavailable" })).toBe(
    "The runtime did not provide account quota data for the current session.",
  );
});
