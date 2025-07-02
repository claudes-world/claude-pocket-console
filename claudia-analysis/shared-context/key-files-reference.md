# Key Files Reference - Claudia Analysis

**Critical files organized by domain for rapid understanding and adaptation**

## Session Management Domain

### Primary Files
- **`src/components/ClaudeCodeSession.tsx`** - Main terminal interface with real-time streaming
- **`src-tauri/src/commands/claude.rs`** - Claude CLI process management and execution
- **`src/components/SessionList.tsx`** - Session discovery and navigation
- **`src/components/SessionOutputViewer.tsx`** - JSONL output parsing and display

### Supporting Files
- **`src/components/RunningSessionsView.tsx`** - Active session monitoring
- **`src-tauri/src/process/registry.rs`** - Process lifecycle tracking
- **`src/lib/outputCache.tsx`** - Performance optimization for large outputs
- **`src/components/StreamMessage.tsx`** - Individual message rendering

### Key Patterns Identified
```typescript
// Real-time event handling pattern
await listen<string>(`claude-output${eventSuffix}`, (event) => {
  const message = JSON.parse(event.payload) as ClaudeStreamMessage;
  setMessages(prev => [...prev, message]);
});

// Session isolation with unique identifiers
const eventSuffix = claudeSessionId ? `:${claudeSessionId}` : '';
```

## Security & Sandboxing Domain

### Primary Files
- **`src-tauri/src/sandbox/executor.rs`** - Core sandbox enforcement using gaol library
- **`src-tauri/src/sandbox/profile.rs`** - Security policy building and rule management
- **`src-tauri/src/commands/sandbox.rs`** - Sandbox CRUD operations and violation tracking
- **`src/components/AgentSandboxSettings.tsx`** - UI for security configuration

### Supporting Files
- **`src-tauri/src/sandbox/platform.rs`** - OS-specific capability detection
- **`src-tauri/src/sandbox/defaults.rs`** - Default security profiles
- **Database schema** - Security profiles and violation tables

### Key Patterns Identified
```rust
// Dynamic profile generation based on agent permissions
if agent.enable_file_read {
    rules.push(SandboxRule {
        operation_type: "file_read_all".to_string(),
        pattern_type: "subpath".to_string(),
        pattern_value: "{{PROJECT_PATH}}".to_string(),
        enabled: true,
    });
}

// Platform-aware capability detection
match std::env::consts::OS {
    "linux" => get_linux_capabilities(),
    "macos" => get_macos_capabilities(),
    _ => get_unsupported_capabilities(os),
}
```

## MCP Protocol Domain

### Primary Files
- **`src-tauri/src/commands/mcp.rs`** - MCP server lifecycle management
- **`src/components/MCPManager.tsx`** - Main MCP management interface
- **`src/components/MCPServerList.tsx`** - Server display and operations
- **`src/components/MCPAddServer.tsx`** - Server configuration forms

### Supporting Files
- **`src/components/MCPImportExport.tsx`** - Configuration import/export
- **MCP configuration files** - `.mcp.json` format examples

### Key Patterns Identified
```rust
// Multi-scope configuration system
async fn mcp_add(
    name: String,
    transport: String,      // "stdio" | "sse"
    command: Option<String>,
    args: Vec<String>,
    env: HashMap<String, String>,
    url: Option<String>,
    scope: String,          // "local" | "project" | "user"
) -> Result<AddServerResult, String>

// Health check implementation
async fn mcp_test_connection(name: String) -> Result<String, String> {
    match execute_claude_mcp_command(&app, vec!["get", &name]) {
        Ok(_) => Ok(format!("Connection to {} successful", name)),
        Err(e) => Err(e.to_string()),
    }
}
```

## AI Agent & Workflow Domain

### Primary Files
- **`src/components/CCAgents.tsx`** - Main agent management hub
- **`src-tauri/src/commands/agents.rs`** - Agent CRUD operations and execution
- **`src/components/CreateAgent.tsx`** - Agent creation and editing interface
- **`src/components/AgentExecution.tsx`** - Real-time execution monitoring

### Supporting Files
- **`src/components/AgentRunsList.tsx`** - Execution history and metrics
- **`src/components/GitHubAgentBrowser.tsx`** - Community agent discovery
- **`cc_agents/` directory** - Agent template library
- **Database tables** - Agent and agent_runs schemas

### Key Patterns Identified
```json
// Agent-as-code format
{
  "version": 1,
  "agent": {
    "name": "Security Scanner",
    "icon": "shield",
    "system_prompt": "Multi-phase security analysis...",
    "model": "opus",
    "sandbox_enabled": true,
    "enable_file_read": true,
    "enable_file_write": false,
    "enable_network": false
  }
}
```

```rust
// Agent execution with sandbox integration
struct AgentRun {
    agent_id: i64,
    task: String,
    project_path: String,
    session_id: String,
    status: String,
    pid: Option<u32>,
}
```

