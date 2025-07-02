# Immediate Actions - Claudia Pattern Implementation

**Quick wins and foundational changes for Pocket Console based on Claudia analysis**

## Priority 1: Session Management Enhancements (Week 1-2)

### Current State Assessment
- Pocket Console has basic terminal session functionality
- Missing real-time streaming optimizations
- No session persistence or recovery mechanisms
- Limited session metadata and history tracking

### Immediate Implementation Actions

#### 1. Enhanced Session Data Model
```typescript
// Update session schema in packages/shared-types/src/schemas/
export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  projectId: z.string(),
  projectPath: z.string(),
  status: z.enum(['active', 'paused', 'completed', 'failed']),
  createdAt: z.date(),
  lastActivity: z.date(),
  firstMessage: z.string().optional(),
  messageCount: z.number().default(0),
  containerInfo: z.object({
    containerId: z.string(),
    status: z.enum(['starting', 'running', 'stopped', 'error']),
    resourceUsage: z.object({
      memory: z.number(),
      cpu: z.number(),
    }).optional(),
  }).optional(),
});
```

#### 2. Real-time Session Events
```typescript
// apps/terminal-server/src/websocket.py - Enhanced event handling
class SessionEventManager:
    def __init__(self):
        self.active_sessions: Dict[str, SessionInfo] = {}
        self.event_listeners: Dict[str, List[WebSocket]] = {}
    
    async def emit_session_event(self, session_id: str, event_type: str, data: dict):
        """Emit session-specific events to all connected clients"""
        event_data = {
            "type": event_type,
            "sessionId": session_id,
            "data": data,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        listeners = self.event_listeners.get(session_id, [])
        for websocket in listeners:
            try:
                await websocket.send_json(event_data)
            except ConnectionClosed:
                # Remove disconnected clients
                self.event_listeners[session_id].remove(websocket)
    
    async def handle_container_output(self, session_id: str, output_stream):
        """Stream container output with session isolation"""
        async for chunk in output_stream:
            await self.emit_session_event(session_id, "session_output", {
                "content": chunk.decode('utf-8'),
                "stream": "stdout"  # or "stderr"
            })
```

#### 3. Session Persistence Layer
```typescript
// infrastructure/convex/sessions.ts - Enhanced session persistence
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createSession = mutation({
  args: {
    projectPath: v.string(),
    userId: v.string(),
    initialPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sessionId = generateUUID();
    
    const session = await ctx.db.insert("sessions", {
      id: sessionId,
      userId: args.userId,
      projectPath: args.projectPath,
      status: "active",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      firstMessage: args.initialPrompt,
    });
    
    // Also create message collection
    await ctx.db.insert("sessionMessages", {
      sessionId,
      sequence: 0,
      type: "system",
      content: `Session ${sessionId} started`,
      timestamp: Date.now(),
    });
    
    return sessionId;
  },
});

export const getSessionHistory = query({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return ctx.db
      .query("sessions")
      .filter(q => q.eq(q.field("userId"), args.userId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});
```

## Priority 2: Mobile-First UI Improvements (Week 1-2)

### Current State Assessment
- Existing UI is desktop-focused with limited mobile optimization
- Split-pane layouts don't work well on mobile
- Missing touch-friendly interactions

### Immediate Implementation Actions

#### 1. Responsive Terminal Layout
```typescript
// apps/web/src/components/terminal/MobileTerminalLayout.tsx
export const MobileTerminalLayout: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<'output' | 'input'>('output');
  const [hasNewOutput, setHasNewOutput] = useState(false);
  
  return (
    <div className="h-full flex flex-col">
      {/* Mobile tab navigation */}
      <div className="flex border-b bg-background sticky top-0 z-10">
        <TabButton
          active={activeTab === 'output'}
          onClick={() => setActiveTab('output')}
          badge={hasNewOutput}
          icon={<Terminal className="h-4 w-4" />}
        >
          Output
        </TabButton>
        <TabButton
          active={activeTab === 'input'}
          onClick={() => setActiveTab('input')}
          icon={<Edit className="h-4 w-4" />}
        >
          Input
        </TabButton>
      </div>
      
      {/* Content area with smooth transitions */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
```

