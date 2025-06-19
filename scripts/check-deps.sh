#!/usr/bin/env bash
# check-deps.sh - Dependency checker for Claude Pocket Console
# This script verifies all required dependencies are installed with correct versions

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Required versions
REQUIRED_NODE_VERSION="20"
REQUIRED_PNPM_VERSION="8"
REQUIRED_PYTHON_VERSION="3.12"
REQUIRED_DOCKER_VERSION="20.10"
REQUIRED_GIT_VERSION="2.30"

# Track overall status
ALL_DEPS_OK=true

# Function to display header
show_header() {
    echo -e "${BLUE}Claude Pocket Console Dependency Checker${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to compare versions
version_ge() {
    # Returns 0 if $1 >= $2
    [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Function to extract major version
get_major_version() {
    echo "$1" | cut -d. -f1
}

# Function to check Node.js
check_node() {
    echo -n "Node.js: "
    
    if command_exists node; then
        NODE_VERSION=$(node --version | sed 's/v//')
        NODE_MAJOR=$(get_major_version "$NODE_VERSION")
        
        if [ "$NODE_MAJOR" -ge "$REQUIRED_NODE_VERSION" ]; then
            echo -e "${GREEN}✓ v$NODE_VERSION${NC}"
        else
            echo -e "${RED}✗ v$NODE_VERSION (need v$REQUIRED_NODE_VERSION or higher)${NC}"
            ALL_DEPS_OK=false
        fi
    else
        echo -e "${RED}✗ Not installed${NC}"
        echo "  Install: nvm install $REQUIRED_NODE_VERSION or download from https://nodejs.org"
        ALL_DEPS_OK=false
    fi
}

# Function to check pnpm
check_pnpm() {
    echo -n "pnpm: "
    
    if command_exists pnpm; then
        PNPM_VERSION=$(pnpm --version)
        PNPM_MAJOR=$(get_major_version "$PNPM_VERSION")
        
        if [ "$PNPM_MAJOR" -ge "$REQUIRED_PNPM_VERSION" ]; then
            echo -e "${GREEN}✓ v$PNPM_VERSION${NC}"
        else
            echo -e "${RED}✗ v$PNPM_VERSION (need v$REQUIRED_PNPM_VERSION or higher)${NC}"
            ALL_DEPS_OK=false
        fi
    else
        echo -e "${RED}✗ Not installed${NC}"
        echo "  Install: corepack enable && corepack prepare pnpm@latest --activate"
        ALL_DEPS_OK=false
    fi
}

# Function to check Python
check_python() {
    echo -n "Python: "
    
    if command_exists python3; then
        PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
        PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f1,2)
        
        if version_ge "$PYTHON_MINOR" "$REQUIRED_PYTHON_VERSION"; then
            echo -e "${GREEN}✓ v$PYTHON_VERSION${NC}"
        else
            echo -e "${RED}✗ v$PYTHON_VERSION (need v$REQUIRED_PYTHON_VERSION or higher)${NC}"
            ALL_DEPS_OK=false
        fi
    else
        echo -e "${RED}✗ Not installed${NC}"
        echo "  Install: pyenv install $REQUIRED_PYTHON_VERSION or use system package manager"
        ALL_DEPS_OK=false
    fi
}

# Function to check uv
check_uv() {
    echo -n "uv (Python package manager): "
    
    if command_exists uv; then
        UV_VERSION=$(uv --version 2>&1 | awk '{print $2}')
        echo -e "${GREEN}✓ v$UV_VERSION${NC}"
    else
        echo -e "${RED}✗ Not installed${NC}"
        echo "  Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
        ALL_DEPS_OK=false
    fi
}

# Function to check Docker
check_docker() {
    echo -n "Docker: "
    
    if command_exists docker; then
        DOCKER_VERSION=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        DOCKER_MINOR=$(echo "$DOCKER_VERSION" | cut -d. -f1,2)
        
        if version_ge "$DOCKER_MINOR" "$REQUIRED_DOCKER_VERSION"; then
            echo -e "${GREEN}✓ v$DOCKER_VERSION${NC}"
            
            # Check if Docker daemon is running
            if docker info >/dev/null 2>&1; then
                echo -e "  ${GREEN}✓ Docker daemon is running${NC}"
            else
                echo -e "  ${YELLOW}⚠ Docker daemon is not running${NC}"
                echo "    Start Docker Desktop or run: sudo systemctl start docker"
            fi
        else
            echo -e "${RED}✗ v$DOCKER_VERSION (need v$REQUIRED_DOCKER_VERSION or higher)${NC}"
            ALL_DEPS_OK=false
        fi
    else
        echo -e "${RED}✗ Not installed${NC}"
        echo "  Install: https://www.docker.com/products/docker-desktop"
        ALL_DEPS_OK=false
    fi
}

# Function to check Git
check_git() {
    echo -n "Git: "
    
    if command_exists git; then
        GIT_VERSION=$(git --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
        GIT_MINOR=$(echo "$GIT_VERSION" | cut -d. -f1,2)
        
        if version_ge "$GIT_MINOR" "$REQUIRED_GIT_VERSION"; then
            echo -e "${GREEN}✓ v$GIT_VERSION${NC}"
        else
            echo -e "${RED}✗ v$GIT_VERSION (need v$REQUIRED_GIT_VERSION or higher)${NC}"
            ALL_DEPS_OK=false
        fi
    else
        echo -e "${RED}✗ Not installed${NC}"
        echo "  Install: Use your system package manager"
        ALL_DEPS_OK=false
    fi
}

# Function to check optional tools
check_optional() {
    echo ""
    echo -e "${BLUE}Optional Tools:${NC}"
    
    # Check for wscat (WebSocket testing)
    echo -n "wscat: "
    if command_exists wscat; then
        echo -e "${GREEN}✓ Installed${NC}"
    else
        echo -e "${YELLOW}○ Not installed (optional)${NC}"
        echo "  Install: npm install -g wscat"
    fi
    
    # Check for gh (GitHub CLI)
    echo -n "GitHub CLI: "
    if command_exists gh; then
        GH_VERSION=$(gh --version | head -1 | awk '{print $3}')
        echo -e "${GREEN}✓ v$GH_VERSION${NC}"
    else
        echo -e "${YELLOW}○ Not installed (optional)${NC}"
        echo "  Install: https://cli.github.com"
    fi
    
    # Check for convex CLI
    echo -n "Convex CLI: "
    if [ -f "node_modules/.bin/convex" ]; then
        echo -e "${GREEN}✓ Available (via pnpm)${NC}"
    else
        echo -e "${YELLOW}○ Not installed yet${NC}"
        echo "  Will be installed with: pnpm install"
    fi
}

# Function to check environment files
check_env() {
    echo ""
    echo -e "${BLUE}Environment Configuration:${NC}"
    
    # Check .env.example
    echo -n ".env.example: "
    if [ -f ".env.example" ]; then
        echo -e "${GREEN}✓ Found${NC}"
    else
        echo -e "${RED}✗ Missing${NC}"
        ALL_DEPS_OK=false
    fi
    
    # Check .env.local
    echo -n ".env.local: "
    if [ -f ".env.local" ]; then
        echo -e "${GREEN}✓ Found${NC}"
        
        # Check for required variables
        echo -e "${BLUE}  Checking required variables:${NC}"
        
        # List of required variables from DEVELOPMENT.md
        REQUIRED_VARS=(
            "CONVEX_DEPLOY_KEY"
            "GITHUB_CLIENT_ID"
            "GITHUB_CLIENT_SECRET"
            "NEXT_PUBLIC_CONVEX_URL"
        )
        
        for var in "${REQUIRED_VARS[@]}"; do
            echo -n "    $var: "
            if grep -q "^${var}=" .env.local && ! grep -q "^${var}=$" .env.local; then
                echo -e "${GREEN}✓ Set${NC}"
            else
                echo -e "${YELLOW}⚠ Not set or empty${NC}"
            fi
        done
    else
        echo -e "${YELLOW}○ Not found${NC}"
        echo "  Create with: cp .env.example .env.local"
    fi
}

# Function to check project structure
check_structure() {
    echo ""
    echo -e "${BLUE}Project Structure:${NC}"
    
    # Check for required directories
    REQUIRED_DIRS=(
        "apps/web"
        "apps/terminal-server"
        "packages"
        "infrastructure/convex"
        "infrastructure/docker"
        "scripts"
    )
    
    for dir in "${REQUIRED_DIRS[@]}"; do
        echo -n "$dir: "
        if [ -d "$dir" ]; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${RED}✗ Missing${NC}"
            ALL_DEPS_OK=false
        fi
    done
}

# Function to provide summary
show_summary() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    
    if [ "$ALL_DEPS_OK" = true ]; then
        echo -e "${GREEN}✓ All required dependencies are installed!${NC}"
        echo ""
        echo "Next steps:"
        echo "1. Run: pnpm install"
        echo "2. Copy .env.example to .env.local and fill in values"
        echo "3. Run: ./scripts/dev.sh start"
    else
        echo -e "${RED}✗ Some dependencies are missing or outdated.${NC}"
        echo ""
        echo "Please install the missing dependencies listed above."
    fi
}

# Main execution
main() {
    show_header
    
    echo -e "${BLUE}Required Dependencies:${NC}"
    check_node
    check_pnpm
    check_python
    check_uv
    check_docker
    check_git
    
    check_optional
    check_env
    check_structure
    
    show_summary
}

# Run main function
main