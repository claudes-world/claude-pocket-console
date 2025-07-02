# State Management Patterns Translation

**Converting Tauri-based state management to web-native React patterns**

## Overview

Claudia uses Tauri's state management with Rust backend state and React frontend state coordination. For Pocket Console, we need to translate these patterns to web-native solutions using **React Context**, **React Query**, **Zustand**, and **WebSocket** connections.

## Current Tauri State Pattern

### Tauri Global State (Rust Backend)
```rust
// src-tauri/src/lib.rs - Global state management
pub struct AppState {
    pub claude_process: Arc<Mutex<Option<Child>>>,
    pub agent_runs: Arc<Mutex<HashMap<i64, ProcessInfo>>>,
    pub live_outputs: Arc<Mutex<HashMap<i64, String>>>,
    pub session_cache: Arc<Mutex<HashMap<String, Session>>>,
}

// State access in commands
#[tauri::command]
pub async fn get_sessions(
    state: State<'_, AppState>,
    project_path: String
) -> Result<Vec<Session>, String> {
    let cache = state.session_cache.lock().await;
    // ... state operations
}
```

### Tauri Frontend State (React)
```typescript
// Current pattern: Direct Tauri API calls
const [sessions, setSessions] = useState<Session[]>([]);
const [loading, setLoading] = useState(false);

useEffect(() => {
  const loadSessions = async () => {
    setLoading(true);
    try {
      const result = await invoke<Session[]>("get_sessions", { projectPath });
      setSessions(result);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    }
    setLoading(false);
  };
  
  loadSessions();
}, [projectPath]);
```

## Web-Native State Management Translation

### 1. Server State with React Query

```typescript
// Session state management with React Query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// API client
class SessionAPI {
  static async getSessions(projectPath: string): Promise<Session[]> {
    const response = await fetch(`/api/sessions?projectPath=${encodeURIComponent(projectPath)}`);
    if (!response.ok) throw new Error('Failed to fetch sessions');
    return response.json();
  }
  
  static async createSession(data: CreateSessionRequest): Promise<Session> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create session');
    return response.json();
  }
  
  static async executeSession(sessionId: string, prompt: string): Promise<void> {
    const response = await fetch(`/api/sessions/${sessionId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!response.ok) throw new Error('Failed to execute session');
  }
}

// React Query hooks
export const useSessionsQuery = (projectPath: string) => {
  return useQuery({
    queryKey: ['sessions', projectPath],
    queryFn: () => SessionAPI.getSessions(projectPath),
    enabled: !!projectPath,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false,
  });
};

export const useCreateSessionMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: SessionAPI.createSession,
    onSuccess: (newSession) => {
      // Update sessions cache
      queryClient.setQueryData(
        ['sessions', newSession.project_path],
        (oldSessions: Session[] = []) => [...oldSessions, newSession]
      );
    },
  });
};

export const useExecuteSessionMutation = () => {
  return useMutation({
    mutationFn: ({ sessionId, prompt }: { sessionId: string; prompt: string }) =>
      SessionAPI.executeSession(sessionId, prompt),
  });
};
```

### 2. Real-time State with WebSocket Integration

```typescript
// WebSocket state management for real-time updates
interface WebSocketMessage {
  type: 'session_output' | 'session_error' | 'session_complete' | 'session_status';
  sessionId: string;
  data: any;
  timestamp: string;
}