#### 2. Touch-Optimized Form Components
```typescript
// packages/ui/src/mobile-input.tsx
export const MobileTextarea = React.forwardRef<
  HTMLTextAreaElement,
  TextareaProps
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[120px] w-full rounded-lg border border-input bg-background px-4 py-3",
        "text-base placeholder:text-muted-foreground resize-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "touch-manipulation", // Improve touch response
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
```

#### 3. Mobile Navigation System
```typescript
// apps/web/src/hooks/useMobileNavigation.ts
export const useMobileNavigation = () => {
  const [navigationStack, setNavigationStack] = useState<NavigationItem[]>([]);
  const [currentView, setCurrentView] = useState<View>('home');
  
  const push = useCallback((view: View, props?: any) => {
    setNavigationStack(prev => [...prev, { view: currentView, props, timestamp: Date.now() }]);
    setCurrentView(view);
  }, [currentView]);
  
  const pop = useCallback(() => {
    const previous = navigationStack[navigationStack.length - 1];
    if (previous) {
      setNavigationStack(prev => prev.slice(0, -1));
      setCurrentView(previous.view);
    }
  }, [navigationStack]);
  
  const canGoBack = navigationStack.length > 0;
  
  return { currentView, push, pop, canGoBack, stackDepth: navigationStack.length };
};
```

## Priority 3: Enhanced Error Handling (Week 2)

### Current State Assessment
- Basic error handling exists but lacks comprehensive recovery
- No structured error logging or user feedback
- Missing error boundaries for React components

### Immediate Implementation Actions

#### 1. Comprehensive Error Boundary System
```typescript
// apps/web/src/components/error/EnhancedErrorBoundary.tsx
interface ErrorInfo {
  error: Error;
  errorInfo: React.ErrorInfo;
  sessionId?: string;
  userId?: string;
  timestamp: Date;
}

export class EnhancedErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: ComponentType<any> },
  { hasError: boolean; errorInfo: ErrorInfo | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const errorData: ErrorInfo = {
      error,
      errorInfo,
      timestamp: new Date(),
      // Add context from app state
    };

    this.setState({ errorInfo: errorData });
    
    // Log to error tracking service
    this.logError(errorData);
  }

  private logError = async (errorInfo: ErrorInfo) => {
    try {
      await fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorInfo),
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
  };

  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;
      return <FallbackComponent error={this.state.errorInfo} />;
    }

    return this.props.children;
  }
}
```

#### 2. Structured Error API
```python
# apps/terminal-server/src/error_handling.py
from fastapi import HTTPException
from typing import Dict, Any
import logging

class StructuredError(Exception):
    def __init__(
        self, 
        message: str, 
        error_code: str, 
        context: Dict[str, Any] = None,
        recoverable: bool = True
    ):
        self.message = message
        self.error_code = error_code
        self.context = context or {}
        self.recoverable = recoverable
        super().__init__(message)

class ErrorHandler:
    def __init__(self):
        self.logger = logging.getLogger("pocket-console.errors")
    
    async def handle_session_error(
        self, 
        session_id: str, 
        error: Exception,
        context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """Handle session-specific errors with recovery options"""
        
        error_response = {
            "error_id": str(uuid.uuid4()),
            "session_id": session_id,
            "error_type": type(error).__name__,
            "message": str(error),
            "timestamp": datetime.utcnow().isoformat(),
            "context": context or {},
            "recoverable": getattr(error, 'recoverable', True),
        }
        
        # Log error
        self.logger.error(
            f"Session error: {session_id}",
            extra=error_response
        )
        
        # Attempt recovery for known error types
        if isinstance(error, ContainerTimeoutError):
            error_response["recovery_action"] = "restart_container"
        elif isinstance(error, NetworkError):
            error_response["recovery_action"] = "retry_connection"
        
        return error_response
```

## Priority 4: Basic Security Enhancements (Week 2)

### Current State Assessment
- Basic Docker container isolation exists
- Missing granular permission controls
- No security violation tracking

### Immediate Implementation Actions

