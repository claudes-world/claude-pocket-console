# **Claude Pocket Console**

>Author: Gemini 2.5 

A hybrid monorepo for a real-time web terminal backed by isolated, secure backend containers.

## **∎ Guiding Principles**

| Goal | Decision |
| :---- | :---- |
| **Fast Local Dev** | pnpm \+ Turborepo (with remote caching enabled day-1) |
| **Lean Python** | uv for all Python dependency management; no Poetry/pipenv. |
| **Clear Boundaries** | **apps/** for deployables, **packages/** for shared libs, **infrastructure/** for IaC. |
| **Secure by Default** | Every terminal session runs in a hardened, rootless Docker container with no network access. |
| **Keep Types in Sync** | Use Zod schemas in packages/shared-types as the single source of truth for TS and JSON types. |
| **Pragmatic Mobile** | Ship as a **PWA \+ Capacitor wrapper** first; revisit React Native only if core APIs are needed. |

## **∎ Technology Stack**

| Category | Choice | Rationale |
| :---- | :---- | :---- |
| **Package Managers** | pnpm (Node), uv (Python) | Performance, native monorepo support, and deterministic installs. |
| **Build Orchestration** | Turborepo (with remote cache) | High-performance parallel builds and smart caching to speed up CI and local dev. |
| **Frontend** | Next.js (App Router) \+ TypeScript | A modern, production-grade React framework with excellent developer experience. |
| **Styling** | Tailwind CSS \+ shadcn/ui | A utility-first CSS framework and component library for rapid, consistent UI dev. |
| **Backend** | FastAPI (Python) \+ Uvicorn | High-performance asynchronous framework with built-in WebSocket support. |
| **Database & Auth** | Convex | Real-time database, serverless functions, and built-in GitHub OAuth. |
| **Infrastructure** | Terraform \+ Google Cloud Run | Infrastructure as Code for reproducible environments and serverless containers. |
| **Containers** | Docker \+ Docker Compose | Local development parity and standardized production builds. |
| **CI/CD** | GitHub Actions | Native integration with the repository for automated workflows. |

## **∎ Repository Structure**

claude-pocket-console/  
├─ .github/                  \# GitHub Actions workflows and contribution guidelines  
├─ apps/  
│  ├─ web/                   \# Next.js frontend application  
│  └─ terminal-server/       \# FastAPI backend application  
├─ packages/  
│  ├─ ui/                    \# Shared React components (shadcn-based)  
│  ├─ shared-types/          \# Zod schemas \-\> TS types & JSON schemas  
│  └─ config/                \# Shared configurations (ESLint, Prettier, TSConfig)  
├─ infrastructure/  
│  ├─ convex/                \# Convex schema and functions  
│  ├─ terraform/             \# Terraform for GCP resources  
│  └─ docker/                \# Dockerfiles and Docker Compose configs  
├─ .gitignore  
├─ package.json              \# Root workspace definition and scripts  
├─ pnpm-workspace.yaml  
├─ turbo.json                \# Turborepo task pipeline configuration  
└─ README.md                 \# You are here\!

## **∎ Getting Started**

### **Prerequisites**

Ensure you have the following tools installed and available on your PATH:

* **Node.js** (v20 LTS)  
* **pnpm** (enable with corepack enable)  
* **uv** (Python package manager)  
* **Docker** (and the Docker daemon is running)

### **Bootstrap Commands**

1. **Clone the repository:**  
   git clone https://github.com/\<your-org\>/claude-pocket-console.git  
   cd claude-pocket-console

2. Install all dependencies:  
   This single command installs Node.js dependencies for all apps and packages and syncs the Python dependencies for the terminal-server.  
   pnpm install

3. Configure local environment:  
   Copy the example environment file and add your secrets (e.g., Convex deploy key).  
   cp .env.example .env.local

4. Launch the development environment:  
   This uses docker-compose to start the backend services and pnpm to start the web frontend with hot-reloading.  
   pnpm dev

You should now be able to access the web application at [**http://localhost:3000**](http://localhost:3000).

## **∎ Learn More**

This README.md provides a high-level overview. For detailed information on specific topics, please refer to our full documentation:

* [**CONTRIBUTING.md**](http://docs.google.com/.github/CONTRIBUTING.md)**:** Our guide for contributors, including our Git workflow, commit message conventions, and PR process.  
* [**docs/ARCHITECTURE.md**](http://docs.google.com/docs/ARCHITECTURE.md)**:** A deep dive into the architecture of the services, API specifications, and our type-sharing strategy.  
* [**docs/INFRASTRUCTURE.md**](http://docs.google.com/docs/INFRASTRUCTURE.md)**:** Detailed information on the Terraform setup, deployment process, and environment configuration.