import { allowAllTelegramUsers, getAllowedUsers } from "../auth.js";

/**
 * Check if a user ID is in the allowlist.
 * Re-reads env on each call (matches existing getAllowedUsers behavior).
 * An empty allowlist fails closed unless explicitly opened for development.
 */
export function isAllowedUser(userId: string | number | undefined | null): boolean {
  const allowed = getAllowedUsers();
  if (allowed.size === 0) return allowAllTelegramUsers();
  if (userId == null) return false;    // no identity → block when allowlist is active
  return allowed.has(String(userId));
}
