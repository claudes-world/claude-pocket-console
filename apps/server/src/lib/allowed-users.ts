import { getAllowedUsers } from "../auth.js";

/**
 * Check if a user ID is in the allowlist.
 * Re-reads env on each call (matches existing getAllowedUsers behavior).
 * Empty allowlist = all users allowed (dev convenience).
 */
export function isAllowedUser(userId: string | number): boolean {
  const allowed = getAllowedUsers();
  return allowed.size === 0 || allowed.has(String(userId));
}
