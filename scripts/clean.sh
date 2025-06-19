#!/usr/bin/env bash
# clean.sh - Cleanup script for Claude Pocket Console
# This script removes build artifacts, caches, and temporary files

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display usage
usage() {
    echo -e "${BLUE}Claude Pocket Console Cleanup Script${NC}"
    echo ""
    echo "Usage: ./scripts/clean.sh [option]"
    echo ""
    echo "Options:"
    echo "  all           Clean everything (default)"
    echo "  node          Clean Node.js artifacts"
    echo "  python        Clean Python artifacts"
    echo "  docker        Clean Docker artifacts"
    echo "  build         Clean build outputs only"
    echo "  cache         Clean caches only"
    echo "  help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./scripts/clean.sh"
    echo "  ./scripts/clean.sh node"
    echo "  ./scripts/clean.sh docker"
}

# Function to clean Node.js artifacts
clean_node() {
    echo -e "${YELLOW}Cleaning Node.js artifacts...${NC}"
    
    # Remove node_modules
    find . -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    echo -e "${GREEN}✓ Removed node_modules directories${NC}"
    
    # Remove build directories
    find . -name "dist" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    find . -name ".next" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    find . -name "out" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    echo -e "${GREEN}✓ Removed build directories${NC}"
    
    # Remove TypeScript build info
    find . -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true
    echo -e "${GREEN}✓ Removed TypeScript build info${NC}"
    
    # Remove Turbo cache
    rm -rf .turbo
    echo -e "${GREEN}✓ Removed Turbo cache${NC}"
    
    # Remove pnpm store (optional, commented out by default)
    # pnpm store prune
    # echo -e "${GREEN}✓ Pruned pnpm store${NC}"
}

# Function to clean Python artifacts
clean_python() {
    echo -e "${YELLOW}Cleaning Python artifacts...${NC}"
    
    # Remove Python cache directories
    find . -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    find . -name ".pytest_cache" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    find . -name ".mypy_cache" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    find . -name ".ruff_cache" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    echo -e "${GREEN}✓ Removed Python cache directories${NC}"
    
    # Remove compiled Python files
    find . -name "*.pyc" -type f -delete 2>/dev/null || true
    find . -name "*.pyo" -type f -delete 2>/dev/null || true
    find . -name "*.pyd" -type f -delete 2>/dev/null || true
    echo -e "${GREEN}✓ Removed compiled Python files${NC}"
    
    # Remove egg-info directories
    find . -name "*.egg-info" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    echo -e "${GREEN}✓ Removed egg-info directories${NC}"
    
    # Remove coverage data
    find . -name ".coverage" -type f -delete 2>/dev/null || true
    find . -name "coverage.xml" -type f -delete 2>/dev/null || true
    find . -name "htmlcov" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    echo -e "${GREEN}✓ Removed coverage data${NC}"
}

# Function to clean Docker artifacts
clean_docker() {
    echo -e "${YELLOW}Cleaning Docker artifacts...${NC}"
    
    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        echo -e "${YELLOW}Docker is not running. Skipping Docker cleanup.${NC}"
        return
    fi
    
    # Stop and remove containers with cpc prefix
    echo "Stopping CPC containers..."
    docker ps -a --filter "name=cpc" --format "{{.ID}}" | xargs -r docker stop 2>/dev/null || true
    docker ps -a --filter "name=cpc" --format "{{.ID}}" | xargs -r docker rm 2>/dev/null || true
    echo -e "${GREEN}✓ Removed CPC containers${NC}"
    
    # Remove dangling images
    docker image prune -f >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ Removed dangling images${NC}"
    
    # Remove CPC volumes (be careful!)
    read -p "Remove CPC Docker volumes? This will delete container data! (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker volume ls --filter "name=cpc" --format "{{.Name}}" | xargs -r docker volume rm 2>/dev/null || true
        echo -e "${GREEN}✓ Removed CPC volumes${NC}"
    fi
}

# Function to clean build outputs only
clean_build() {
    echo -e "${YELLOW}Cleaning build outputs...${NC}"
    
    # Next.js build
    rm -rf apps/web/.next
    rm -rf apps/web/out
    echo -e "${GREEN}✓ Removed Next.js build${NC}"
    
    # Package builds
    find packages -name "dist" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    echo -e "${GREEN}✓ Removed package builds${NC}"
    
    # TypeScript build info
    find . -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true
    echo -e "${GREEN}✓ Removed TypeScript build info${NC}"
}

# Function to clean caches only
clean_cache() {
    echo -e "${YELLOW}Cleaning caches...${NC}"
    
    # Turbo cache
    rm -rf .turbo
    echo -e "${GREEN}✓ Removed Turbo cache${NC}"
    
    # Next.js cache
    rm -rf apps/web/.next/cache
    echo -e "${GREEN}✓ Removed Next.js cache${NC}"
    
    # ESLint cache
    find . -name ".eslintcache" -type f -delete 2>/dev/null || true
    echo -e "${GREEN}✓ Removed ESLint cache${NC}"
    
    # Jest cache
    find . -name "jest_cache" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    echo -e "${GREEN}✓ Removed Jest cache${NC}"
}

# Function to clean everything
clean_all() {
    echo -e "${BLUE}Running full cleanup...${NC}"
    echo ""
    
    clean_node
    echo ""
    clean_python
    echo ""
    clean_docker
    echo ""
    
    # Additional cleanup
    echo -e "${YELLOW}Additional cleanup...${NC}"
    
    # Remove log files
    find . -name "*.log" -type f -delete 2>/dev/null || true
    echo -e "${GREEN}✓ Removed log files${NC}"
    
    # Remove temporary files
    find . -name ".DS_Store" -type f -delete 2>/dev/null || true
    find . -name "Thumbs.db" -type f -delete 2>/dev/null || true
    find . -name "*~" -type f -delete 2>/dev/null || true
    echo -e "${GREEN}✓ Removed temporary files${NC}"
    
    echo ""
    echo -e "${GREEN}✓ Cleanup complete!${NC}"
    echo -e "${YELLOW}Run 'pnpm install' to reinstall dependencies.${NC}"
}

# Confirmation prompt for destructive operations
confirm_cleanup() {
    echo -e "${YELLOW}This will remove build artifacts and caches.${NC}"
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cleanup cancelled."
        exit 0
    fi
}

# Main command handler
case "$1" in
    all|"")
        confirm_cleanup
        clean_all
        ;;
    node)
        confirm_cleanup
        clean_node
        ;;
    python)
        confirm_cleanup
        clean_python
        ;;
    docker)
        clean_docker
        ;;
    build)
        confirm_cleanup
        clean_build
        ;;
    cache)
        confirm_cleanup
        clean_cache
        ;;
    help)
        usage
        ;;
    *)
        echo -e "${RED}Unknown option: $1${NC}"
        echo ""
        usage
        exit 1
        ;;
esac