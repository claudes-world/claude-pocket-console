/**
 * @cpc/shared-types
 * 
 * Shared TypeScript types and Zod schemas for Claude Pocket Console.
 * This package provides runtime-validated schemas that can be used
 * across all applications and services in the monorepo.
 * 
 * Usage example:
 * ```typescript
 * import { UserSchema, type User } from '@cpc/shared-types';
 * 
 * // Validate data at runtime
 * const userData = UserSchema.parse(rawData);
 * 
 * // Use the inferred TypeScript type
 * const processUser = (user: User) => {
 *   console.log(user.email);
 * };
 * ```
 */

// Export all schemas
export * from './schemas/user';
export * from './schemas/session';
export * from './schemas/command';

// Re-export zod for convenience
export { z } from 'zod';