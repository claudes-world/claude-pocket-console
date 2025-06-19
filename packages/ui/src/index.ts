/**
 * @cpc/ui
 * 
 * Shared UI component library for Claude Pocket Console.
 * This package provides reusable React components that implement
 * the console's design system and interactive elements.
 * 
 * Usage example:
 * ```typescript
 * import { Button, Terminal } from '@cpc/ui';
 * 
 * function App() {
 *   return (
 *     <div>
 *       <Terminal onCommand={(cmd) => console.log(cmd)} />
 *       <Button onClick={() => alert('Clicked!')}>
 *         Execute
 *       </Button>
 *     </div>
 *   );
 * }
 * ```
 */

// Export all components
export * from './components';

// Export utility functions if needed in the future
// export * from './utils';