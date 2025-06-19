# Convex Backend for Claude Pocket Console

This directory contains the Convex backend implementation for the Claude Pocket Console.

## Overview

Convex provides the real-time database and serverless functions that power the console's backend functionality.

## Structure

- `package.json` - Package configuration for the Convex backend
- `schema.ts` - Database schema definitions for all tables
- `auth.ts` - Authentication and authorization functions
- `sessions.ts` - Terminal session management functions
- `commands.ts` - Command logging and history functions

## Key Features

### Database Tables

1. **Users** - User account information
2. **Sessions** - Active terminal sessions
3. **Commands** - Command execution history
4. **Sandboxes** - Docker container instances

### Core Functionality

- **Authentication**: User registration, login, and session validation
- **Session Management**: Create, track, and terminate terminal sessions
- **Command Logging**: Record all executed commands with output
- **Real-time Updates**: Leverage Convex's reactive queries

## Development

```bash
# Install dependencies
npm install

# Start Convex dev server
npm run dev

# Deploy to production
npm run deploy
```

## Environment Variables

Configure the following in your Convex dashboard:

- `AUTH_SECRET` - Secret key for authentication
- `SESSION_DURATION` - Session timeout in milliseconds
- `MAX_SESSIONS_PER_USER` - Concurrent session limit

## Security Considerations

- All mutations require authentication
- Session tokens expire after inactivity
- Commands are logged with user attribution
- Sandbox access is isolated per user

## Integration

The Convex backend integrates with:

- Next.js web application via Convex React hooks
- Docker infrastructure for sandbox management
- Terraform-provisioned cloud resources