## UI Architecture Domain

### Primary Files
- **`src/App.tsx`** - Root application with state management
- **`src/components/ui/`** - Reusable UI component library
- **`src/lib/utils.ts`** - Utility functions including `cn()` for conditional classes
- **`vite.config.ts`** - Build optimization with manual chunking

### Supporting Files
- **`src/styles.css`** - Global styles and Tailwind imports
- **`src/components/Topbar.tsx`** - Application navigation
- **`src/components/ui/split-pane.tsx`** - Desktop layout component
- **`tailwind.config.js`** - Design system configuration

### Key Patterns Identified
```typescript
// State management pattern
const [view, setView] = useState<View>("welcome");
const [projects, setProjects] = useState<Project[]>([]);
const [selectedProject, setSelectedProject] = useState<Project | null>(null);

// Component composition pattern
<OutputCacheProvider>
  <div className="h-screen bg-background flex flex-col">
    <Topbar {...topbarProps} />
    <div className="flex-1 overflow-y-auto">
      {renderContent()}
    </div>
  </div>
</OutputCacheProvider>

// Responsive design pattern (limited in claudia)
<div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
```

## Configuration & Build Domain

### Primary Files
- **`package.json`** - Dependencies and build scripts
- **`tauri.conf.json`** - Tauri application configuration
- **`Cargo.toml`** - Rust dependencies and features
- **`vite.config.ts`** - Frontend build configuration

### Supporting Files
- **`tsconfig.json`** - TypeScript compiler configuration
- **`bun.lock`** - Package manager lockfile
- **`build.rs`** - Rust build script
- **`src-tauri/capabilities/default.json`** - Tauri permissions

### Key Configuration Insights
```javascript
// vite.config.ts - Bundle optimization
manualChunks: {
  'react-vendor': ['react', 'react-dom'],
  'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
  'editor-vendor': ['@uiw/react-md-editor'],
  'syntax-vendor': ['react-syntax-highlighter'],
}
```

## Database Schema Files

### SQLite Tables (Conceptual)
- **agents** - Agent definitions and permissions
- **agent_runs** - Execution history and metrics
- **sandbox_profiles** - Security policy templates
- **sandbox_rules** - Granular permission definitions
- **sandbox_violations** - Security event tracking

### Key Data Structures
```sql
-- Core agent definition
CREATE TABLE agents (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    sandbox_enabled BOOLEAN DEFAULT 1,
    enable_file_read BOOLEAN DEFAULT 1,
    enable_file_write BOOLEAN DEFAULT 1,
    enable_network BOOLEAN DEFAULT 0
);

-- Execution tracking
CREATE TABLE agent_runs (
    id INTEGER PRIMARY KEY,
    agent_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    pid INTEGER,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

## Critical Integration Points

### Tauri Command Interface
```rust
// Key command signatures for web adaptation
#[tauri::command]
pub async fn execute_claude_code(
    project_path: String, 
    prompt: String, 
    model: String
) -> Result<(), String>

#[tauri::command] 
pub async fn mcp_add(
    name: String,
    transport: String,
    command: Option<String>,
    scope: String,
) -> Result<AddServerResult, String>

#[tauri::command]
pub async fn agent_create(agent: Agent) -> Result<i64, String>
```

### React API Integration
```typescript
// Frontend API client patterns
import { invoke } from '@tauri-apps/api/tauri';

// Session management
await invoke<Session[]>("get_sessions", { projectPath });
await invoke<void>("execute_claude_code", { projectPath, prompt, model });

// Agent management  
await invoke<Agent[]>("agent_list");
await invoke<number>("agent_create", { agent });

// MCP management
await invoke<MCPServer[]>("mcp_list");
await invoke<string>("mcp_test_connection", { name });
```

## Web Adaptation Priority Files

### High Priority (Core Functionality)
1. **`src/components/ClaudeCodeSession.tsx`** - Primary terminal interface
2. **`src-tauri/src/commands/claude.rs`** - Session execution logic
3. **`src/components/CCAgents.tsx`** - Agent management
4. **`src-tauri/src/commands/agents.rs`** - Agent operations

### Medium Priority (Enhanced Features)
1. **`src/components/MCPManager.tsx`** - MCP integration
2. **`src-tauri/src/sandbox/executor.rs`** - Security model
3. **`src/components/ui/split-pane.tsx`** - Layout adaptation
4. **`src/components/SessionList.tsx`** - Session management

### Low Priority (Polish & Optimization)
1. **`src/components/UsageDashboard.tsx`** - Analytics
2. **`src/components/CheckpointSettings.tsx`** - Advanced features
3. **`src/lib/outputCache.tsx`** - Performance optimization
4. **`src/components/GitHubAgentBrowser.tsx`** - Community features

---

*Key files reference for targeted analysis and adaptation planning*