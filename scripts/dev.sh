#!/usr/bin/env bash
# dev.sh - Development helper script for Claude Pocket Console
# This script provides shortcuts for common development tasks

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display usage
usage() {
    echo -e "${BLUE}Claude Pocket Console Development Helper${NC}"
    echo ""
    echo "Usage: ./scripts/dev.sh [command] [options]"
    echo ""
    echo "Commands:"
    echo "  start         Start all services in development mode"
    echo "  stop          Stop all running services"
    echo "  restart       Restart all services"
    echo "  web           Start only the web app"
    echo "  terminal      Start only the terminal server"
    echo "  convex        Start only Convex development"
    echo "  logs [service] Show logs for a specific service"
    echo "  test [filter] Run tests (optionally filtered)"
    echo "  lint          Run linting across all packages"
    echo "  format        Format code across all packages"
    echo "  build         Build all packages"
    echo "  clean         Clean all build artifacts"
    echo "  setup         Initial setup (install deps, copy env)"
    echo "  status        Show status of all services"
    echo "  help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./scripts/dev.sh start"
    echo "  ./scripts/dev.sh logs web"
    echo "  ./scripts/dev.sh test terminal"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check prerequisites
check_prerequisites() {
    local missing=()
    
    if ! command_exists node; then
        missing+=("Node.js")
    fi
    
    if ! command_exists pnpm; then
        missing+=("pnpm")
    fi
    
    if ! command_exists python3; then
        missing+=("Python 3")
    fi
    
    if ! command_exists docker; then
        missing+=("Docker")
    fi
    
    if [ ${#missing[@]} -ne 0 ]; then
        echo -e "${RED}Missing prerequisites:${NC} ${missing[*]}"
        echo "Please install them before continuing."
        exit 1
    fi
}

# Function to setup the project
setup_project() {
    echo -e "${BLUE}Setting up Claude Pocket Console...${NC}"
    
    # Check prerequisites
    check_prerequisites
    
    # Install dependencies
    echo -e "${YELLOW}Installing dependencies...${NC}"
    pnpm install
    
    # Copy environment file if it doesn't exist
    if [ ! -f .env.local ]; then
        echo -e "${YELLOW}Creating .env.local from .env.example...${NC}"
        cp .env.example .env.local
        echo -e "${GREEN}✓ Created .env.local${NC}"
        echo -e "${YELLOW}Please update the environment variables in .env.local${NC}"
    fi
    
    # Build packages
    echo -e "${YELLOW}Building packages...${NC}"
    pnpm build:packages
    
    echo -e "${GREEN}✓ Setup complete!${NC}"
}

# Function to start all services
start_all() {
    echo -e "${BLUE}Starting all services...${NC}"
    check_prerequisites
    
    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}Docker daemon is not running. Please start Docker first.${NC}"
        exit 1
    fi
    
    pnpm dev
}

# Function to stop all services
stop_all() {
    echo -e "${YELLOW}Stopping all services...${NC}"
    
    # Kill Node.js processes
    pkill -f "node.*dev" || true
    pkill -f "uvicorn" || true
    
    echo -e "${GREEN}✓ Services stopped${NC}"
}

# Function to restart services
restart_all() {
    stop_all
    sleep 2
    start_all
}

# Function to start individual services
start_service() {
    local service=$1
    
    case $service in
        web)
            echo -e "${BLUE}Starting web app...${NC}"
            pnpm --filter web dev
            ;;
        terminal)
            echo -e "${BLUE}Starting terminal server...${NC}"
            pnpm --filter terminal-server dev
            ;;
        convex)
            echo -e "${BLUE}Starting Convex development...${NC}"
            pnpm convex:dev
            ;;
        *)
            echo -e "${RED}Unknown service: $service${NC}"
            echo "Available services: web, terminal, convex"
            exit 1
            ;;
    esac
}

# Function to show logs
show_logs() {
    local service=$1
    
    if [ -z "$service" ]; then
        echo -e "${RED}Please specify a service${NC}"
        echo "Available services: web, terminal, convex"
        exit 1
    fi
    
    case $service in
        web)
            pnpm --filter web dev
            ;;
        terminal)
            pnpm --filter terminal-server dev
            ;;
        convex)
            pnpm convex:dev
            ;;
        *)
            echo -e "${RED}Unknown service: $service${NC}"
            exit 1
            ;;
    esac
}

# Function to run tests
run_tests() {
    local filter=$1
    
    if [ -n "$filter" ]; then
        echo -e "${BLUE}Running tests for: $filter${NC}"
        pnpm --filter "$filter" test
    else
        echo -e "${BLUE}Running all tests...${NC}"
        pnpm test
    fi
}

# Function to check service status
check_status() {
    echo -e "${BLUE}Service Status:${NC}"
    echo ""
    
    # Check web app
    if curl -s http://localhost:3000 >/dev/null 2>&1; then
        echo -e "Web App (port 3000): ${GREEN}Running${NC}"
    else
        echo -e "Web App (port 3000): ${RED}Not running${NC}"
    fi
    
    # Check terminal server
    if curl -s http://localhost:8000/api/v1/health >/dev/null 2>&1; then
        echo -e "Terminal Server (port 8000): ${GREEN}Running${NC}"
    else
        echo -e "Terminal Server (port 8000): ${RED}Not running${NC}"
    fi
    
    # Check Docker
    if docker info >/dev/null 2>&1; then
        echo -e "Docker: ${GREEN}Running${NC}"
    else
        echo -e "Docker: ${RED}Not running${NC}"
    fi
    
    # Check Node.js processes
    echo ""
    echo -e "${BLUE}Running processes:${NC}"
    ps aux | grep -E "(node|uvicorn)" | grep -v grep || echo "No relevant processes found"
}

# Main command handler
case "$1" in
    start)
        start_all
        ;;
    stop)
        stop_all
        ;;
    restart)
        restart_all
        ;;
    web|terminal|convex)
        start_service "$1"
        ;;
    logs)
        show_logs "$2"
        ;;
    test)
        run_tests "$2"
        ;;
    lint)
        echo -e "${BLUE}Running linters...${NC}"
        pnpm lint
        ;;
    format)
        echo -e "${BLUE}Formatting code...${NC}"
        pnpm format
        ;;
    build)
        echo -e "${BLUE}Building all packages...${NC}"
        pnpm build
        ;;
    clean)
        echo -e "${BLUE}Cleaning build artifacts...${NC}"
        pnpm clean
        ;;
    setup)
        setup_project
        ;;
    status)
        check_status
        ;;
    help|"")
        usage
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo ""
        usage
        exit 1
        ;;
esac