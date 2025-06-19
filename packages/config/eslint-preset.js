/**
 * Shared ESLint configuration for Claude Pocket Console monorepo
 * 
 * This configuration provides:
 * - TypeScript support with type-aware linting
 * - React and React Hooks best practices
 * - Next.js specific rules for app directory
 * - Import order and organization
 * - Accessibility rules for better UX
 * - Code quality and consistency rules
 */

module.exports = {
  // Use TypeScript ESLint parser for TypeScript files
  parser: '@typescript-eslint/parser',
  
  // Default parser options
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  
  // Environment settings
  env: {
    browser: true,
    node: true,
    es2022: true,
    jest: true,
  },
  
  // Extend recommended configurations
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier', // Must be last to override other formatting rules
  ],
  
  // Required plugins
  plugins: [
    '@typescript-eslint',
    'react',
    'react-hooks',
    'jsx-a11y',
    'import',
  ],
  
  // React version detection
  settings: {
    react: {
      version: 'detect',
    },
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
      },
    },
  },
  
  // Custom rules
  rules: {
    // TypeScript specific rules
    '@typescript-eslint/explicit-module-boundary-types': 'off', // Allow inference for module boundaries
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-explicit-any': 'warn', // Warn on any usage but don't error
    '@typescript-eslint/no-non-null-assertion': 'warn', // Warn on ! usage
    '@typescript-eslint/consistent-type-imports': [
      'error',
      {
        prefer: 'type-imports',
        disallowTypeAnnotations: true,
      },
    ],
    
    // React specific rules
    'react/react-in-jsx-scope': 'off', // Not needed with React 17+ JSX transform
    'react/prop-types': 'off', // TypeScript handles prop validation
    'react/display-name': 'off', // Allow anonymous components
    'react/jsx-uses-react': 'off', // Not needed with React 17+
    
    // React Hooks rules
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    
    // Import organization
    'import/order': [
      'error',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          ['parent', 'sibling'],
          'index',
          'object',
          'type',
        ],
        'newlines-between': 'always',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    'import/no-unresolved': 'error',
    'import/no-cycle': 'error',
    'import/no-default-export': 'off', // Allow default exports for Next.js pages
    
    // General code quality rules
    'no-console': [
      'warn',
      {
        allow: ['warn', 'error', 'info'],
      },
    ],
    'no-debugger': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    
    // Accessibility rules
    'jsx-a11y/anchor-is-valid': [
      'error',
      {
        components: ['Link'], // Next.js Link component
        specialLink: ['hrefLeft', 'hrefRight'],
        aspects: ['invalidHref', 'preferButton'],
      },
    ],
  },
  
  // Override rules for specific file patterns
  overrides: [
    // Configuration files (allow require and console)
    {
      files: ['*.js', '*.cjs', '*.mjs'],
      env: {
        node: true,
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-console': 'off',
      },
    },
    // Test files
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
      env: {
        jest: true,
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    // Next.js specific files
    {
      files: ['**/app/**/*.tsx', '**/pages/**/*.tsx', '**/app/**/*.ts', '**/pages/**/*.ts'],
      rules: {
        'import/no-default-export': 'off', // Next.js requires default exports
      },
    },
  ],
  
  // Ignore patterns
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.turbo',
    '.next',
    'out',
    '*.min.js',
    '*.d.ts',
  ],
}