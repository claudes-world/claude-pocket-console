# Component Architecture Translation

**Converting Claudia's desktop component patterns to web-optimized React architecture**

## Overview

Claudia's component architecture demonstrates excellent React patterns that translate well to web deployment. Key translation areas include **Tauri API integration**, **component composition**, **state management**, and **mobile-responsive design**.

## Component Hierarchy Translation

### Current Desktop Architecture (Claudia)
```
App.tsx (Root)
├── Topbar (Navigation)
├── View Routing (Switch-based)
│   ├── ClaudeCodeSession (Primary interface)
│   ├── CCAgents (Agent management)
│   ├── ProjectList (Project browser)
│   └── Settings (Configuration)
└── ToastContainer (Notifications)
```

### Web-Optimized Architecture (Pocket Console)
```
App.tsx (Root + Providers)
├── QueryClient Provider
├── AppState Provider (Zustand)
├── Theme Provider
├── Router (Next.js App Router)
│   ├── Layout Components
│   │   ├── MobileNavigation
│   │   ├── DesktopSidebar
│   │   └── NotificationCenter
│   ├── Page Components
│   │   ├── Terminal (/)
│   │   ├── Agents (/agents)
│   │   ├── Sessions (/sessions)
│   │   └── Settings (/settings)
│   └── Modal/Dialog System
└── Global Error Boundary
```

## API Integration Pattern Translation

### From Tauri Commands to Web APIs

#### Current Tauri Pattern
```typescript
// Claudia: Direct Tauri command invocation
import { invoke } from '@tauri-apps/api/tauri';

const executeClaudeCode = async (projectPath: string, prompt: string) => {
  try {
    await invoke('execute_claude_code', {
      projectPath,
      prompt,
      model: 'sonnet'
    });
  } catch (error) {
    console.error('Execution failed:', error);
  }
};
```

#### Web API Pattern Translation
```typescript
// Pocket Console: RESTful API with type safety
import { api } from '@/lib/api-client';

const executeClaudeSession = async (sessionData: ExecuteSessionRequest) => {
  try {
    const response = await api.sessions.execute(sessionData);
    return response.data;
  } catch (error) {
    if (error instanceof APIError) {
      throw new Error(`Execution failed: ${error.message}`);
    }
    throw error;
  }
};

// Type-safe API client
class SessionAPI {
  static async execute(data: ExecuteSessionRequest): Promise<ExecuteSessionResponse> {
    const response = await fetch('/api/sessions/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.message, response.status);
    }
    
    return response.json();
  }
  
  static async getMessages(sessionId: string): Promise<Message[]> {
    const response = await fetch(`/api/sessions/${sessionId}/messages`);
    return response.json();
  }
}
```

## Component Composition Patterns

### Enhanced Component Composition for Web

#### Current Tauri Component (ClaudeCodeSession)
```typescript
export const ClaudeCodeSession: React.FC<ClaudeCodeSessionProps> = ({
  session,
  initialProjectPath,
  onBack,
  className,
}) => {
  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  
  // Direct Tauri event handling
  useEffect(() => {
    const eventSuffix = claudeSessionId ? `:${claudeSessionId}` : '';
    
    const unlisten = listen<string>(`claude-output${eventSuffix}`, (event) => {
      const message = JSON.parse(event.payload) as ClaudeStreamMessage;
      setMessages(prev => [...prev, message]);
    });
    
    return () => unlisten.then(f => f());
  }, [claudeSessionId]);
  
  return (
    <SplitPane
      left={<InputPanel />}
      right={<OutputPanel />}
      initialRatio={0.3}
    />
  );
};
```

