import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Claude Pocket Console Database Schema
 * 
 * This file defines the structure of all tables in the Convex database.
 * Each table represents a core entity in the system.
 */

export default defineSchema({
  // Users table - stores user account information
  users: defineTable({
    // TODO: Add user fields
    // - email: v.string()
    // - name: v.string()
    // - createdAt: v.number()
    // - lastLoginAt: v.optional(v.number())
  }),

  // Sessions table - manages user sessions
  sessions: defineTable({
    // TODO: Add session fields
    // - userId: v.id("users")
    // - token: v.string()
    // - expiresAt: v.number()
    // - createdAt: v.number()
  }),

  // Commands table - logs all executed commands
  commands: defineTable({
    // TODO: Add command fields
    // - userId: v.id("users")
    // - sessionId: v.id("sessions")
    // - command: v.string()
    // - output: v.optional(v.string())
    // - executedAt: v.number()
    // - status: v.union(v.literal("success"), v.literal("error"))
  }),

  // Sandboxes table - manages Docker sandbox instances
  sandboxes: defineTable({
    // TODO: Add sandbox fields
    // - userId: v.id("users")
    // - containerId: v.string()
    // - status: v.union(v.literal("running"), v.literal("stopped"), v.literal("terminated"))
    // - createdAt: v.number()
    // - lastAccessedAt: v.number()
  }),
});

// TODO: Add indexes for efficient queries
// Example:
// .index("by_user", ["userId"])
// .index("by_session", ["sessionId"])