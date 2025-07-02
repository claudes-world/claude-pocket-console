# Mobile Adaptation Patterns

**Translating Claudia's desktop-first UI patterns to mobile-first web experience**

## Executive Summary

Claudia's React architecture provides excellent foundations for mobile adaptation, but requires significant responsive design enhancements. The analysis reveals specific patterns that need mobile-first redesign: **navigation systems**, **layout components**, **terminal interfaces**, and **touch interactions**.

## Navigation System Translation

### Current Desktop Pattern (Claudia)
```typescript
// Multi-view state management with complex transitions
const [view, setView] = useState<View>("welcome");

const renderContent = () => {
  switch (view) {
    case "projects": return <ProjectList />;
    case "sessions": return <SessionList />;
    case "claude-session": return <ClaudeCodeSession />;
    case "agents": return <CCAgents />;
    default: return <WelcomeScreen />;
  }
};
```

### Mobile-First Pattern (Pocket Console)
```typescript
// Stack-based navigation with gesture support
interface NavigationItem {
  view: View;
  props?: any;
  timestamp: number;
}

const useMobileNavigation = () => {
  const [stack, setStack] = useState<NavigationItem[]>([]);
  const [currentView, setCurrentView] = useState<View>('home');
  
  const push = (view: View, props?: any) => {
    setStack(prev => [...prev, { 
      view: currentView, 
      props: currentProps,
      timestamp: Date.now() 
    }]);
    setCurrentView(view);
    setCurrentProps(props);
  };
  
  const pop = () => {
    const previous = stack.pop();
    if (previous) {
      setCurrentView(previous.view);
      setCurrentProps(previous.props);
      setStack([...stack]);
    }
  };
  
  const popToRoot = () => {
    setStack([]);
    setCurrentView('home');
    setCurrentProps(undefined);
  };
  
  return { 
    currentView, 
    push, 
    pop, 
    popToRoot,
    canGoBack: stack.length > 0,
    stackDepth: stack.length 
  };
};
```

### Mobile Navigation Components
```typescript
// Mobile-optimized navigation header
const MobileNavHeader: React.FC<{
  title: string;
  canGoBack: boolean;
  onBack: () => void;
  actions?: React.ReactNode;
}> = ({ title, canGoBack, onBack, actions }) => {
  return (
    <header className="sticky top-0 z-50 bg-background border-b px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {canGoBack && (
            <button
              onClick={onBack}
              className="p-2 -ml-2 rounded-lg hover:bg-accent touch-manipulation"
              aria-label="Go back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-lg font-semibold truncate">{title}</h1>
        </div>
        {actions && (
          <div className="flex items-center space-x-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
};
```

## Layout Pattern Translation

### Current Desktop Layout (Split Pane)
```typescript
// Desktop-optimized split pane
const ClaudeCodeSession: React.FC = () => {
  return (
    <SplitPane
      left={<InputPanel />}
      right={<OutputPanel />}
      initialRatio={0.3}
      minLeftWidth={250}
      minRightWidth={300}
    />
  );
};
```

### Mobile-First Layout (Tabbed Interface)
```typescript
// Mobile-optimized tabbed interface
const MobileTerminalInterface: React.FC = () => {
  const [activePane, setActivePane] = useState<'input' | 'output' | 'files'>('output');
  const [hasNewOutput, setHasNewOutput] = useState(false);
  
  return (
    <div className="h-full flex flex-col">
      {/* Tab navigation with notification badges */}
      <div className="flex border-b bg-background">
        <TabButton
          active={activePane === 'output'}
          onClick={() => setActivePane('output')}
          badge={hasNewOutput}
          icon={<Terminal className="h-4 w-4" />}
        >
          Output
        </TabButton>
        <TabButton
          active={activePane === 'input'}
          onClick={() => setActivePane('input')}
          icon={<MessageSquare className="h-4 w-4" />}
        >
          Input
        </TabButton>
        <TabButton
          active={activePane === 'files'}
          onClick={() => setActivePane('files')}
          icon={<Files className="h-4 w-4" />}
        >
          Files
        </TabButton>
      </div>
      
      {/* Content area with smooth transitions */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activePane}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0"
          >
            {activePane === 'output' && <TerminalOutput />}
            {activePane === 'input' && <TerminalInput />}
            {activePane === 'files' && <FileExplorer />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  badge?: boolean;
}> = ({ active, onClick, children, icon, badge }) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center space-x-2 py-3 text-sm font-medium relative",
        "transition-colors touch-manipulation",
        active 
          ? "text-primary border-b-2 border-primary bg-accent/20" 
          : "text-muted-foreground hover:text-foreground hover:bg-accent/10"
      )}
    >
      {icon}
      <span>{children}</span>
      {badge && (
        <div className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
      )}
    </button>
  );
};
```