#### Web-Optimized Component Translation
```typescript
// Enhanced component with hooks and providers
export const TerminalSession: React.FC<TerminalSessionProps> = ({
  sessionId,
  projectPath,
  onBack,
  className,
}) => {
  // Custom hooks for data and real-time updates
  const { session, isLoading } = useSessionQuery(sessionId);
  const { messages, connectionStatus } = useWebSocketMessages(sessionId);
  const { executeCommand, isExecuting } = useExecuteCommand(sessionId);
  
  // Responsive layout detection
  const isMobile = useMediaQuery('(max-width: 768px)');
  
  if (isLoading) {
    return <SessionLoadingSkeleton />;
  }
  
  return (
    <SessionProvider sessionId={sessionId}>
      <div className={cn("h-full flex flex-col", className)}>
        <SessionHeader
          session={session}
          connectionStatus={connectionStatus}
          onBack={onBack}
        />
        
        {isMobile ? (
          <MobileTerminalLayout>
            <TerminalOutput messages={messages} />
            <TerminalInput onExecute={executeCommand} isExecuting={isExecuting} />
          </MobileTerminalLayout>
        ) : (
          <DesktopTerminalLayout>
            <ResizablePanel defaultSize={30} minSize={20}>
              <TerminalInput onExecute={executeCommand} isExecuting={isExecuting} />
            </ResizablePanel>
            <ResizablePanel defaultSize={70} minSize={50}>
              <TerminalOutput messages={messages} />
            </ResizablePanel>
          </DesktopTerminalLayout>
        )}
        
        <SessionFooter 
          messageCount={messages.length}
          isExecuting={isExecuting}
        />
      </div>
    </SessionProvider>
  );
};
```

### Compound Component Patterns

#### Advanced Component Composition
```typescript
// Flexible terminal interface with compound components
const Terminal = {
  Root: TerminalRoot,
  Header: TerminalHeader,
  Body: TerminalBody,
  Input: TerminalInput,
  Output: TerminalOutput,
  Footer: TerminalFooter,
  StatusBar: TerminalStatusBar,
};

// Usage with full customization
const CustomTerminalLayout = () => {
  return (
    <Terminal.Root sessionId="session-123">
      <Terminal.Header>
        <Terminal.StatusBar />
        <ConnectionIndicator />
        <ActionButtons />
      </Terminal.Header>
      
      <Terminal.Body>
        <Terminal.Output 
          virtualScrolling
          maxMessages={1000}
          showTimestamps
        />
      </Terminal.Body>
      
      <Terminal.Footer>
        <Terminal.Input
          multiline
          autoComplete
          placeholder="Enter command..."
        />
        <QuickActions />
      </Terminal.Footer>
    </Terminal.Root>
  );
};

// Flexible component implementation
const TerminalRoot: React.FC<{
  sessionId: string;
  children: React.ReactNode;
}> = ({ sessionId, children }) => {
  return (
    <SessionProvider sessionId={sessionId}>
      <div className="h-full flex flex-col bg-background">
        {children}
      </div>
    </SessionProvider>
  );
};
```

## State Management Integration

### Enhanced Hook Patterns

#### Current Simple Pattern (Claudia)
```typescript
const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
const [isRunning, setIsRunning] = useState(false);
```

#### Advanced Hook Patterns (Pocket Console)
```typescript
// Comprehensive session management hook
const useTerminalSession = (sessionId: string) => {
  // Server state
  const { data: session, isLoading, error } = useSessionQuery(sessionId);
  
  // Real-time state
  const { 
    messages, 
    connectionStatus, 
    lastMessage,
    messageCount 
  } = useWebSocketMessages(sessionId);
  
  // Local UI state
  const [inputValue, setInputValue] = useState('');
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [filterSettings, setFilterSettings] = useState<MessageFilter>({ type: 'all' });
  
  // Actions
  const executeCommand = useExecuteCommand(sessionId);
  const clearSession = useClearSession(sessionId);
  const exportSession = useExportSession(sessionId);
  
  // Computed values
  const filteredMessages = useMemo(() => {
    return applyMessageFilter(messages, filterSettings);
  }, [messages, filterSettings]);
  
  const sessionStats = useMemo(() => ({
    totalMessages: messages.length,
    errorCount: messages.filter(m => m.type === 'error').length,
    duration: session?.created_at ? Date.now() - new Date(session.created_at).getTime() : 0,
  }), [messages, session]);
  
  return {
    // Data
    session,
    messages: filteredMessages,
    connectionStatus,
    sessionStats,
    isLoading,
    error,
    
    // UI State
    inputValue,
    setInputValue,
    selectedMessages,
    setSelectedMessages,
    filterSettings,
    setFilterSettings,
    
    // Actions
    executeCommand,
    clearSession,
    exportSession,
  };
};
```

### Context-Based Component Communication

