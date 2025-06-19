import { z } from 'zod';

/**
 * Session status enumeration
 * Tracks the lifecycle state of a console session
 */
export const SessionStatusSchema = z.enum([
  'initializing',
  'active',
  'paused',
  'disconnected',
  'terminated',
  'error',
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * Session type enumeration
 * Different types of console sessions available
 */
export const SessionTypeSchema = z.enum([
  'interactive',  // Standard interactive terminal
  'script',       // Script execution session
  'debug',        // Debug/development session
  'remote',       // Remote connection session
]);

export type SessionType = z.infer<typeof SessionTypeSchema>;

/**
 * Session metadata schema
 * Additional information about the session
 */
export const SessionMetadataSchema = z.object({
  clientIp: z.string().ip().optional(),
  userAgent: z.string().optional(),
  terminalSize: z.object({
    rows: z.number().int().positive(),
    cols: z.number().int().positive(),
  }).optional(),
  environment: z.record(z.string()).optional(),
  workingDirectory: z.string().optional(),
});

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

/**
 * Session schema
 * Represents an active console session
 */
export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: SessionTypeSchema,
  status: SessionStatusSchema,
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  metadata: SessionMetadataSchema,
  startedAt: z.date(),
  lastActivityAt: z.date(),
  endedAt: z.date().nullable(),
  commandCount: z.number().int().nonnegative().default(0),
  errorCount: z.number().int().nonnegative().default(0),
});

export type Session = z.infer<typeof SessionSchema>;

/**
 * Create session input schema
 * Used when starting a new session
 */
export const CreateSessionSchema = SessionSchema.pick({
  type: true,
  name: true,
  description: true,
}).extend({
  metadata: SessionMetadataSchema.partial(),
});

export type CreateSession = z.infer<typeof CreateSessionSchema>;

/**
 * Session activity schema
 * Tracks user activity within a session
 */
export const SessionActivitySchema = z.object({
  sessionId: z.string().uuid(),
  timestamp: z.date(),
  type: z.enum(['command', 'output', 'error', 'system']),
  data: z.any(), // Flexible data field for different activity types
});

export type SessionActivity = z.infer<typeof SessionActivitySchema>;