#!/bin/bash

# setup-workspace.sh - Automate creation of git worktree workspaces for AI agents
# 
# Usage: ./setup-workspace.sh <agent-name> <branch-name> [issue-number]
#
# Example: ./setup-workspace.sh agent-alpha feat/123-websocket-feature 123
#
# This script creates isolated workspaces for AI agents with:
# - Git worktree for the specified branch
# - Port range allocation
# - Docker container prefix assignment
# - Environment configuration
# - Dependency installation

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKSPACE_ROOT="agent-workspaces"
CONFIG_DIR=".agent-config"
REPO_OWNER="claudes-world"
REPO_NAME="claude-pocket-console"

# Port allocation mapping
declare -A PORT_RANGES=(
    ["agent-alpha"]="3100-3199"
    ["agent-beta"]="3200-3299"
    ["agent-gamma"]="3300-3399"
    ["agent-delta"]="3400-3499"
    ["agent-epsilon"]="3500-3599"
    ["agent-zeta"]="3600-3699"
    ["agent-eta"]="3700-3799"
    ["agent-theta"]="3800-3899"
    ["agent-iota"]="3900-3999"
    ["agent-kappa"]="4000-4099"
)

# Docker container prefix mapping
declare -A DOCKER_PREFIXES=(
    ["agent-alpha"]="alpha"
    ["agent-beta"]="beta"
    ["agent-gamma"]="gamma"
    ["agent-delta"]="delta"
    ["agent-epsilon"]="epsilon"
    ["agent-zeta"]="zeta"
    ["agent-eta"]="eta"
    ["agent-theta"]="theta"
    ["agent-iota"]="iota"
    ["agent-kappa"]="kappa"
)

# Function to print colored output
print_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Function to validate agent name
validate_agent_name() {
    local agent_name="$1"
    
    if [[ ! "$agent_name" =~ ^agent-[a-z]+$ ]]; then
        print_error "Invalid agent name format. Must be 'agent-{name}' (e.g., agent-alpha)"
        return 1
    fi
    
    if [[ -z "${PORT_RANGES[$agent_name]:-}" ]]; then
        print_error "Unknown agent name: $agent_name"
        print_info "Valid agent names: ${!PORT_RANGES[*]}"
        return 1
    fi
    
    return 0
}

# Function to validate branch name
validate_branch_name() {
    local branch_name="$1"
    
    if [[ -z "$branch_name" ]]; then
        print_error "Branch name cannot be empty"
        return 1
    fi
    
    # Check if branch name follows conventional format
    if [[ ! "$branch_name" =~ ^(feat|fix|docs|style|refactor|test|chore|perf)/.+ ]]; then
        print_warning "Branch name doesn't follow conventional format (feat|fix|docs|etc.)/description"
    fi
    
    return 0
}

# Function to check if workspace already exists
check_workspace_exists() {
    local workspace_path="$1"
    
    if [[ -d "$workspace_path" ]]; then
        print_error "Workspace already exists at: $workspace_path"
        print_info "To remove it, run: rm -rf $workspace_path"
        return 1
    fi
    
    return 0
}

# Function to check port availability
check_port_available() {
    local port="$1"
    
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 1
    fi
    
    return 0
}

