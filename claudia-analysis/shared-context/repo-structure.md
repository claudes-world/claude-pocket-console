# Claudia Repository Structure Analysis

**Comprehensive mapping of claudia's codebase organization for Pocket Console adaptation**

## Root Directory Structure

```
claudia/
├── src/                          # React frontend application
├── src-tauri/                    # Rust backend (Tauri)
├── public/                       # Static assets
├── cc_agents/                    # Community agent library
├── package.json                  # Node.js dependencies
├── bun.lock                      # Bun lockfile
├── vite.config.ts               # Vite build configuration
├── tsconfig.json                # TypeScript configuration
├── index.html                   # Entry HTML file
└── README.md                    # Project documentation
```

## Frontend Structure (`src/`)

### Component Organization

```
src/
├── components/                   # React components
│   ├── AgentExecution.tsx       # Agent runtime execution interface
│   ├── AgentExecutionDemo.tsx   # Demo/preview execution
│   ├── AgentRunOutputViewer.tsx # Output streaming viewer
│   ├── AgentRunView.tsx         # Individual run details
│   ├── AgentRunsList.tsx        # Execution history list
│   ├── AgentSandboxSettings.tsx # Security configuration UI
│   ├── CCAgents.tsx             # Main agent management hub
│   ├── CheckpointSettings.tsx   # Timeline management UI
│   ├── ClaudeBinaryDialog.tsx   # CLI path configuration
│   ├── ClaudeCodeSession.tsx    # Primary terminal interface
│   ├── ClaudeFileEditor.tsx     # File editing interface
│   ├── ClaudeMemoriesDropdown.tsx # Memory management
│   ├── ClaudeVersionSelector.tsx # Model selection
│   ├── CreateAgent.tsx          # Agent creation form
│   ├── ErrorBoundary.tsx        # Error handling wrapper
│   ├── ExecutionControlBar.tsx  # Runtime controls
│   ├── FilePicker.tsx           # File selection dialog
│   ├── FloatingPromptInput.tsx  # Floating input interface
│   ├── GitHubAgentBrowser.tsx   # Community agent browser
│   ├── IconPicker.tsx           # Agent icon selection
│   ├── ImagePreview.tsx         # Image display component
│   ├── MCPAddServer.tsx         # MCP server configuration
│   ├── MCPImportExport.tsx      # MCP configuration tools
│   ├── MCPManager.tsx           # MCP management hub
│   ├── MCPServerList.tsx        # MCP server display
│   ├── MarkdownEditor.tsx       # Markdown editing
│   ├── NFOCredits.tsx           # About/credits component
│   ├── PreviewPromptDialog.tsx  # Prompt preview modal
│   ├── ProjectList.tsx          # Project selection
│   ├── RunningSessionsView.tsx  # Active session monitor
│   ├── SessionList.tsx          # Session history
│   ├── SessionOutputViewer.tsx  # Session output display
│   ├── Settings.tsx             # Application settings
│   ├── StreamMessage.tsx        # Real-time message display
│   ├── TimelineNavigator.tsx    # Checkpoint navigation
│   ├── TokenCounter.tsx         # Usage metrics
│   ├── ToolWidgets.tsx          # Tool-specific UI widgets
│   ├── Topbar.tsx               # Application header
│   ├── UsageDashboard.tsx       # Analytics dashboard
│   ├── WebviewPreview.tsx       # Web content preview
│   └── ui/                      # Reusable UI components
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── pagination.tsx
│       ├── popover.tsx
│       ├── radio-group.tsx
│       ├── scroll-area.tsx
│       ├── select.tsx
│       ├── split-pane.tsx       # Desktop layout component
│       ├── switch.tsx
│       ├── tabs.tsx
│       ├── textarea.tsx
│       ├── toast.tsx
│       └── tooltip.tsx
```

### Support Libraries

```
src/lib/
├── api.ts                       # Tauri API client
├── claudeSyntaxTheme.ts         # Syntax highlighting themes
├── date-utils.ts                # Date/time utilities
├── linkDetector.tsx             # URL detection and rendering
├── outputCache.tsx              # Performance optimization
└── utils.ts                     # General utilities
```

### Assets and Styling

```
src/
├── assets/                      # Static assets
│   ├── nfo/                     # About screen assets
│   │   ├── asterisk-logo.png
│   │   └── claudia-nfo.ogg
│   ├── react.svg
│   └── shimmer.css              # Loading animations
├── main.tsx                     # React app entry point
├── styles.css                   # Global styles
└── vite-env.d.ts               # Vite type definitions
```

## Backend Structure (`src-tauri/`)

### Rust Application Structure