```typescript
// Session context for component tree communication
interface SessionContextValue {
  sessionId: string;
  session: Session | null;
  messages: Message[];
  connectionStatus: ConnectionStatus;
  actions: {
    executeCommand: (command: string) => Promise<void>;
    clearMessages: () => void;
    selectMessage: (messageId: string) => void;
    copyMessage: (messageId: string) => void;
  };
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider: React.FC<{
  sessionId: string;
  children: React.ReactNode;
}> = ({ sessionId, children }) => {
  const sessionData = useTerminalSession(sessionId);
  
  const actions = useMemo(() => ({
    executeCommand: sessionData.executeCommand,
    clearMessages: sessionData.clearSession,
    selectMessage: (messageId: string) => {
      sessionData.setSelectedMessages(prev => {
        const newSet = new Set(prev);
        if (newSet.has(messageId)) {
          newSet.delete(messageId);
        } else {
          newSet.add(messageId);
        }
        return newSet;
      });
    },
    copyMessage: async (messageId: string) => {
      const message = sessionData.messages.find(m => m.id === messageId);
      if (message) {
        await navigator.clipboard.writeText(message.content);
      }
    },
  }), [sessionData]);
  
  const contextValue = useMemo(() => ({
    sessionId,
    session: sessionData.session,
    messages: sessionData.messages,
    connectionStatus: sessionData.connectionStatus,
    actions,
  }), [sessionId, sessionData, actions]);
  
  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
};
```

## Error Handling Patterns

### Enhanced Error Boundary System

#### Current Basic Pattern (Claudia)
```typescript
export const ErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Basic error boundary implementation
};
```

