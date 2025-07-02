# Claudia Architecture Overview

**Synthesis from 5 Specialist Agent Analyses**

## Executive Summary

Claudia is a sophisticated **Tauri-based GUI wrapper for Claude Code CLI** that transforms command-line AI development into a visual, secure, and intuitive experience. The architecture demonstrates advanced patterns in **session management**, **OS-level security**, **MCP protocol integration**, **AI workflow orchestration**, and **mobile-adaptable UI design**.

## Core Architecture

### Technology Stack
- **Frontend**: React 18 + TypeScript + Tailwind CSS + Radix UI
- **Backend**: Rust with Tauri 2 framework
- **Database**: SQLite for local data persistence
- **Security**: OS-level sandboxing via `gaol` library
- **Animation**: Framer Motion for sophisticated UI interactions
- **Package Management**: Bun for rapid development

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Claudia Application                      │
├─────────────────────────────────────────────────────────────┤
│  React Frontend (TypeScript)                               │
│  ├─ Session Management UI                                  │
│  ├─ Agent Creation & Execution                             │
│  ├─ MCP Server Management                                  │
│  ├─ Security Profile Configuration                         │
│  └─ Real-time Output Streaming                             │
├─────────────────────────────────────────────────────────────┤
│  Tauri API Bridge                                          │
│  ├─ IPC Communication Layer                                │
│  ├─ State Management & Events                              │
│  └─ WebSocket-like Event System                            │
├─────────────────────────────────────────────────────────────┤
│  Rust Backend Services                                     │
│  ├─ Claude Code CLI Integration                            │
│  ├─ Agent Workflow Management                              │
│  ├─ MCP Protocol Handling                                  │
│  ├─ OS-level Sandbox Enforcement                           │
│  └─ Database Operations (SQLite)                           │
├─────────────────────────────────────────────────────────────┤
│  System Integration Layer                                  │
│  ├─ Claude Code CLI Process Management                     │
│  ├─ MCP Server Lifecycle Control                           │
│  ├─ OS Security Primitives (gaol)                          │
│  ├─ File System Operations                                 │
│  └─ Network Communication                                  │
└─────────────────────────────────────────────────────────────┘
```

## Key Architectural Patterns

### 1. Session Management Architecture

**Event-Driven Session Lifecycle:**
- UUID-based session identification with project path encoding
- JSONL file-based persistence for conversation history
- Real-time WebSocket-style event streaming (`claude-output:{session_id}`)
- Advanced checkpoint system with file snapshots and timeline navigation

**State Persistence Strategy:**
- File-based storage in `~/.claude/projects/{encoded_path}/`
- Metadata extraction from JSONL for UI display
- Session resumption and recovery capabilities
- Integration with Claude Code's native file organization

### 2. Multi-Layered Security Model

**Defense-in-Depth Approach:**
```
User Request
    ↓
UI Permission Validation
    ↓  
Database Profile Rules
    ↓
OS-level Enforcement (gaol)
    ↓
Violation Detection & Logging
```

**Granular Permission System:**
- Agent-level toggles (file read/write, network access)
- Database-driven security profiles with template expansion
- Platform-aware capabilities (Linux/macOS/FreeBSD/Windows)
- Real-time violation tracking and forensic analysis

### 3. MCP Protocol Management

**3-Tier Configuration System:**
- **Local Scope**: Project-specific temporary configurations
- **Project Scope**: Shared `.mcp.json` configurations
- **User Scope**: Global system-wide server management

**Multi-Transport Support:**
- **STDIO**: Process-based communication with command execution
- **SSE**: HTTP streaming for network-based MCP servers
- Health monitoring with connection testing and status tracking

### 4. AI Agent Workflow Architecture

**Agent-as-Code Model:**
```json
{
  "name": "Agent Name",
  "icon": "bot",
  "system_prompt": "Instructions...",
  "model": "opus|sonnet|haiku",
  "sandbox_enabled": true,
  "enable_file_read": true,
  "enable_file_write": false,
  "enable_network": false
}
```

**Multi-Agent Orchestration:**
- Phase-based workflow execution with sub-agent spawning
- Task-oriented workflow model with tool selection
- Real-time output streaming with JSONL session integration
- GitHub-based agent library for community sharing

### 5. Component-Based UI Architecture

**React Component Hierarchy:**
- Modular component organization with clear separation of concerns
- Comprehensive UI library built on Radix UI primitives
- TypeScript-first development with strong type safety
- Performance optimizations (virtualization, code splitting)

**State Management Patterns:**
- Local React state with prop drilling for simple cases
- Context providers for performance-critical operations
- Event-driven updates for real-time communication
- Optimistic UI updates with backend confirmation

## Data Flow Architecture

### 1. Session Execution Flow

```
User Input → React UI → Tauri Command → Rust Backend 
    ↓