```
src-tauri/
├── src/
│   ├── checkpoint/              # Session timeline management
│   │   ├── manager.rs          # Checkpoint lifecycle
│   │   ├── mod.rs              # Module exports
│   │   ├── state.rs            # Checkpoint state tracking
│   │   └── storage.rs          # Persistence layer
│   ├── commands/                # Tauri command handlers
│   │   ├── agents.rs           # Agent CRUD operations
│   │   ├── claude.rs           # Claude CLI integration
│   │   ├── mcp.rs              # MCP server management
│   │   ├── mod.rs              # Command exports
│   │   ├── sandbox.rs          # Security operations
│   │   ├── screenshot.rs       # Screen capture utilities
│   │   └── usage.rs            # Analytics and metrics
│   ├── process/                 # Process management
│   │   ├── mod.rs              # Process utilities
│   │   └── registry.rs         # Running process tracking
│   ├── sandbox/                 # Security subsystem
│   │   ├── defaults.rs         # Default security profiles
│   │   ├── executor.rs         # Sandbox enforcement
│   │   ├── mod.rs              # Sandbox module exports
│   │   ├── platform.rs         # OS-specific capabilities
│   │   └── profile.rs          # Security policy management
│   ├── claude_binary.rs         # Claude CLI path management
│   ├── lib.rs                  # Library root
│   └── main.rs                 # Application entry point
├── tests/                       # Rust test suite
│   ├── SANDBOX_TEST_SUMMARY.md
│   ├── TESTS_COMPLETE.md
│   ├── TESTS_TASK.md
│   ├── sandbox/                 # Security testing
│   │   ├── README.md
│   │   ├── common/             # Test utilities
│   │   ├── e2e/                # End-to-end tests
│   │   ├── integration/        # Integration tests
│   │   ├── mod.rs
│   │   └── unit/               # Unit tests
│   └── sandbox_tests.rs
├── build.rs                     # Build script
├── Cargo.lock                   # Rust dependencies lock
├── Cargo.toml                   # Rust project configuration
├── capabilities/                # Tauri permissions
│   └── default.json
├── icons/                       # Application icons
└── tauri.conf.json             # Tauri configuration
```

## Agent Library (`cc_agents/`)

### Community Agent Templates

```
cc_agents/
├── README.md                    # Agent library documentation
├── git-commit-bot.claudia.json  # Automated commit messages
├── security-scanner.claudia.json # Security analysis workflow
└── unit-tests-bot.claudia.json  # Test generation agent
```

**Agent File Format:**
```json
{
  "version": 1,
  "exported_at": "2025-01-23T14:29:58.156063+00:00",
  "agent": {
    "name": "Security Scanner",
    "icon": "shield",
    "system_prompt": "Multi-phase security analysis...",
    "default_task": "Perform comprehensive security scan",
    "model": "opus",
    "sandbox_enabled": true,
    "enable_file_read": true,
    "enable_file_write": false,
    "enable_network": false
  }
}
```

## Configuration Files

### Build and Development

- **`package.json`**: Node.js dependencies and scripts
- **`bun.lock`**: Fast package manager lockfile
- **`vite.config.ts`**: Build tool configuration with manual chunking
- **`tsconfig.json`**: TypeScript compilation settings
- **`tsconfig.node.json`**: Node.js specific TypeScript config

### Tauri Configuration

- **`tauri.conf.json`**: Tauri-specific settings, permissions, and build options
- **`capabilities/default.json`**: Default security capabilities
- **`build.rs`**: Rust build script for custom compilation steps

## Key Architecture Insights

### 1. Separation of Concerns

**Frontend (React/TypeScript):**
- User interface and interaction logic
- State management and data presentation
- Real-time communication with backend
- Component-based architecture

**Backend (Rust/Tauri):**
- System integration and process management
- Security enforcement and sandboxing
- Database operations and persistence
- CLI tool integration

### 2. Component Categorization

**Core Terminal Interface:**
- `ClaudeCodeSession.tsx` - Primary terminal interaction
- `SessionList.tsx` - Session management
- `StreamMessage.tsx` - Real-time output
- `ExecutionControlBar.tsx` - Runtime controls

**Agent Management:**
- `CCAgents.tsx` - Main agent hub
- `CreateAgent.tsx` - Agent creation
- `AgentExecution.tsx` - Runtime execution
- `GitHubAgentBrowser.tsx` - Community agents

**MCP Integration:**
- `MCPManager.tsx` - Server management
- `MCPAddServer.tsx` - Server configuration
- `MCPServerList.tsx` - Server monitoring

**Security & Settings:**
- `AgentSandboxSettings.tsx` - Security configuration
- `Settings.tsx` - Application preferences
- `UsageDashboard.tsx` - Analytics

**UI Foundation:**
- `ui/` directory - Reusable components
- Radix UI primitives for accessibility
- Tailwind CSS for styling

### 3. Backend Service Architecture

**Command Handlers:**
- Agent lifecycle management (`commands/agents.rs`)
- Claude CLI integration (`commands/claude.rs`)
- MCP server management (`commands/mcp.rs`)
- Security operations (`commands/sandbox.rs`)

**Core Services:**
- Checkpoint management (`checkpoint/`)
- Process registry (`process/`)
- Security enforcement (`sandbox/`)

## Web Adaptation Mapping

### Component Translation Strategy

| Claudia Component | Pocket Console Equivalent | Adaptation Notes |
|------------------|---------------------------|------------------|
| `ClaudeCodeSession.tsx` | Terminal interface | Mobile-first responsive design |
| `CCAgents.tsx` | Agent management hub | Touch-optimized interactions |
| `MCPManager.tsx` | MCP server dashboard | Web API integration |
| `ProjectList.tsx` | Project browser | Mobile navigation patterns |
| `ui/split-pane.tsx` | Responsive layout | Mobile tab-based alternative |

### Backend Translation Strategy

| Tauri Command | FastAPI Endpoint | Notes |
|---------------|------------------|-------|
| `execute_claude_code` | `POST /api/sessions/execute` | Docker container execution |
| `mcp_add` | `POST /api/mcp/servers` | Database persistence |
| `agent_create` | `POST /api/agents` | Multi-user support |
| `sandbox_create_profile` | `POST /api/security/profiles` | Container security |

### Database Schema Translation

**SQLite → PostgreSQL/Convex:**
- Agent definitions and configurations
- Session metadata and message history
- MCP server registrations
- Security profiles and violations
- User authentication and permissions

---

*Repository structure analysis for Pocket Console web adaptation planning*