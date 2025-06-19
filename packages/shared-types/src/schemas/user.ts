import { z } from 'zod';

/**
 * User role enumeration
 * Defines the different permission levels in the system
 */
export const UserRoleSchema = z.enum(['admin', 'user', 'guest']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * User preferences schema
 * Stores user-specific settings and configurations
 */
export const UserPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  language: z.string().default('en'),
  timezone: z.string().default('UTC'),
  notificationsEnabled: z.boolean().default(true),
  terminalFont: z.string().default('monospace'),
  terminalFontSize: z.number().min(8).max(32).default(14),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/**
 * User schema
 * Core user entity for authentication and identification
 */
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/, {
    message: 'Username can only contain letters, numbers, underscores, and hyphens',
  }),
  displayName: z.string().min(1).max(100),
  role: UserRoleSchema,
  preferences: UserPreferencesSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  lastLoginAt: z.date().nullable(),
  isActive: z.boolean().default(true),
});

export type User = z.infer<typeof UserSchema>;

/**
 * Create user input schema
 * Used for user registration/creation
 */
export const CreateUserSchema = UserSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
}).extend({
  password: z.string().min(8).max(100),
});

export type CreateUser = z.infer<typeof CreateUserSchema>;

/**
 * Update user input schema
 * Used for updating user profile information
 */
export const UpdateUserSchema = UserSchema.partial().omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UpdateUser = z.infer<typeof UpdateUserSchema>;