Claude CLI Process Spawn → Output Streaming → JSONL Storage
    ↓
Event Emission → Frontend Updates → UI Rendering
```

### 2. Security Enforcement Flow

```
Agent Execution Request → Permission Validation → Profile Building
    ↓
Sandbox Rule Compilation → OS-level Enforcement → Process Execution
    ↓
Violation Detection → Logging → UI Notifications
```

### 3. MCP Integration Flow

```
MCP Server Configuration → Transport Selection → Connection Testing
    ↓
Server Registration → Health Monitoring → Status Updates
    ↓
Claude Code Integration → Protocol Communication → Result Processing
```

## Cross-Cutting Concerns

### Performance Architecture
- **Native Performance**: OS-level sandboxing with minimal overhead (~2-5ms)
- **Efficient Streaming**: Real-time output processing with virtual scrolling
- **Resource Management**: Container-like resource limits without containerization
- **Concurrent Execution**: Multi-agent parallel processing with isolation

### Security Architecture
- **OS-level Isolation**: Platform-specific sandboxing (seccomp, Seatbelt)
- **Granular Permissions**: Fine-grained operation controls
- **Audit Trail**: Comprehensive violation tracking and analysis
- **Fail-Safe Defaults**: Security-first configuration patterns

### Scalability Architecture
- **Process Isolation**: Independent execution environments
- **Resource Monitoring**: CPU, memory, and I/O tracking
- **Queue Management**: Execution prioritization and throttling
- **Graceful Degradation**: Platform-aware capability detection

## Integration Points

### Claude Code CLI Integration
- Native CLI process management with proper lifecycle control
- Environment variable injection and argument sanitization
- Session correlation with output file tracking
- Error handling and recovery mechanisms

### System Integration
- Cross-platform OS integration (Linux, macOS, FreeBSD, Windows)
- File system access with permission controls
- Network communication with selective access
- Process management with security boundaries

### External Service Integration
- GitHub API for agent library management
- Claude Desktop configuration import/export
- MCP server ecosystem integration
- Community agent sharing and distribution

## Architecture Strengths

1. **Modularity**: Clear separation between UI, business logic, and system integration
2. **Security**: Multi-layered defense with OS-level enforcement
3. **Performance**: Native execution with minimal overhead
4. **Extensibility**: Plugin-like architecture for agents and MCP servers
5. **User Experience**: Desktop-class UI with sophisticated interactions
6. **Developer Experience**: Strong TypeScript integration with modern tooling

## Web Adaptation Considerations

### Desktop → Web Translation Patterns
1. **Tauri Commands → Web APIs**: Convert Rust commands to HTTP/WebSocket endpoints
2. **SQLite → Database**: Migrate to PostgreSQL/Convex for multi-user support
3. **OS Processes → Containers**: Replace process management with Docker isolation
4. **File System → Cloud Storage**: Adapt local storage to web-compatible persistence
5. **Desktop UI → Mobile-First**: Responsive design with touch optimization

### Architecture Preservation
- Maintain event-driven communication patterns
- Preserve session management lifecycle
- Adapt security model to container-based isolation
- Keep component-based UI architecture
- Maintain real-time streaming capabilities

---

*Synthesized from Session Management, Security, MCP Protocol, AI Workflow, and UI Architecture specialist analyses*