import { z } from 'zod';

/**
 * Command status enumeration
 * Tracks the execution state of a command
 */
export const CommandStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);

export type CommandStatus = z.infer<typeof CommandStatusSchema>;

/**
 * Command type enumeration
 * Different categories of commands
 */
export const CommandTypeSchema = z.enum([
  'system',       // System-level commands
  'builtin',      // Built-in console commands
  'alias',        // User-defined aliases
  'script',       // Script executions
  'external',     // External program calls
]);

export type CommandType = z.infer<typeof CommandTypeSchema>;

/**
 * Command output schema
 * Captures the output from command execution
 */
export const CommandOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
});

export type CommandOutput = z.infer<typeof CommandOutputSchema>;

/**
 * Command schema
 * Represents a command executed within a session
 */
export const CommandSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
  type: CommandTypeSchema,
  status: CommandStatusSchema,
  command: z.string().min(1),
  arguments: z.array(z.string()).default([]),
  workingDirectory: z.string(),
  environment: z.record(z.string()).optional(),
  output: CommandOutputSchema.nullable(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
  duration: z.number().nonnegative().nullable(), // Duration in milliseconds
  metadata: z.record(z.any()).optional(),
});

export type Command = z.infer<typeof CommandSchema>;

/**
 * Execute command input schema
 * Used when executing a new command
 */
export const ExecuteCommandSchema = z.object({
  sessionId: z.string().uuid(),
  command: z.string().min(1),
  arguments: z.array(z.string()).optional(),
  workingDirectory: z.string().optional(),
  environment: z.record(z.string()).optional(),
  timeout: z.number().positive().optional(), // Timeout in milliseconds
});

export type ExecuteCommand = z.infer<typeof ExecuteCommandSchema>;

/**
 * Command history entry schema
 * Simplified version for displaying command history
 */
export const CommandHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  command: z.string(),
  executedAt: z.date(),
  status: CommandStatusSchema,
  duration: z.number().nullable(),
});

export type CommandHistoryEntry = z.infer<typeof CommandHistoryEntrySchema>;

/**
 * Command suggestion schema
 * Used for command autocompletion and suggestions
 */
export const CommandSuggestionSchema = z.object({
  command: z.string(),
  description: z.string().optional(),
  usage: z.string().optional(),
  score: z.number().min(0).max(1), // Relevance score
  type: CommandTypeSchema,
});

export type CommandSuggestion = z.infer<typeof CommandSuggestionSchema>;