# Function to validate port range availability
validate_port_range() {
    local agent_name="$1"
    local port_range="${PORT_RANGES[$agent_name]}"
    local start_port="${port_range%-*}"
    local end_port="${port_range#*-}"
    
    print_info "Checking port range availability: $port_range"
    
    local ports_in_use=()
    for ((port=start_port; port<=start_port+10; port++)); do
        if ! check_port_available "$port"; then
            ports_in_use+=("$port")
        fi
    done
    
    if [[ ${#ports_in_use[@]} -gt 0 ]]; then
        print_warning "Some ports in range are already in use: ${ports_in_use[*]}"
        print_info "This may not be an issue if they're from other services"
    fi
    
    return 0
}

# Function to create git worktree
create_git_worktree() {
    local workspace_path="$1"
    local branch_name="$2"
    
    print_info "Creating git worktree for branch: $branch_name"
    
    # Check if we're in a git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        print_error "Not in a git repository"
        return 1
    fi
    
    # Check if branch exists locally or remotely
    if git show-ref --verify --quiet "refs/heads/$branch_name"; then
        print_info "Using existing local branch: $branch_name"
    elif git ls-remote --heads origin "$branch_name" | grep -q "$branch_name"; then
        print_info "Branch exists on remote, will checkout"
    else
        print_info "Creating new branch: $branch_name"
        # Create branch from current HEAD
        git branch "$branch_name" 2>/dev/null || true
    fi
    
    # Create worktree
    if ! git worktree add "$workspace_path" "$branch_name" 2>/dev/null; then
        # If branch doesn't exist remotely, create from HEAD
        git worktree add -b "$branch_name" "$workspace_path" HEAD
    fi
    
    return 0
}

# Function to setup environment file
setup_env_file() {
    local workspace_path="$1"
    local agent_name="$2"
    local port_range="${PORT_RANGES[$agent_name]}"
    local start_port="${port_range%-*}"
    local docker_prefix="${DOCKER_PREFIXES[$agent_name]}"
    
    print_info "Setting up .env.local file"
    
    cat > "$workspace_path/.env.local" << EOF
# Agent-specific environment variables
# Generated by setup-workspace.sh for $agent_name

# Port allocation
NEXT_PUBLIC_PORT=$start_port
PORT=$start_port
API_PORT=$((start_port + 1))
WEBSOCKET_PORT=$((start_port + 2))

# Docker configuration
DOCKER_CONTAINER_PREFIX=$docker_prefix
DOCKER_NETWORK_NAME=${docker_prefix}_network

# Agent identification
AGENT_NAME=$agent_name
AGENT_WORKSPACE=$workspace_path

# Development settings
NODE_ENV=development
NEXT_TELEMETRY_DISABLED=1
EOF
    
    return 0
}

# Function to create agent config
create_agent_config() {
    local workspace_path="$1"
    local agent_name="$2"
    local branch_name="$3"
    local issue_number="${4:-}"
    local port_range="${PORT_RANGES[$agent_name]}"
    local docker_prefix="${DOCKER_PREFIXES[$agent_name]}"
    
    print_info "Creating agent configuration"
    
    mkdir -p "$workspace_path/$CONFIG_DIR"
    
    # Create config JSON
    cat > "$workspace_path/$CONFIG_DIR/agent.json" << EOF
{
  "agent": {
    "name": "$agent_name",
    "created": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "workspace": "$workspace_path"
  },
  "git": {
    "branch": "$branch_name",
    "issue": ${issue_number:-null}
  },
  "ports": {
    "range": "$port_range",
    "web": ${port_range%-*},
    "api": $((${port_range%-*} + 1)),
    "websocket": $((${port_range%-*} + 2))
  },
  "docker": {
    "prefix": "$docker_prefix",
    "network": "${docker_prefix}_network"
  }
}
EOF
    
    return 0
}

# Function to install dependencies
install_dependencies() {
    local workspace_path="$1"
    
    print_info "Installing dependencies with pnpm"
    
    cd "$workspace_path"
    
    # Check if pnpm is installed
    if ! command -v pnpm &> /dev/null; then
        print_error "pnpm is not installed. Please install it first: npm install -g pnpm"
        return 1
    fi
    
    # Install dependencies
    if ! pnpm install --frozen-lockfile; then
        print_warning "Failed to install with frozen lockfile, trying without"
        pnpm install
    fi
    
    return 0
}

# Function to assign GitHub issue
assign_github_issue() {
    local issue_number="$1"
    local agent_name="$2"
    
    print_info "Attempting to assign issue #$issue_number to $agent_name"
    
    # Check if gh CLI is installed
    if ! command -v gh &> /dev/null; then
        print_warning "GitHub CLI (gh) not installed. Skipping issue assignment"
        return 0
    fi
    
    # Note: Since agents can't be assigned directly, we'll add a comment
    if gh issue comment "$issue_number" \
        --repo "$REPO_OWNER/$REPO_NAME" \
        --body "🤖 **$agent_name** has started working on this issue in workspace: \`$WORKSPACE_ROOT/$agent_name\`" \
        2>/dev/null; then
        print_success "Added comment to issue #$issue_number"
    else
        print_warning "Could not add comment to issue #$issue_number"
    fi
    
    return 0
}

# Function to cleanup on failure
cleanup_on_failure() {
    local workspace_path="$1"
    local branch_name="$2"
    
    print_warning "Cleaning up after failure..."
    
    # Remove worktree if it exists
    if git worktree list | grep -q "$workspace_path"; then
        git worktree remove --force "$workspace_path" 2>/dev/null || true
    fi
    
    # Remove directory if it still exists
    if [[ -d "$workspace_path" ]]; then
        rm -rf "$workspace_path"
    fi
    
    # Note: We don't delete the branch as it might have been intentionally created
}

# Function to print success message
print_success_message() {
    local agent_name="$1"
    local workspace_path="$2"
    local branch_name="$3"
    local port_range="${PORT_RANGES[$agent_name]}"
    local start_port="${port_range%-*}"
    
    echo ""
    print_success "Workspace successfully created!"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Agent Workspace Details"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  Agent Name:     $agent_name"
    echo "  Workspace:      $workspace_path"
    echo "  Branch:         $branch_name"
    echo "  Port Range:     $port_range"
    echo "  Web URL:        http://localhost:$start_port"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "To start working:"
    echo ""
    echo "  1. Navigate to workspace:"
    echo "     cd $workspace_path"
    echo ""
    echo "  2. Start development servers:"
    echo "     pnpm dev"
    echo ""
    echo "  3. Open in your editor:"
    echo "     code $workspace_path"
    echo ""
    echo "Happy coding! 🚀"
    echo ""
}

# Main function
main() {
    # Check arguments
    if [[ $# -lt 2 ]]; then
        print_error "Usage: $0 <agent-name> <branch-name> [issue-number]"
        echo ""
        echo "Examples:"
        echo "  $0 agent-alpha feat/123-websocket-feature"
        echo "  $0 agent-beta fix/456-auth-bug 456"
        echo ""
        echo "Available agents: ${!PORT_RANGES[*]}"
        exit 1
    fi
    
    local agent_name="$1"
    local branch_name="$2"
    local issue_number="${3:-}"
    
    # Validate inputs
    validate_agent_name "$agent_name" || exit 1
    validate_branch_name "$branch_name" || exit 1
    
    # Set workspace path
    local workspace_path="$WORKSPACE_ROOT/$agent_name"
    
    # Check if workspace already exists
    check_workspace_exists "$workspace_path" || exit 1
    
    # Validate port range availability
    validate_port_range "$agent_name" || exit 1
    
    # Create workspace directory
    print_info "Creating workspace directory: $workspace_path"
    mkdir -p "$WORKSPACE_ROOT"
    
    # Setup trap for cleanup on failure
    trap "cleanup_on_failure '$workspace_path' '$branch_name'" ERR
    
    # Create git worktree
    create_git_worktree "$workspace_path" "$branch_name" || exit 1
    
    # Setup environment file
    setup_env_file "$workspace_path" "$agent_name" || exit 1
    
    # Create agent configuration
    create_agent_config "$workspace_path" "$agent_name" "$branch_name" "$issue_number" || exit 1
    
    # Install dependencies
    install_dependencies "$workspace_path" || exit 1
    
    # Assign GitHub issue if provided
    if [[ -n "$issue_number" ]]; then
        assign_github_issue "$issue_number" "$agent_name"
    fi
    
    # Clear trap
    trap - ERR
    
    # Print success message
    print_success_message "$agent_name" "$workspace_path" "$branch_name"
    
    return 0
}

# Run main function
main "$@"