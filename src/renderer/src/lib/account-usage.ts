import type { AccountUsageSnapshot } from "@botiverse/oar";

const REASONS: Readonly<Record<string, string>> = {
  capability_unavailable: "This runtime does not provide account usage queries.",
  unsupported_installation: "Account usage is unavailable for this installation type.",
  unsupported_auth_mode:
    "The usage reader does not support the current authentication mode. It requires a subscription login rather than an API key or externally supplied token.",
  unsupported_auth_storage: "The usage reader cannot read the configured credential storage.",
  auth_configuration_unavailable: "The runtime’s account configuration could not be resolved.",
  endpoint_unavailable: "The runtime or provider does not expose the usage endpoint.",
  quota_unavailable: "The runtime did not provide account quota data for the current session.",
  not_authenticated: "Sign in with this runtime’s CLI, then refresh.",
  credentials_missing:
    "No usable saved login credential was found. Sign in with the runtime’s CLI, then refresh.",
  scope_missing:
    "The saved credential lacks the permissions required to read usage. Sign in again with the runtime’s CLI.",
  credentials_rejected:
    "The usage endpoint rejected the saved credential. Sign in again with the runtime’s CLI.",
};

/** Older adapters may omit reason; never infer a cause from the runtime name. */
export function accountUsageMessage(
  result: Exclude<AccountUsageSnapshot, { kind: "available" }> & { readonly reason?: string },
): string {
  const specific = result.reason ? REASONS[result.reason] : undefined;
  if (specific) return specific;
  return result.kind === "reauth_required"
    ? "The runtime requires authentication to read usage. Sign in again, then refresh."
    : "Account usage is unavailable. The runtime did not report a specific reason.";
}
