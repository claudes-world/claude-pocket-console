# Session Management Analysis - Claudia Project

**Agent**: Session Management Specialist  
**Date**: 2025-07-02  
**Focus**: Claude Code CLI session management, state persistence, and integration patterns

---

## Executive Summary

Claudia implements a sophisticated session management architecture for Claude Code CLI interactions through a Tauri-based Rust backend with React frontend. The system provides real-time session execution, state persistence, checkpointing capabilities, and agent management - all patterns that can be adapted for Pocket Console's web-based implementation.

## Key Architectural Components

### 1. Session Data Model

**Core Types:**
```typescript
interface Session {
  id: string;              // UUID-based session identifier
  project_id: string;      // Encoded project path identifier
  project_path: string;    // Actual filesystem path
  todo_data?: any;         // Associated task metadata
  created_at: number;      // Unix timestamp
  first_message?: string;  // Preview content for UI
  message_timestamp?: string;
}

interface Project {
  id: string;              // Directory-based identifier
  path: string;            // Decoded project path
  sessions: string[];      // List of session IDs
  created_at: number;      // Project creation time
}
```

**Storage Architecture:**
- Sessions stored as `.jsonl` files in `~/.claude/projects/{project_id}/`
- Each line represents a message/event in the conversation
- Project structure mirrors Claude Code's native file organization
- Metadata extracted from JSONL files for UI display

### 2. Session Lifecycle Management

#### Session Creation
```rust
// New session - via execute_claude_code
async fn execute_claude_code(project_path: String, prompt: String, model: String)

// Continue existing - via continue_claude_code  
async fn continue_claude_code(project_path: String, prompt: String, model: String)

// Resume by ID - via resume_claude_code
async fn resume_claude_code(project_path: String, session_id: String, prompt: String, model: String)
```

#### Process Management
- **Global State**: `ClaudeProcessState` with `Arc<Mutex<Option<Child>>>`
- **Process Spawning**: Tokio async process with proper environment setup
- **Session Isolation**: Event listeners with session-specific suffixes
- **Cleanup**: Automatic process termination and listener cleanup

#### Event System
```rust
// Session-specific events with isolation
claude-output:{session_id}    // Real-time output streaming
claude-error:{session_id}     // Error events
claude-complete:{session_id}  // Completion notifications
claude-cancelled:{session_id} // Cancellation events
```

### 3. Real-Time Communication Architecture

#### Frontend Event Handling
```typescript
// Session-isolated event listeners
const eventSuffix = claudeSessionId ? `:${claudeSessionId}` : '';

await listen<string>(`claude-output${eventSuffix}`, (event) => {
  const message = JSON.parse(event.payload) as ClaudeStreamMessage;
  setMessages(prev => [...prev, message]);
});
```

#### Message Processing Pipeline
1. **Raw JSONL Storage**: All events stored as-is for replay
2. **Message Parsing**: JSON parsing with error handling
3. **State Updates**: React state management with message filtering
4. **UI Rendering**: Virtual scrolling for performance

#### Session Information Extraction
```typescript
// Extract session metadata from system init message
if (message.type === "system" && message.subtype === "init" && message.session_id) {
  setClaudeSessionId(message.session_id);
  setExtractedSessionInfo({
    sessionId: message.session_id,
    projectId: projectPath.replace(/[^a-zA-Z0-9]/g, '-')
  });
}
```

### 4. State Persistence Strategy

#### File-Based Persistence
- **Session Files**: `{session_id}.jsonl` in project directories
- **Settings**: `~/.claude/settings.json` for user preferences
- **System Prompts**: `~/.claude/CLAUDE.md` for global configuration

#### Project Organization
```
~/.claude/
├── projects/
│   └── {encoded_project_path}/
│       ├── {session_id_1}.jsonl
│       ├── {session_id_2}.jsonl
│       └── ...
├── settings.json
├── CLAUDE.md
└── todos/
    └── {session_id}.json
```

#### Path Encoding/Decoding
```rust
// Project path encoding for directory names
fn decode_project_path(encoded: &str) -> String {
    encoded.replace('-', "/")  // Simplified - actual implementation more complex
}

// Extract actual path from JSONL first line
fn get_project_path_from_sessions(project_dir: &PathBuf) -> Result<String, String>
```

### 5. Checkpoint System (Advanced Feature)

#### Checkpoint Data Model
```typescript
interface Checkpoint {
  id: string;
  sessionId: string;
  projectId: string;
  messageIndex: number;     // Point in conversation
  timestamp: string;
  description?: string;
  parentCheckpointId?: string;  // For branching
  metadata: CheckpointMetadata;
}

interface CheckpointMetadata {
  totalTokens: number;
  modelUsed: string;
  userPrompt: string;
  fileChanges: number;
  snapshotSize: number;
}
```

#### Checkpoint Strategies
- **Manual**: User-initiated only
- **Per Prompt**: After each user input
- **Per Tool Use**: After tool execution
- **Smart**: After destructive operations (recommended)

#### File Snapshot System
```rust
// File state tracking at checkpoint points
interface FileSnapshot {
  checkpointId: string;
  filePath: string;
  content: string;
  hash: string;           // For change detection
  isDeleted: boolean;
  permissions?: number;
  size: number;
}
```

### 6. Session Management UI Components

