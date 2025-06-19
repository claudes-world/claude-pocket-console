import React, { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Terminal line type
 */
export interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'system';
  content: string;
  timestamp: Date;
}

/**
 * Terminal component props
 */
export interface TerminalProps {
  /**
   * Callback when a command is submitted
   */
  onCommand?: (command: string) => void | Promise<void>;
  
  /**
   * Initial lines to display in the terminal
   */
  initialLines?: TerminalLine[];
  
  /**
   * The prompt string to display before input
   */
  prompt?: string;
  
  /**
   * Whether the terminal is in a read-only state
   */
  readOnly?: boolean;
  
  /**
   * Custom class name for styling
   */
  className?: string;
  
  /**
   * Height of the terminal in pixels or CSS value
   */
  height?: string | number;
  
  /**
   * Whether to show timestamps for each line
   */
  showTimestamps?: boolean;
  
  /**
   * Theme variant for the terminal
   */
  theme?: 'dark' | 'light';
}

/**
 * Terminal component
 * 
 * An interactive terminal emulator component that provides a command-line
 * interface for users. Supports command history, auto-scrolling, and
 * customizable styling.
 * 
 * @example
 * ```tsx
 * <Terminal
 *   onCommand={async (cmd) => {
 *     console.log('Command:', cmd);
 *     // Process command and return output
 *   }}
 *   prompt="$ "
 *   height={400}
 * />
 * ```
 */
export const Terminal: React.FC<TerminalProps> = ({
  onCommand,
  initialLines = [],
  prompt = '$ ',
  readOnly = false,
  className,
  height = 400,
  showTimestamps = false,
  theme = 'dark',
}) => {
  const [lines, setLines] = useState<TerminalLine[]>(initialLines);
  const [currentInput, setCurrentInput] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // TODO: Implement terminal functionality
  // This is a skeleton implementation
  
  const baseStyles = 'font-mono text-sm overflow-auto';
  
  const themeStyles = {
    dark: 'bg-gray-900 text-gray-100',
    light: 'bg-white text-gray-900 border border-gray-200',
  };
  
  const classes = twMerge(
    clsx(
      baseStyles,
      themeStyles[theme],
      'rounded-lg p-4',
      className
    )
  );
  
  // Auto-scroll to bottom when new lines are added
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentInput.trim()) return;
    
    // TODO: Add command to lines
    // TODO: Add to command history
    // TODO: Call onCommand callback
    // TODO: Clear current input
    
    console.log('Command submitted:', currentInput);
    if (onCommand) {
      // Will be implemented when integrating with backend
    }
    setLines(prev => prev); // Placeholder to avoid unused warning
    setCurrentInput('');
  };
  
  const handleKeyDown = (_e: React.KeyboardEvent<HTMLInputElement>) => {
    // TODO: Implement command history navigation with up/down arrows
    // TODO: Implement tab completion
    // TODO: Implement other keyboard shortcuts
  };
  
  return (
    <div
      ref={terminalRef}
      className={classes}
      style={{ height }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Terminal lines */}
      <div className="space-y-1">
        {lines.map((line) => (
          <div
            key={line.id}
            className={clsx(
              'flex items-start',
              line.type === 'error' && 'text-red-400',
              line.type === 'system' && 'text-gray-500'
            )}
          >
            {showTimestamps && (
              <span className="text-gray-500 mr-2">
                [{line.timestamp.toLocaleTimeString()}]
              </span>
            )}
            {line.type === 'input' && <span className="mr-1">{prompt}</span>}
            <span className="flex-1">{line.content}</span>
          </div>
        ))}
      </div>
      
      {/* Input line */}
      {!readOnly && (
        <form onSubmit={handleSubmit} className="flex items-center mt-2">
          <span className="mr-1">{prompt}</span>
          <input
            ref={inputRef}
            type="text"
            value={currentInput}
            onChange={(e) => setCurrentInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none"
            autoFocus
          />
        </form>
      )}
    </div>
  );
};

Terminal.displayName = 'Terminal';