#### 1. Enhanced Security Profiles
```python
# apps/terminal-server/src/security.py
@dataclass
class SecurityProfile:
    name: str
    description: str
    memory_limit: str = "256MB"
    cpu_limit: float = 0.5
    network_access: bool = False
    file_read_paths: List[str] = field(default_factory=lambda: ["/workspace"])
    file_write_paths: List[str] = field(default_factory=lambda: ["/workspace/output"])
    denied_commands: List[str] = field(default_factory=lambda: ["rm", "chmod", "chown"])
    max_execution_time: int = 300  # seconds

class SecurityManager:
    def __init__(self):
        self.profiles = {
            "minimal": SecurityProfile(
                name="minimal",
                description="Minimal permissions for untrusted code",
                network_access=False,
                file_write_paths=["/tmp"],
                max_execution_time=60
            ),
            "standard": SecurityProfile(
                name="standard", 
                description="Standard development permissions",
                network_access=True,
                memory_limit="512MB",
                cpu_limit=1.0
            )
        }
    
    def apply_security_profile(
        self, 
        container_config: dict, 
        profile_name: str
    ) -> dict:
        """Apply security profile to container configuration"""
        profile = self.profiles.get(profile_name, self.profiles["minimal"])
        
        container_config.update({
            "host_config": {
                "memory": self.parse_memory_limit(profile.memory_limit),
                "cpu_quota": int(profile.cpu_limit * 100000),
                "network_mode": "bridge" if profile.network_access else "none",
                "read_only_root_fs": True,
                "security_opt": ["no-new-privileges:true"],
                "cap_drop": ["ALL"],
                "cap_add": ["CHOWN", "DAC_OVERRIDE"] if profile.name == "standard" else [],
            }
        })
        
        return container_config
```

#### 2. Session Authentication Middleware
```typescript
// apps/web/src/middleware/sessionAuth.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function sessionAuthMiddleware(
  request: NextRequest,
  sessionId: string
): Promise<NextResponse | null> {
  try {
    const session = await getSession(request);
    
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
    
    // Verify session ownership
    const terminalSession = await getTerminalSession(sessionId);
    if (terminalSession?.userId !== session.user.id) {
      return new NextResponse('Forbidden', { status: 403 });
    }
    
    return null; // Continue to handler
  } catch (error) {
    console.error('Session auth error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
```

## Implementation Timeline

### Week 1: Foundation
- [ ] **Day 1-2**: Enhanced session data model and persistence
- [ ] **Day 3-4**: Mobile-first terminal layout components  
- [ ] **Day 5**: Real-time session event system

### Week 2: Enhancement
- [ ] **Day 1-2**: Comprehensive error handling system
- [ ] **Day 3-4**: Basic security profile implementation
- [ ] **Day 5**: Integration testing and mobile optimization

## Quick Win Checklist

### Immediate (This Week)
- [ ] Update session schema with enhanced metadata
- [ ] Implement mobile tabbed terminal interface
- [ ] Add comprehensive error boundaries
- [ ] Create basic security profiles for containers

### High-Impact, Low-Effort
- [ ] Add session persistence to Convex database
- [ ] Implement touch-friendly form components
- [ ] Add structured error logging with recovery actions
- [ ] Create session authentication middleware

### Infrastructure Setup
- [ ] Configure real-time WebSocket event system
- [ ] Set up error tracking and monitoring
- [ ] Create mobile navigation hook patterns
- [ ] Implement basic container security profiles

## Success Metrics

### Session Management
- **Metric**: Session recovery rate after disconnection
- **Target**: >95% successful recovery within 30 seconds
- **Implementation**: WebSocket reconnection with state persistence

### Mobile Experience  
- **Metric**: Mobile usability score (touch target size, navigation ease)
- **Target**: All interactive elements ≥44px touch targets
- **Implementation**: Mobile-first component design

### Error Handling
- **Metric**: Error recovery rate for common failures
- **Target**: >90% automatic recovery for transient errors
- **Implementation**: Structured error handling with recovery actions

### Security
- **Metric**: Container escape prevention
- **Target**: Zero successful container escapes in testing
- **Implementation**: Hardened security profiles with monitoring

---

*Immediate implementation priorities for adopting Claudia patterns in Pocket Console*