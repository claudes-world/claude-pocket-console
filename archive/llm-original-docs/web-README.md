# Web Console

>Author: Claude Opus 4.0

Next.js 15.3 frontend with terminal emulator, built with App Router and Tailwind CSS v4.

## Local Development

### Setup

```bash
# From repo root
cd apps/web

# Install dependencies (handled by pnpm workspace)
pnpm install

# Copy environment variables
cp .env.example .env.local
```

### Environment Variables

```bash
# .env.local
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
CONVEX_DEPLOY_KEY=your-deploy-key
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
GITHUB_CLIENT_ID=your-oauth-app-id
GITHUB_CLIENT_SECRET=your-oauth-secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Running

```bash
# Development server
pnpm dev

# Build for production
pnpm build

# Run production build locally
pnpm start

# Type checking
pnpm type-check

# Linting
pnpm lint
```

## Project Structure

```
web/
├── src/
│   ├── app/                    # App Router pages
│   │   ├── (auth)/            # Auth group
│   │   │   ├── login/
│   │   │   └── logout/
│   │   ├── (dashboard)/       # Protected routes
│   │   │   ├── terminal/
│   │   │   ├── sessions/
│   │   │   └── layout.tsx
│   │   ├── api/               # API routes
│   │   ├── layout.tsx         # Root layout
│   │   └── page.tsx           # Landing page
│   ├── components/
│   │   ├── terminal/
│   │   │   ├── Terminal.tsx
│   │   │   ├── TerminalControls.tsx
│   │   │   └── SessionList.tsx
│   │   ├── ui/                # Local UI components
│   │   └── providers/         # Context providers
│   ├── hooks/
│   │   ├── useTerminal.ts
│   │   ├── useWebSocket.ts
│   │   └── useAuth.ts
│   ├── lib/
│   │   ├── convex.ts          # Convex client
│   │   ├── utils.ts
│   │   └── constants.ts
│   └── styles/
│       └── globals.css        # Tailwind directives
├── public/
│   ├── manifest.json          # PWA manifest
│   └── icons/                 # PWA icons
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## Key Components

### Terminal Component

```tsx
// Main terminal interface with xterm.js
import { Terminal } from '@/components/terminal/Terminal'

<Terminal 
  sessionId={sessionId}
  onClose={handleClose}
  height={600}
/>
```

Features:
- Auto-reconnecting WebSocket
- Command history (up/down arrows)
- Copy/paste support
- Responsive sizing
- Theme customization

### WebSocket Hook

```tsx
// Auto-reconnecting WebSocket with exponential backoff
const { 
  socket, 
  isConnected, 
  sendMessage, 
  lastMessage 
} = useWebSocket(wsUrl, {
  reconnectAttempts: 10,
  reconnectInterval: 1000,
  maxReconnectInterval: 30000,
  shouldReconnect: true
})
```

### Authentication

```tsx
// Convex-based auth with GitHub OAuth
const { user, isLoading, signIn, signOut } = useAuth()

// Protected route wrapper
<AuthGuard requireAuth>
  <TerminalPage />
</AuthGuard>
```

## Styling

Using Tailwind CSS v4 (Oxide engine):

```css
/* Custom utility classes in globals.css */
@layer utilities {
  .terminal-container {
    @apply rounded-lg border border-border bg-background p-4;
  }
  
  .terminal-connected {
    @apply border-green-500/50;
  }
  
  .terminal-disconnected {
    @apply border-red-500/50;
  }
}
```

### Theme Support

```tsx
// Automatic dark mode with next-themes
<ThemeProvider
  attribute="class"
  defaultTheme="system"
  enableSystem
>
  <App />
</ThemeProvider>
```

## Testing

```bash
# Unit tests
pnpm test

# Watch mode
pnpm test:watch

# E2E tests with Playwright
pnpm test:e2e

# Component testing
pnpm test:components
```

### Test Structure

```typescript
// __tests__/components/Terminal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { Terminal } from '@/components/terminal/Terminal'

describe('Terminal', () => {
  it('connects to WebSocket on mount', () => {
    // Test implementation
  })
  
  it('handles reconnection on disconnect', () => {
    // Test implementation
  })
})
```

## PWA Configuration

### Service Worker

```js
// public/sw.js
self.addEventListener('install', (event) => {
  // Cache static assets
})

self.addEventListener('fetch', (event) => {
  // Offline-first strategy
})
```

### Manifest

```json
{
  "name": "Claude Pocket Console",
  "short_name": "CPC",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#000000",
  "background_color": "#000000",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

## Performance Optimization

### Next.js Config

```js
// next.config.mjs
export default {
  reactStrictMode: true,
  images: {
    domains: ['avatars.githubusercontent.com'],
  },
  experimental: {
    optimizeCss: true,
    turbotrace: true,
  },
  // Bundle analyzer
  webpack: (config, { isServer }) => {
    if (process.env.ANALYZE) {
      // Bundle analysis config
    }
    return config
  }
}
```

### Code Splitting

```tsx
// Dynamic imports for heavy components
const Terminal = dynamic(() => import('@/components/terminal/Terminal'), {
  loading: () => <TerminalSkeleton />,
  ssr: false  // xterm.js requires browser APIs
})
```

## Deployment

### Build Optimization

```bash
# Analyze bundle size
ANALYZE=true pnpm build

# Production build with source maps
SOURCE_MAPS=true pnpm build
```

### Docker Build

```dockerfile
# Multi-stage build for optimal size
FROM node:20-alpine AS deps
# Install dependencies

FROM node:20-alpine AS builder
# Build application

FROM node:20-alpine AS runner
# Run production server
```

## Troubleshooting

### Common Issues

**1. xterm.js not rendering**
- Ensure component is client-side only (`ssr: false`)
- Check container has explicit height
- Verify fonts are loaded

**2. WebSocket connection fails**
- Check CORS settings on terminal server
- Verify WebSocket URL format
- Check browser console for errors

**3. Authentication loops**
- Clear cookies and localStorage
- Verify GitHub OAuth callback URL
- Check Convex deployment key

### Debug Mode

```tsx
// Enable debug logging
if (process.env.NODE_ENV === 'development') {
  window.DEBUG = {
    websocket: true,
    terminal: true,
    auth: true
  }
}
```

## Shared Packages

This app uses shared packages from the monorepo:

- `@cpc/ui`: Shared React components
- `@cpc/shared-types`: TypeScript types
- `@cpc/config`: ESLint/Prettier config

Import them directly:
```tsx
import { Button } from '@cpc/ui'
import type { Session } from '@cpc/shared-types'
```