#### ClaudeCodeSession Component
- **State Management**: Complex React state with session isolation
- **Message Display**: Virtual scrolling with message filtering
- **Real-time Updates**: Event-driven UI updates
- **Error Handling**: Comprehensive error states and recovery

#### Session Discovery and Navigation
```typescript
// SessionList component for project session browsing
export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  projectPath,
  onBack,
  onSessionClick,
  // ...
}) => {
  // Pagination, filtering, and metadata display
}
```

#### Running Session Management
- **Live Monitoring**: Real-time process status tracking
- **Process Control**: Kill/stop session capabilities
- **Output Streaming**: Live session output viewing
- **Resource Monitoring**: PID tracking and duration monitoring

## Web Adaptation Patterns for Pocket Console

### 1. Replace Tauri with Web Technologies

**Current Tauri Pattern:**
```rust
#[tauri::command]
pub async fn execute_claude_code(/* ... */) -> Result<(), String>
```

**Web Adaptation:**
```typescript
// FastAPI backend endpoint
POST /api/sessions/execute
{
  "project_path": "/path/to/project",
  "prompt": "user prompt",
  "model": "sonnet"
}

// WebSocket for real-time communication
const ws = new WebSocket(`ws://localhost:8000/ws/session/${sessionId}`);
```

### 2. Session Storage in Database

**Current File System:**
```
~/.claude/projects/{project_id}/{session_id}.jsonl
```

**Database Schema:**
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  project_id VARCHAR(255),
  project_path TEXT,
  created_at TIMESTAMP,
  first_message TEXT,
  status VARCHAR(50)
);

CREATE TABLE session_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES sessions(id),
  sequence_number INTEGER,
  message_type VARCHAR(50),
  content JSONB,
  timestamp TIMESTAMP
);
```

### 3. Docker Container Isolation

**Replace Process Management:**
```python
# Instead of Tokio process spawning
async def execute_claude_session(project_path: str, prompt: str):
    container = await docker_client.containers.run(
        image="claude-sandbox",
        command=["claude", "-p", prompt],
        working_dir="/workspace",
        volumes={project_path: {"bind": "/workspace", "mode": "rw"}},
        network_mode="none",  # Security isolation
        mem_limit="512m",
        cpu_quota=50000,
        detach=True
    )
    return container.id
```

### 4. WebSocket Message Protocol

**Message Format Adaptation:**
```typescript
interface WebSocketMessage {
  type: 'session_output' | 'session_error' | 'session_complete';
  session_id: string;
  sequence: number;
  data: any;
  timestamp: string;
}

// Client-side handling
ws.onmessage = (event) => {
  const message: WebSocketMessage = JSON.parse(event.data);
  handleSessionMessage(message);
};
```

### 5. Authentication and Multi-User Support

**Session Ownership:**
```typescript
interface SessionWithUser {
  id: string;
  user_id: string;        // Add user ownership
  project_id: string;
  project_path: string;
  // ... rest of session data
}

// API with auth middleware
app.get('/api/sessions', authenticate, async (req, res) => {
  const sessions = await getSessionsForUser(req.user.id);
  res.json(sessions);
});
```

## Implementation Recommendations

### Phase 1: Core Session Management
1. **Database Schema**: Implement session/message tables
2. **WebSocket Infrastructure**: Real-time communication setup
3. **Docker Integration**: Container-based Claude execution
4. **Basic UI**: Session list and execution interface

### Phase 2: Advanced Features
1. **Checkpoint System**: File snapshots and timeline navigation
2. **Session Recovery**: Resume interrupted sessions
3. **Multi-Project Support**: Project-scoped session organization
4. **Resource Management**: Container limits and cleanup

### Phase 3: Production Features
1. **User Authentication**: Multi-tenant session isolation
2. **Performance Optimization**: Message streaming and virtual scrolling
3. **Monitoring**: Session metrics and health checks
4. **Backup/Restore**: Session data persistence strategies

## Security Considerations

### Container Isolation
- **Network Isolation**: No external network access in containers
- **File System**: Read-only base with specific write permissions
- **Resource Limits**: Memory and CPU constraints
- **User Permissions**: Non-root execution within containers

### Session Security
- **User Isolation**: Sessions tied to authenticated users
- **Path Validation**: Prevent directory traversal attacks
- **Input Sanitization**: Validate all user inputs before container execution
- **Audit Logging**: Track all session activities

## Performance Optimizations

### Message Handling
- **Virtual Scrolling**: Handle large message histories efficiently
- **Message Pagination**: Load messages incrementally
- **WebSocket Compression**: Reduce bandwidth usage
- **State Management**: Optimize React re-renders

### Resource Management
- **Container Pooling**: Reuse containers when possible
- **Session Cleanup**: Automatic cleanup of inactive sessions
- **File System Monitoring**: Track disk usage for session storage
- **Memory Management**: Efficient message storage and retrieval

## Conclusion

Claudia's session management architecture provides a solid foundation for adapting to Pocket Console's web-based environment. The key patterns include:

1. **Event-Driven Architecture**: Real-time communication through WebSocket events
2. **Session Isolation**: Process/container separation with unique identifiers
3. **State Persistence**: Structured storage of conversation history
4. **Advanced Features**: Checkpointing and timeline navigation for power users

The transition from Tauri's file-based approach to a web-based database-driven system requires careful consideration of authentication, multi-tenancy, and security while preserving the excellent user experience patterns demonstrated in Claudia.

---

*Session Management Specialist Agent - Analysis Complete*