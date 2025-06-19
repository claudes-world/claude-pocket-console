# Claude Pocket Console - Initial Setup Prompt

You are about to set up the Claude Pocket Console monorepo. This project is a secure, real-time web terminal powered by isolated Docker containers, built with Next.js 15 and FastAPI.

## Your Mission

Set up the complete monorepo structure and initial scaffolding for the Claude Pocket Console project following the documentation that has already been created.

## Documentation to Follow

Read and follow these documents in order:

1. **README.md** - Understand the project overview and structure
2. **docs/ARCHITECTURE.md** - Understand the technical architecture
3. **docs/DEVELOPMENT.md** - Follow the development setup guide
4. **.github/CONTRIBUTING.md** - Understand the workflow and standards

## Setup Tasks

### 1. Initialize Monorepo Structure

Create the directory structure as defined in README.md:
```
claude-pocket-console/
├── apps/
│   ├── web/                 # Next.js 15.3 frontend
│   └── terminal-server/     # FastAPI backend
├── packages/
│   ├── ui/                  # Shared React components
│   ├── shared-types/        # Zod schemas → TS + JSON
│   └── config/              # Shared configs
├── infrastructure/
│   ├── convex/              # Backend schema
│   ├── terraform/           # GCP infrastructure
│   └── docker/              # Container configs
├── scripts/                 # Dev automation
└── docs/                    # (already exists)
```

### 2. Initialize Package Managers

- Set up pnpm workspace (`pnpm-workspace.yaml`)
- Create root `package.json` with workspace scripts
- Set up Turborepo configuration (`turbo.json`)

### 3. Create Service Scaffolds

For each service (web, terminal-server):
- Initialize with appropriate framework
- Set up basic configuration
- Create README.md with service-specific info
- Add necessary dependencies

### 4. Set Up Shared Packages

- Create TypeScript configurations
- Set up ESLint and Prettier configs
- Initialize shared-types with Zod
- Create basic UI component library structure

### 5. Configure Infrastructure

- Create Docker sandbox image configuration
- Set up basic docker-compose.yml for local dev
- Create .env.example with all required variables
- Initialize Convex schema

### 6. Set Up Development Tools

- Configure Git hooks with Husky
- Set up pre-commit hooks for linting
- Create development scripts
- Add VS Code workspace settings

## Important Notes

1. **Follow the Tech Stack** exactly as specified in README.md:
   - Node 20 LTS
   - Python 3.12
   - Next.js 15.3
   - FastAPI ≥0.111
   - pnpm + Turborepo
   - uv for Python

2. **Security First**: Remember the guiding principle - every terminal session must run in a rootless Docker sandbox with strict isolation

3. **Type Safety**: Use Zod schemas in packages/shared-types as the single source of truth

4. **Git Workflow**: 
   - Create a feature branch for this work
   - Make atomic commits following conventional commits
   - Reference the GitHub issue in commits

## Environment Setup Required

Before starting, ensure you have:
- Node.js 20 LTS
- pnpm (via corepack)
- Python 3.12
- uv (Python package manager)
- Docker
- Git

## Getting Started

1. First, source the environment file:
   ```bash
   source .claude/.env
   ```

2. Read all the documentation files mentioned above

3. Create a feature branch:
   ```bash
   git checkout -b feat/2-initial-monorepo-setup
   ```

4. Start implementing the structure following the documentation

## Success Criteria

- [ ] All directories created as specified
- [ ] Package managers configured (pnpm, uv)
- [ ] Basic service scaffolds in place
- [ ] Shared packages initialized
- [ ] Development environment can be started with `pnpm dev`
- [ ] All configuration files have helpful comments
- [ ] No placeholder or example code - only structural setup

Remember: You're setting up the foundation. Don't implement features, just create the structure and configuration that will enable development according to the architecture defined in the docs.

Good luck! 🚀