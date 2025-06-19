/**
 * Shared Prettier configuration for Claude Pocket Console monorepo
 * 
 * This configuration ensures consistent code formatting across all packages.
 * Key principles:
 * - Readability first
 * - Consistency across the codebase
 * - Minimal configuration changes from Prettier defaults
 * - Works well with ESLint configuration
 */

module.exports = {
  // Line length and wrapping
  printWidth: 100, // Slightly wider than default 80 for modern screens
  tabWidth: 2, // 2 spaces for indentation (JavaScript/TypeScript standard)
  useTabs: false, // Use spaces instead of tabs for consistency
  
  // Semicolons and quotes
  semi: true, // Always use semicolons (prevents ASI issues)
  singleQuote: true, // Use single quotes for strings (except JSX)
  quoteProps: 'as-needed', // Only quote object properties when necessary
  
  // JSX specific
  jsxSingleQuote: false, // Use double quotes in JSX (HTML convention)
  
  // Trailing commas
  trailingComma: 'es5', // Add trailing commas where valid in ES5
  // Options: 'none' | 'es5' | 'all'
  // 'es5' is a good balance - works in all environments
  
  // Brackets and spacing
  bracketSpacing: true, // Add spaces inside object literals { foo: bar }
  bracketSameLine: false, // Put > of multi-line JSX on new line
  
  // Arrow functions
  arrowParens: 'always', // Always include parens around arrow function params
  // (x) => x instead of x => x - more consistent and clear
  
  // Line endings
  endOfLine: 'lf', // Use Unix-style line endings (LF)
  
  // Markdown
  proseWrap: 'preserve', // Don't wrap markdown text
  
  // HTML/JSX whitespace sensitivity
  htmlWhitespaceSensitivity: 'css', // Respect CSS display property
  
  // Vue specific (not used in this project, but good defaults)
  vueIndentScriptAndStyle: false,
  
  // Special handling for specific files
  overrides: [
    {
      // Package.json files should have specific formatting
      files: ['package.json', 'tsconfig.json', 'jsconfig.json'],
      options: {
        tabWidth: 2,
        printWidth: 80,
      },
    },
    {
      // Markdown files might need different line lengths
      files: ['*.md', '*.mdx'],
      options: {
        printWidth: 80,
        proseWrap: 'always', // Wrap prose in markdown files
      },
    },
    {
      // YAML files
      files: ['*.yml', '*.yaml'],
      options: {
        tabWidth: 2,
        singleQuote: false, // Use double quotes in YAML
      },
    },
  ],
  
  // Plugins can be added here if needed
  // plugins: ['prettier-plugin-tailwindcss'], // Example: for Tailwind CSS class sorting
}