## Touch Interaction Patterns

### Desktop Click Events → Touch Gestures
```typescript
// Enhanced button component with touch feedback
const MobileTouchButton: React.FC<ButtonProps> = ({ 
  children, 
  onClick, 
  variant = "default",
  size = "default",
  disabled,
  ...props 
}) => {
  const [isPressed, setIsPressed] = useState(false);
  
  return (
    <motion.button
      className={cn(
        buttonVariants({ variant, size }),
        "touch-manipulation select-none",
        isPressed && "scale-95"
      )}
      onTouchStart={() => setIsPressed(true)}
      onTouchEnd={() => setIsPressed(false)}
      onTouchCancel={() => setIsPressed(false)}
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.1 }}
      {...props}
    >
      {children}
    </motion.button>
  );
};

// Swipe gesture support for lists
const useSwipeGestures = (onSwipeLeft?: () => void, onSwipeRight?: () => void) => {
  const bind = useGesture({
    onDrag: ({ direction: [dx], distance, velocity }) => {
      if (distance > 50 && velocity > 0.5) {
        if (dx > 0 && onSwipeRight) {
          onSwipeRight();
        } else if (dx < 0 && onSwipeLeft) {
          onSwipeLeft();
        }
      }
    },
  });
  
  return bind();
};

// Swipeable list item component
const SwipeableListItem: React.FC<{
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}> = ({ children, onSwipeLeft, onSwipeRight }) => {
  const bind = useSwipeGestures(onSwipeLeft, onSwipeRight);
  
  return (
    <motion.div
      {...bind}
      className="relative overflow-hidden"
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.2}
    >
      {children}
    </motion.div>
  );
};
```

## Mobile-Specific UI Components

### Responsive Dialog System
```typescript
// Desktop modal → Mobile full-screen dialog
const ResponsiveDialog: React.FC<{
  children: React.ReactNode;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ children, title, open, onOpenChange }) => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90vh]">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex-1 overflow-y-auto">
            {children}
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
};
```

### Mobile-Optimized Form Components
```typescript
// Touch-friendly form inputs
const MobileInput: React.FC<InputProps> = ({ className, ...props }) => {
  return (
    <input
      className={cn(
        "flex h-12 w-full rounded-lg border border-input bg-background px-4 py-3 text-base",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "touch-manipulation",
        className
      )}
      {...props}
    />
  );
};

// Mobile-friendly select component
const MobileSelect: React.FC<SelectProps> = ({ children, ...props }) => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  
  if (isMobile) {
    return (
      <Select {...props}>
        <SelectTrigger className="h-12 text-base">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="item-aligned" className="max-h-[60vh]">
          {children}
        </SelectContent>
      </Select>
    );
  }
  
  return (
    <Select {...props}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {children}
      </SelectContent>
    </Select>
  );
};
```

## Terminal Interface Mobile Adaptation

### Desktop Terminal → Mobile Terminal
```typescript
// Desktop terminal output with fixed layout
const DesktopTerminalOutput: React.FC = () => {
  return (
    <div className="h-full overflow-y-auto font-mono text-sm p-4">
      {messages.map((message, index) => (
        <TerminalMessage key={index} message={message} />
      ))}
    </div>
  );
};

// Mobile terminal with optimized sizing and touch scrolling
const MobileTerminalOutput: React.FC = () => {
  const [fontSize, setFontSize] = useState(14);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom with smooth behavior
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);
  
  return (
    <div className="h-full flex flex-col">
      {/* Terminal controls */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setFontSize(prev => Math.max(10, prev - 1))}
            className="p-2 rounded-md hover:bg-accent"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium">{fontSize}px</span>
          <button
            onClick={() => setFontSize(prev => Math.min(20, prev + 1))}
            className="p-2 rounded-md hover:bg-accent"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={clearOutput}
          className="p-2 rounded-md hover:bg-accent"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      
      {/* Terminal output with virtual scrolling */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ 
          fontSize: `${fontSize}px`,
          lineHeight: 1.5,
          WebkitOverflowScrolling: 'touch'
        }}
      >
        <VirtualizedMessageList
          messages={messages}
          estimatedItemHeight={fontSize * 1.5}
          containerHeight="100%"
        />
      </div>
    </div>
  );
};
```

