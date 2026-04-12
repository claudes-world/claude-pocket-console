import { getAllowedUsers } from "../auth.js";

/**
 * Check if a user ID is in the allowlist.
 * Re-reads env on each call (matches existing getAllowedUsers behavior).
 * Empty allowlist = all users allowed (dev convenience).
 */
export function isAllowedUser(userId: string | number | undefined | null): boolean {
  const allowed = getAllowedUsers();
  if (allowed.size === 0) return true; // dev convenience: empty allowlist = open
  if (userId == null) return false;    // no identity → block when allowlist is active
  return allowed.has(String(userId));
}