const useWebSocketSubscription = (sessionId: string) => {
  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    if (!sessionId) return;
    
    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL}/ws/session/${sessionId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
      setConnectionStatus('connected');
    };
    
    ws.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);
      
      if (message.type === 'session_output') {
        setMessages(prev => [...prev, message.data]);
      }
    };
    
    ws.onclose = () => {
      setConnectionStatus('disconnected');
    };
    
    return () => {
      ws.close();
    };
  }, [sessionId]);
  
  const sendMessage = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'user_input', data: message }));
    }
  }, []);
  
  return {
    messages,
    connectionStatus,
    sendMessage,
  };
};
```

### 3. Global UI State with Zustand

```typescript
// Global application state with Zustand
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  // Navigation state
  currentView: View;
  navigationStack: NavigationItem[];
  
  // User preferences
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  terminalSettings: TerminalSettings;
  
  // Session state
  activeSessionId: string | null;
  recentProjects: string[];
  
  // Actions
  setCurrentView: (view: View) => void;
  pushNavigation: (item: NavigationItem) => void;
  popNavigation: () => void;
  setActiveSession: (sessionId: string | null) => void;
  updateTerminalSettings: (settings: Partial<TerminalSettings>) => void;
  addRecentProject: (projectPath: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentView: 'home',
      navigationStack: [],
      theme: 'system',
      fontSize: 14,
      terminalSettings: {
        fontFamily: 'JetBrains Mono',
        lineHeight: 1.5,
        scrollbackLimit: 1000,
      },
      activeSessionId: null,
      recentProjects: [],
      
      // Actions
      setCurrentView: (view) => set({ currentView: view }),
      
      pushNavigation: (item) => set((state) => ({
        navigationStack: [...state.navigationStack, item],
      })),
      
      popNavigation: () => set((state) => ({
        navigationStack: state.navigationStack.slice(0, -1),
        currentView: state.navigationStack[state.navigationStack.length - 1]?.view || 'home',
      })),
      
      setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
      
      updateTerminalSettings: (settings) => set((state) => ({
        terminalSettings: { ...state.terminalSettings, ...settings },
      })),
      
      addRecentProject: (projectPath) => set((state) => ({
        recentProjects: [
          projectPath,
          ...state.recentProjects.filter(p => p !== projectPath).slice(0, 9)
        ],
      })),
    }),
    {
      name: 'pocket-console-app-state',
      partialize: (state) => ({
        theme: state.theme,
        fontSize: state.fontSize,
        terminalSettings: state.terminalSettings,
        recentProjects: state.recentProjects,
      }),
    }
  )
);
```

### 4. Component-Level State with Context

```typescript
// Terminal output context for performance optimization
interface TerminalOutputContextValue {
  messages: ClaudeStreamMessage[];
  addMessage: (message: ClaudeStreamMessage) => void;
  clearMessages: () => void;
  filteredMessages: ClaudeStreamMessage[];
  setFilter: (filter: MessageFilter) => void;
}

const TerminalOutputContext = createContext<TerminalOutputContextValue | null>(null);

export const TerminalOutputProvider: React.FC<{
  children: React.ReactNode;
  sessionId: string;
}> = ({ children, sessionId }) => {
  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  const [filter, setFilter] = useState<MessageFilter>({ type: 'all' });
  
  // WebSocket integration
  const { messages: wsMessages } = useWebSocketSubscription(sessionId);
  
  // Sync WebSocket messages with local state
  useEffect(() => {
    setMessages(prev => [...prev, ...wsMessages]);
  }, [wsMessages]);
  
  // Memoized filtered messages for performance
  const filteredMessages = useMemo(() => {
    switch (filter.type) {
      case 'errors':
        return messages.filter(m => m.type === 'error');
      case 'user':
        return messages.filter(m => m.sender === 'user');
      case 'assistant':
        return messages.filter(m => m.sender === 'assistant');
      default:
        return messages;
    }
  }, [messages, filter]);
  
  const addMessage = useCallback((message: ClaudeStreamMessage) => {
    setMessages(prev => [...prev, message]);
  }, []);
  
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);
  
  const contextValue = useMemo(() => ({
    messages,
    addMessage,
    clearMessages,
    filteredMessages,
    setFilter,
  }), [messages, addMessage, clearMessages, filteredMessages]);
  
  return (
    <TerminalOutputContext.Provider value={contextValue}>
      {children}
    </TerminalOutputContext.Provider>
  );
};

export const useTerminalOutput = () => {
  const context = useContext(TerminalOutputContext);
  if (!context) {
    throw new Error('useTerminalOutput must be used within TerminalOutputProvider');
  }
  return context;
};
```

## Event-Driven State Updates

### Tauri Event System → Web Events

```typescript
// Tauri event pattern (current)
await listen<string>('claude-output:session-123', (event) => {
  const message = JSON.parse(event.payload);
  setMessages(prev => [...prev, message]);
});

// Web-native event pattern (new)
class EventManager {
  private static instance: EventManager;
  private eventTarget = new EventTarget();
  
  static getInstance() {
    if (!EventManager.instance) {
      EventManager.instance = new EventManager();
    }
    return EventManager.instance;
  }
  
  emit(eventName: string, data: any) {
    this.eventTarget.dispatchEvent(
      new CustomEvent(eventName, { detail: data })
    );
  }
  
  on(eventName: string, callback: (event: CustomEvent) => void) {
    this.eventTarget.addEventListener(eventName, callback as EventListener);
    
    return () => {
      this.eventTarget.removeEventListener(eventName, callback as EventListener);
    };
  }
}

// React hook for event subscription
const useEventListener = (eventName: string, handler: (data: any) => void) => {
  useEffect(() => {
    const eventManager = EventManager.getInstance();
    
    const unsubscribe = eventManager.on(eventName, (event) => {
      handler(event.detail);
    });
    
    return unsubscribe;
  }, [eventName, handler]);
};