#### Advanced Error Handling (Pocket Console)
```typescript
// Comprehensive error boundary with recovery
interface ErrorInfo {
  error: Error;
  errorInfo: React.ErrorInfo;
  timestamp: Date;
  userAgent: string;
  sessionId?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

export class EnhancedErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ComponentType<{ error: ErrorInfo; retry: () => void }> },
  ErrorBoundaryState
> {
  constructor(props: any) {
    super(props);
    this.state = {
      hasError: false,
      errorInfo: null,
      retryCount: 0,
    };
  }
  
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }
  
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const errorData: ErrorInfo = {
      error,
      errorInfo,
      timestamp: new Date(),
      userAgent: navigator.userAgent,
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
  
  private handleRetry = () => {
    this.setState(prevState => ({
      hasError: false,
      errorInfo: null,
      retryCount: prevState.retryCount + 1,
    }));
  };
  
  render() {
    if (this.state.hasError && this.state.errorInfo) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;
      return (
        <FallbackComponent 
          error={this.state.errorInfo} 
          retry={this.handleRetry}
        />
      );
    }
    
    return this.props.children;
  }
}

// Smart error fallback component
const DefaultErrorFallback: React.FC<{
  error: ErrorInfo;
  retry: () => void;
}> = ({ error, retry }) => {
  const [details, setDetails] = useState(false);
  
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <AlertTriangle className="h-16 w-16 text-destructive mx-auto" />
        <div>
          <h2 className="text-xl font-semibold">Something went wrong</h2>
          <p className="text-muted-foreground mt-2">
            An unexpected error occurred. You can try refreshing the page or contact support if the problem persists.
          </p>
        </div>
        
        <div className="flex space-x-3 justify-center">
          <Button onClick={retry} variant="default">
            Try Again
          </Button>
          <Button onClick={() => window.location.reload()} variant="outline">
            Refresh Page
          </Button>
        </div>
        
        <div>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setDetails(!details)}
          >
            {details ? 'Hide' : 'Show'} Details
          </Button>
          
          {details && (
            <div className="mt-4 p-4 bg-muted rounded-lg text-left">
              <pre className="text-xs overflow-auto max-h-40">
                {error.error.stack}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

## Performance Optimization Patterns

### Virtual Scrolling Implementation

```typescript
// High-performance message display component
const VirtualizedMessageList: React.FC<{
  messages: Message[];
  className?: string;
}> = ({ messages, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 80, // Estimated message height
    overscan: 5,
  });
  
  // Auto-scroll to bottom for new messages
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      const isNearBottom = 
        container.scrollTop + container.clientHeight >= container.scrollHeight - 100;
      
      if (isNearBottom) {
        virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
      }
    }
  }, [messages.length, virtualizer]);
  
  return (
    <div 
      ref={containerRef}
      className={cn("h-full overflow-auto", className)}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const message = messages[virtualItem.index];
          
          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <MessageComponent 
                message={message} 
                isVisible={virtualItem.index >= virtualizer.range?.startIndex && 
                          virtualItem.index <= virtualizer.range?.endIndex}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

### Optimized Component Rendering

```typescript
// Memoized message component with selective updates
const MessageComponent = memo<{
  message: Message;
  isVisible: boolean;
}>(({ message, isVisible }) => {
  // Only render content when visible
  if (!isVisible) {
    return <div className="h-20" />; // Placeholder
  }
  
  return (
    <div className="p-4 border-b">
      <div className="flex items-start space-x-3">
        <Avatar className="h-8 w-8">
          <AvatarImage src={message.sender.avatar} />
          <AvatarFallback>{message.sender.name[0]}</AvatarFallback>
        </Avatar>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 text-sm">
            <span className="font-medium">{message.sender.name}</span>
            <span className="text-muted-foreground">
              {formatTime(message.timestamp)}
            </span>
          </div>
          
          <MessageContent content={message.content} type={message.type} />
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for memo optimization
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.isVisible === nextProps.isVisible
  );
});
```

## Responsive Design Integration

### Adaptive Component Rendering

```typescript
// Component that adapts to screen size
const AdaptiveComponentRenderer: React.FC<{
  mobile: React.ComponentType<any>;
  desktop: React.ComponentType<any>;
  tablet?: React.ComponentType<any>;
  props: any;
}> = ({ mobile: MobileComponent, desktop: DesktopComponent, tablet: TabletComponent, props }) => {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  
  if (isMobile) {
    return <MobileComponent {...props} />;
  }
  
  if (isTablet && TabletComponent) {
    return <TabletComponent {...props} />;
  }
  
  return <DesktopComponent {...props} />;
};

// Usage
const TerminalInterface = (props: TerminalProps) => (
  <AdaptiveComponentRenderer
    mobile={MobileTerminal}
    tablet={TabletTerminal}
    desktop={DesktopTerminal}
    props={props}
  />
);
```

## Testing Patterns

### Component Testing with React Testing Library

```typescript
// Comprehensive component testing
describe('TerminalSession', () => {
  const mockSessionId = 'test-session-123';
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should render terminal interface', async () => {
    render(
      <QueryClient>
        <TerminalSession sessionId={mockSessionId} />
      </QueryClient>
    );
    
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter command/i)).toBeInTheDocument();
  });
  
  it('should execute commands', async () => {
    const mockExecute = jest.fn();
    
    render(
      <SessionProvider sessionId={mockSessionId}>
        <TerminalInput onExecute={mockExecute} />
      </SessionProvider>
    );
    
    const input = screen.getByRole('textbox');
    const submitButton = screen.getByRole('button', { name: /send/i });
    
    await userEvent.type(input, 'ls -la');
    await userEvent.click(submitButton);
    
    expect(mockExecute).toHaveBeenCalledWith('ls -la');
  });
  
  it('should handle WebSocket messages', async () => {
    const { rerender } = render(
      <TerminalOutput sessionId={mockSessionId} />
    );
    
    // Simulate WebSocket message
    act(() => {
      window.dispatchEvent(new CustomEvent('websocket-message', {
        detail: { sessionId: mockSessionId, message: 'Hello World' }
      }));
    });
    
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });
  });
});
```

## Migration Checklist

### Phase 1: Core Component Translation
- [ ] Convert Tauri API calls to web API calls
- [ ] Implement React Query for server state
- [ ] Set up WebSocket connections
- [ ] Create responsive layout components

### Phase 2: Enhanced Patterns
- [ ] Implement compound component patterns
- [ ] Add comprehensive error boundaries
- [ ] Create advanced hook patterns
- [ ] Add performance optimizations

### Phase 3: Mobile Optimization
- [ ] Implement responsive component rendering
- [ ] Add touch-friendly interactions
- [ ] Optimize for mobile performance
- [ ] Add progressive web app features

---

*Component architecture patterns for web-native React application*