### Mobile Input Patterns
```typescript
// Mobile-optimized command input
const MobileTerminalInput: React.FC = () => {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = 
        Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);
  
  return (
    <div className="h-full flex flex-col p-4">
      {/* Command suggestions */}
      {suggestions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {suggestions.slice(0, 3).map((suggestion, index) => (
            <button
              key={index}
              onClick={() => setInput(suggestion)}
              className="px-3 py-1.5 bg-accent text-accent-foreground rounded-md text-sm"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      
      {/* Multi-line input */}
      <div className="flex-1 flex flex-col">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter your command or prompt..."
          className={cn(
            "flex-1 min-h-[80px] w-full rounded-lg border border-input bg-background",
            "px-4 py-3 text-base resize-none",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        />
        
        {/* Action buttons */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center space-x-2">
            <button
              onClick={attachFile}
              className="p-2 rounded-lg hover:bg-accent"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <button
              onClick={openMicrophone}
              className="p-2 rounded-lg hover:bg-accent"
            >
              <Mic className="h-5 w-5" />
            </button>
          </div>
          
          <button
            onClick={executeCommand}
            disabled={!input.trim()}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
```

## Responsive Design Utilities

### Mobile-First Breakpoint System
```typescript
// Enhanced breakpoint utilities
const breakpoints = {
  sm: '640px',   // Small phones
  md: '768px',   // Large phones / small tablets
  lg: '1024px',  // Tablets / small laptops
  xl: '1280px',  // Laptops
  '2xl': '1536px' // Desktops
} as const;

const useBreakpoint = (breakpoint: keyof typeof breakpoints) => {
  const [matches, setMatches] = useState(false);
  
  useEffect(() => {
    const query = `(min-width: ${breakpoints[breakpoint]})`;
    const media = window.matchMedia(query);
    
    setMatches(media.matches);
    
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addListener(listener);
    
    return () => media.removeListener(listener);
  }, [breakpoint]);
  
  return matches;
};

// Responsive utility components
const ResponsiveContainer: React.FC<{
  children: React.ReactNode;
  mobileLayout?: 'stack' | 'grid';
  desktopLayout?: 'grid' | 'flex';
}> = ({ children, mobileLayout = 'stack', desktopLayout = 'grid' }) => {
  const isMobile = !useBreakpoint('md');
  
  const layoutClasses = {
    mobile: {
      stack: 'flex flex-col space-y-4',
      grid: 'grid grid-cols-1 gap-4'
    },
    desktop: {
      grid: 'grid grid-cols-2 lg:grid-cols-3 gap-6',
      flex: 'flex space-x-6'
    }
  };
  
  return (
    <div className={cn(
      "w-full",
      isMobile 
        ? layoutClasses.mobile[mobileLayout]
        : layoutClasses.desktop[desktopLayout]
    )}>
      {children}
    </div>
  );
};
```

## Performance Optimizations for Mobile

### Virtual Scrolling for Large Lists
```typescript
// Mobile-optimized virtual list
const VirtualizedList: React.FC<{
  items: any[];
  renderItem: (item: any, index: number) => React.ReactNode;
  estimatedItemHeight: number;
  className?: string;
}> = ({ items, renderItem, estimatedItemHeight, className }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedItemHeight,
    overscan: 5,
  });
  
  return (
    <div
      ref={parentRef}
      className={cn("h-full overflow-auto overscroll-contain", className)}
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
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
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
};
```

### Image Optimization
```typescript
// Mobile-optimized image component
const OptimizedImage: React.FC<{
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}> = ({ src, alt, className, priority = false }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  
  return (
    <div className={cn("relative overflow-hidden", className)}>
      {!isLoaded && !error && (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      )}
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        onLoad={() => setIsLoaded(true)}
        onError={() => setError(true)}
        className={cn(
          "transition-opacity duration-300",
          isLoaded ? "opacity-100" : "opacity-0",
          error && "hidden"
        )}
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <ImageOff className="h-8 w-8 text-muted-foreground" />
        </div>
      )}
    </div>
  );
};
```

## Implementation Priority

### Phase 1: Core Mobile Navigation
1. Implement stack-based navigation system
2. Create mobile-optimized header components
3. Add basic gesture support for back navigation

### Phase 2: Layout Adaptation
1. Replace SplitPane with tabbed interface
2. Create responsive dialog system
3. Implement touch-friendly form components

### Phase 3: Terminal Mobile Experience
1. Optimize terminal output for mobile screens
2. Create mobile-specific input patterns
3. Add terminal-specific gesture controls

### Phase 4: Performance & Polish
1. Implement virtual scrolling for large outputs
2. Add advanced gesture support
3. Optimize for various mobile screen sizes

---

*Mobile adaptation patterns for Pocket Console's responsive terminal interface*