// Usage in components
const SessionOutput: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  
  useEventListener(`session-output:${sessionId}`, (message) => {
    setMessages(prev => [...prev, message]);
  });
  
  return (
    <div>
      {messages.map((message, index) => (
        <MessageDisplay key={index} message={message} />
      ))}
    </div>
  );
};
```

## State Synchronization Patterns

### Optimistic Updates with Rollback

```typescript
// Optimistic UI updates with error handling
const useOptimisticSessionUpdate = () => {
  const queryClient = useQueryClient();
  
  const updateSessionOptimistically = useCallback(
    async (sessionId: string, updates: Partial<Session>) => {
      // Optimistic update
      const previousSessions = queryClient.getQueryData(['sessions']);
      
      queryClient.setQueryData(['sessions'], (oldSessions: Session[] = []) =>
        oldSessions.map(session =>
          session.id === sessionId ? { ...session, ...updates } : session
        )
      );
      
      try {
        // Perform actual update
        await SessionAPI.updateSession(sessionId, updates);
      } catch (error) {
        // Rollback on error
        queryClient.setQueryData(['sessions'], previousSessions);
        throw error;
      }
    },
    [queryClient]
  );
  
  return updateSessionOptimistically;
};
```

### Cross-Component State Synchronization

```typescript
// State synchronization across multiple components
const useSessionSync = (sessionId: string) => {
  const queryClient = useQueryClient();
  
  // Subscribe to session updates via WebSocket
  useEventListener(`session-updated:${sessionId}`, (updatedSession) => {
    queryClient.setQueryData(
      ['session', sessionId],
      updatedSession
    );
    
    // Also update the sessions list
    queryClient.setQueryData(['sessions'], (oldSessions: Session[] = []) =>
      oldSessions.map(session =>
        session.id === sessionId ? updatedSession : session
      )
    );
  });
  
  // Synchronize local changes back to server
  const syncToServer = useCallback(async (localChanges: Partial<Session>) => {
    try {
      const updated = await SessionAPI.updateSession(sessionId, localChanges);
      
      // Emit update event for other components
      EventManager.getInstance().emit(`session-updated:${sessionId}`, updated);
      
      return updated;
    } catch (error) {
      console.error('Failed to sync session to server:', error);
      throw error;
    }
  }, [sessionId]);
  
  return { syncToServer };
};
```

## Performance Optimization Patterns

### Selective State Updates

```typescript
// Prevent unnecessary re-renders with selective updates
const useSessionSelector = <T>(
  sessionId: string,
  selector: (session: Session) => T
) => {
  const { data: session } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => SessionAPI.getSession(sessionId),
  });
  
  return useMemo(() => {
    return session ? selector(session) : undefined;
  }, [session, selector]);
};

// Usage: Only re-render when specific fields change
const SessionStatus = ({ sessionId }: { sessionId: string }) => {
  const status = useSessionSelector(sessionId, session => session.status);
  const lastMessage = useSessionSelector(sessionId, session => 
    session.messages[session.messages.length - 1]?.timestamp
  );
  
  return (
    <div>
      <span>Status: {status}</span>
      <span>Last activity: {lastMessage}</span>
    </div>
  );
};
```

### Debounced State Updates

```typescript
// Debounced updates for high-frequency changes
const useDebouncedState = <T>(initialValue: T, delay: number = 300) => {
  const [value, setValue] = useState<T>(initialValue);
  const [debouncedValue, setDebouncedValue] = useState<T>(initialValue);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => clearTimeout(timer);
  }, [value, delay]);
  
  return [debouncedValue, setValue] as const;
};

// Usage for search or filter inputs
const SessionSearch = () => {
  const [searchTerm, setSearchTerm] = useDebouncedState('', 300);
  
  const { data: filteredSessions } = useQuery({
    queryKey: ['sessions', 'search', searchTerm],
    queryFn: () => SessionAPI.searchSessions(searchTerm),
    enabled: searchTerm.length > 0,
  });
  
  return (
    <input
      type="text"
      onChange={(e) => setSearchTerm(e.target.value)}
      placeholder="Search sessions..."
    />
  );
};
```

## Migration Strategy

### Phase 1: Basic State Management
1. Set up React Query for server state
2. Implement Zustand for global UI state
3. Create WebSocket connection management

### Phase 2: Event System
1. Build web-native event system
2. Replace Tauri events with custom events
3. Implement cross-component synchronization

### Phase 3: Performance Optimization
1. Add optimistic updates
2. Implement selective state updates
3. Add debouncing for high-frequency updates

### Phase 4: Advanced Features
1. Add offline state management
2. Implement state persistence
3. Add undo/redo functionality

---

*State management pattern translations for web-native architecture*