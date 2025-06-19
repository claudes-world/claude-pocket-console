# **Architecture**

>Author: Gemini 2.5

This document provides a deep dive into the software architecture of the Claude Pocket Console, its services, and the patterns used for communication and data management.

## **1\. High-Level Overview**

The system consists of three primary, independently deployable services orchestrated within a monorepo:

1. **Web Console (apps/web):** A Next.js frontend that provides the user interface, including the real-time terminal emulator.  
2. **Terminal Server (apps/terminal-server):** A Python FastAPI service responsible for creating, managing, and streaming I/O to isolated Docker containers.  
3. **Backend (infrastructure/convex):** A Convex backend handling database, real-time data sync, user authentication, and serverless functions.

These services are supported by shared libraries (packages/) for UI, types, and configuration.

## **2\. Detailed Repository Structure**

The monorepo is organized to enforce clear boundaries between applications, shared code, and infrastructure.

claude-pocket-console/  
├── .github/  
│   └── workflows/              \# CI/CD pipelines  
├── apps/  
│   ├── web/                    \# Next.js 15.3 frontend application  
│   │   ├── src/  
│   │   │   ├── app/            \# App router pages and layouts  
│   │   │   ├── components/     \# UI components specific to the web app  
│   │   │   ├── hooks/          \# Custom hooks (e.g., useReconnectingWebSocket)  
│   │   │   └── lib/            \# Client-side helpers and utilities  
│   │   └── package.json  
│   └── terminal-server/        \# Python FastAPI service  
│       ├── src/  
│       │   ├── main.py         \# FastAPI app definition and routes  
│       │   ├── websocket.py    \# WebSocket connection management  
│       │   └── docker\_manager.py \# Logic for interacting with the Docker daemon  
│       ├── tests/  
│       ├── Dockerfile  
│       └── pyproject.toml  
├── packages/  
│   ├── ui/                     \# Shared React components (shadcn-based)  
│   ├── shared-types/           \# Single source of truth for types  
│   └── config/                 \# Shared configs (ESLint, TSConfig, etc.)  
└── infrastructure/  
    ├── convex/                 \# Convex schema, functions, and auth config  
    ├── terraform/              \# Terraform modules for GCP  
    └── docker/                 \# Dockerfiles and Docker Compose configs

## **3\. Service Specifications**

### **3.1 Web Console (apps/web)**

The frontend is a Next.js application using the App Router, styled with Tailwind CSS and shadcn/ui.

**Key Responsibilities:**

* Handling user authentication via Convex.  
* Displaying a list of active and past terminal sessions.  
* Providing a real-time terminal UI using xterm.js.  
* Managing the WebSocket connection to the Terminal Server.

**WebSocket Reconnection Logic:**

To ensure a stable user experience, the frontend uses a custom hook (useReconnectingWebSocket) that implements an exponential backoff strategy for reconnections.

// A conceptual look at hooks/useReconnectingWebSocket.ts  
export function useReconnectingWebSocket(url: string) {  
  const \[socket, setSocket\] \= useState\<WebSocket | null\>(null);  
  const \[isConnected, setIsConnected\] \= useState(false);  
  const reconnectTimeoutRef \= useRef\<NodeJS.Timeout\>();  
  const reconnectAttemptsRef \= useRef(0);

  const connect \= useCallback(() \=\> {  
    // ... connection logic ...  
    ws.onclose \= () \=\> {  
      setIsConnected(false);  
      // Exponential backoff: 1s, 2s, 4s, 8s, up to a max of 30s  
      const delay \= Math.min(1000 \* Math.pow(2, reconnectAttemptsRef.current), 30000);  
      reconnectAttemptsRef.current++;  
      reconnectTimeoutRef.current \= setTimeout(connect, delay);  
    };  
    // ...  
  }, \[url\]);

  // ... useEffect for initial connection and cleanup ...  
  return { socket, isConnected };  
}

### **3.2 Terminal Server (apps/terminal-server)**

A Python application built with FastAPI that exposes a REST and WebSocket API.

**API Endpoints:**

* POST /session: Creates a new sandboxed Docker container and returns a session\_id.  
* DELETE /session/{id}: Stops and removes the specified container.  
* WS /session/{id}: Establishes a WebSocket connection for streaming stdin, stdout, and stderr to and from the container's shell.

**Security & Container Isolation:**

The server's primary responsibility is to create **secure, isolated** environments. This is achieved by applying strict flags when launching a new container, based on the principles in docker\_manager.py:

\# A conceptual look at docker\_manager.py  
def create\_sandbox\_container(session\_id: str):  
    docker\_client.containers.run(  
        "cpc/sandbox:latest",  
        detach=True,  
        \# \--- SECURITY HARDENING \---  
        network\_mode="none",              \# Disable networking  
        read\_only=True,                   \# Make root filesystem read-only  
        tmpfs={"/tmp": "size=64m"},       \# Provide a small, writable in-memory /tmp  
        mem\_limit="256m",                 \# Max 256MB of RAM  
        cpus=0.5,                         \# Max 0.5 CPU cores  
        pids\_limit=512,                   \# Limit the number of processes  
        security\_opt=\["no-new-privileges"\], \# Prevent privilege escalation  
        user="nobody",                    \# Run as a non-root, unprivileged user  
        \# \--- END SECURITY \---  
        name=f"term-{session\_id}",  
        \# ... other params  
    )

## **4\. Shared Packages (packages/)**

### **4.1 Type-Safe Data Contracts (packages/shared-types)**

To ensure type safety and consistent validation between the TypeScript frontend and the Python backend, we use **Zod** as the single source of truth.

**Workflow:**

1. Define schemas for core data structures (e.g., Session, User) in Zod.  
2. A build script in this package automatically generates:  
   * **TypeScript types (\*.d.ts)** for use in the web app and ui package.  
   * **JSON Schemas (\*.json)** for runtime validation in the terminal-server's FastAPI routes.

This eliminates drift and ensures that if a data structure changes, both frontend and backend are updated from the same definition.

// Example: packages/shared-types/src/session.ts  
import { z } from 'zod';

export const SessionSchema \= z.object({  
  id: z.string().uuid(),  
  userId: z.string(),  
  status: z.enum(\['active', 'terminated'\]),  
  createdAt: z.date(),  
});

export type Session \= z.infer\<typeof SessionSchema\>;

## **5\. Backend & Database (infrastructure/convex)**

Convex provides our backend functionality, including the database, authentication, and serverless functions.

Convex Schema (convex/schema.ts):  
The schema defines our data tables and their relationships, which are then used to generate a fully type-safe client for the frontend.  
// convex/schema.ts  
import { defineSchema, defineTable } from "convex/server";  
import { v } from "convex/values";

export default defineSchema({  
  users: defineTable({  
    githubId: v.string(),  
    username: v.string(),  
    avatarUrl: v.optional(v.string()),  
  }).index("by\_github\_id", \["githubId"\]),

  sessions: defineTable({  
    userId: v.id("users"),  
    status: v.union(v.literal("active"), v.literal("terminated")),  
    startedAt: v.number(),  
    endedAt: v.optional(v.number()),  
  }).index("by\_user", \["userId"\]),

  command\_logs: defineTable({  
    sessionId: v.id("sessions"),  
    command: v.string(),  
    output: v.string(), // or reference to file storage  
    executedAt: v.number(),  
  }).index("by\_session", \["sessionId"\]),  
});  
