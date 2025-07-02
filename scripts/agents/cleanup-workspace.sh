#!/bin/bash

# Agent Workspace Cleanup Script
# Safely removes agent workspaces and cleans up all associated resources

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACES_DIR="$PROJECT_ROOT/agent-workspaces"
CONFIG_FILE="$PROJECT_ROOT/.claude/agent-config.json"
PORT_TRACKING_FILE="$PROJECT_ROOT/.claude/agent-ports.json"
LOG_FILE="$PROJECT_ROOT/logs/cleanup-$(date +%Y%m%d-%H%M%S).log"

# Default values
FORCE=false
PRESERVE_BRANCH=false
AGENT_NAME=""
DRY_RUN=false

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Logging functions
log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

log_info() {
    log "${BLUE}[INFO]${NC} $1"
}

log_success() {
    log "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    log "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    log "${RED}[ERROR]${NC} $1"
}

# Usage function
usage() {
    cat << EOF
Usage: $0 <agent-name> [options]

Remove an agent workspace and clean up all associated resources.

Arguments:
    agent-name          Name of the agent (e.g., agent-alpha)

Options:
    --force             Skip confirmation prompts
    --preserve-branch   Keep the git branch after removing worktree
    --dry-run          Show what would be cleaned up without doing it
    -h, --help         Show this help message

Examples:
    $0 agent-alpha
    $0 agent-beta --force
    $0 agent-gamma --preserve-branch --force
    $0 agent-delta --dry-run

EOF
    exit 1
}

# Parse command line arguments
parse_args() {
    if [ $# -eq 0 ]; then
        usage
    fi

    # Check for help flag first
    if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
        usage
    fi

    AGENT_NAME="$1"
    shift

    while [ $# -gt 0 ]; do
        case "$1" in
            --force)
                FORCE=true
                shift
                ;;
            --preserve-branch)
                PRESERVE_BRANCH=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                ;;
        esac
    done
}

# Validate agent name format
validate_agent_name() {
    if [[ ! "$AGENT_NAME" =~ ^agent-[a-zA-Z0-9-]+$ ]]; then
        log_error "Invalid agent name format. Expected: agent-<name>"
        exit 1
    fi
}

# Check if workspace exists
check_workspace_exists() {
    local workspace_path="$WORKSPACES_DIR/$AGENT_NAME"
    
    if [ ! -d "$workspace_path" ]; then
        log_warning "Workspace directory does not exist: $workspace_path"
        return 1
    fi
    
    return 0
}

# Check for uncommitted changes
check_uncommitted_changes() {
    local workspace_path="$WORKSPACES_DIR/$AGENT_NAME"
    
    if [ ! -d "$workspace_path/.git" ]; then
        return 0
    fi
    
    cd "$workspace_path" 2>/dev/null || return 0
    
    if ! git diff --quiet || ! git diff --cached --quiet; then
        log_warning "Uncommitted changes detected in workspace!"
        
        if [ "$FORCE" = false ]; then
            read -p "Continue anyway? (y/N) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Cleanup cancelled by user"
                exit 0
            fi
        fi
    fi
    
    cd - >/dev/null
}

# Get agent configuration
get_agent_config() {
    local port_start=""
    local port_end=""
    local branch_name=""
    
    if [ -f "$CONFIG_FILE" ]; then
        # Extract port range from config
        port_start=$(jq -r ".agents[\"$AGENT_NAME\"].portRange.start // empty" "$CONFIG_FILE" 2>/dev/null || echo "")
        port_end=$(jq -r ".agents[\"$AGENT_NAME\"].portRange.end // empty" "$CONFIG_FILE" 2>/dev/null || echo "")
        branch_name=$(jq -r ".agents[\"$AGENT_NAME\"].branch // empty" "$CONFIG_FILE" 2>/dev/null || echo "")
    fi
    
    echo "$port_start|$port_end|$branch_name"
}

# List resources to be cleaned up
list_resources() {
    log_info "Resources to be cleaned up for agent: $AGENT_NAME"
    echo
    
    # Workspace directory
    local workspace_path="$WORKSPACES_DIR/$AGENT_NAME"
    if [ -d "$workspace_path" ]; then
        log "  ${YELLOW}•${NC} Workspace directory: $workspace_path"
    fi
    
    # Docker containers
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        local containers=$(docker ps -a --filter "name=${AGENT_NAME}-" --format "{{.Names}}" 2>/dev/null | grep -v "^$" || echo "")
        if [ -n "$containers" ]; then
            log "  ${YELLOW}•${NC} Docker containers:"
            while IFS= read -r container; do
                if [ -n "$container" ]; then
                    log "      - $container"
                fi
            done <<< "$containers"
        fi
    fi
    
    # Port range
    local config_info=$(get_agent_config)
    IFS='|' read -r port_start port_end branch_name <<< "$config_info"
    
    if [ -n "$port_start" ] && [ -n "$port_end" ]; then
        log "  ${YELLOW}•${NC} Port range: $port_start-$port_end"
        
        # Check for processes on ports
        for port in $(seq "$port_start" "$port_end"); do
            if lsof -i :"$port" >/dev/null 2>&1; then
                log "      - Process on port $port"
            fi
        done
    fi
    
    # Git branch
    if [ -n "$branch_name" ] && [ "$PRESERVE_BRANCH" = false ]; then
        if git branch -a | grep -q "$branch_name"; then
            log "  ${YELLOW}•${NC} Git branch: $branch_name"
        fi
    fi
    
    # Configuration entries
    if [ -f "$CONFIG_FILE" ] && jq -e ".agents[\"$AGENT_NAME\"]" "$CONFIG_FILE" >/dev/null 2>&1; then
        log "  ${YELLOW}•${NC} Configuration entry in agent-config.json"
    fi
    
    if [ -f "$PORT_TRACKING_FILE" ] && jq -e ".allocations[\"$AGENT_NAME\"]" "$PORT_TRACKING_FILE" >/dev/null 2>&1; then
        log "  ${YELLOW}•${NC} Port allocation in agent-ports.json"
    fi
    
    echo
}

# Confirm cleanup
confirm_cleanup() {
    if [ "$FORCE" = true ] || [ "$DRY_RUN" = true ]; then
        return 0
    fi
    
    read -p "Are you sure you want to clean up all these resources? (y/N) " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cleanup cancelled by user"
        exit 0
    fi
}

# Stop Docker containers
stop_docker_containers() {
    log_info "Stopping and removing Docker containers..."
    
    # Check if Docker is available and running
    if ! command -v docker >/dev/null 2>&1; then
        log_info "Docker not available, skipping container cleanup"
        return 0
    fi
    
    if ! docker info >/dev/null 2>&1; then
        log_info "Docker not running, skipping container cleanup"
        return 0
    fi
    
    local containers=$(docker ps -a --filter "name=${AGENT_NAME}-" --format "{{.Names}}" 2>/dev/null | grep -v "^$" || echo "")
    
    if [ -z "$containers" ]; then
        log_info "No Docker containers found for agent"
        return 0
    fi
    
    while IFS= read -r container; do
        if [ -n "$container" ]; then
            if [ "$DRY_RUN" = true ]; then
                log "  Would remove container: $container"
            else
                log "  Stopping container: $container"
                docker stop "$container" >/dev/null 2>&1 || log_warning "Failed to stop container: $container"
                
                log "  Removing container: $container"
                docker rm "$container" >/dev/null 2>&1 || log_warning "Failed to remove container: $container"
            fi
        fi
    done <<< "$containers"
}

# Kill processes on agent ports
kill_port_processes() {
    log_info "Checking for processes on agent ports..."
    
    local config_info=$(get_agent_config)
    IFS='|' read -r port_start port_end branch_name <<< "$config_info"
    
    if [ -z "$port_start" ] || [ -z "$port_end" ]; then
        log_info "No port range found for agent"
        return 0
    fi
    
    local killed_any=false
    
    for port in $(seq "$port_start" "$port_end"); do
        local pid=$(lsof -t -i:"$port" 2>/dev/null || echo "")
        
        if [ -n "$pid" ]; then
            if [ "$DRY_RUN" = true ]; then
                log "  Would kill process $pid on port $port"
            else
                log "  Killing process $pid on port $port"
                kill -TERM "$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || log_warning "Failed to kill process $pid"
                killed_any=true
            fi
        fi
    done
    
    if [ "$killed_any" = true ]; then
        # Give processes time to clean up
        sleep 2
    fi
}

# Remove git worktree
remove_git_worktree() {
    log_info "Removing git worktree..."
    
    local workspace_path="$WORKSPACES_DIR/$AGENT_NAME"
    
    if [ ! -d "$workspace_path" ]; then
        log_info "Workspace directory not found, skipping worktree removal"
        return 0
    fi
    
    if [ "$DRY_RUN" = true ]; then
        log "  Would remove worktree at: $workspace_path"
    else
        # Remove the worktree
        cd "$PROJECT_ROOT"
        
        if git worktree list | grep -q "$workspace_path"; then
            log "  Removing worktree: $workspace_path"
            git worktree remove "$workspace_path" --force 2>/dev/null || {
                log_warning "Failed to remove worktree cleanly, trying alternative method"
                git worktree prune
                rm -rf "$workspace_path"
            }
        else
            log_warning "Worktree not found in git, removing directory"
            rm -rf "$workspace_path"
        fi
    fi
}

# Remove git branch
remove_git_branch() {
    if [ "$PRESERVE_BRANCH" = true ]; then
        log_info "Preserving git branch as requested"
        return 0
    fi
    
    local config_info=$(get_agent_config)
    IFS='|' read -r port_start port_end branch_name <<< "$config_info"
    
    if [ -z "$branch_name" ]; then
        log_info "No branch name found in configuration"
        return 0
    fi
    
    log_info "Removing git branch..."
    
    cd "$PROJECT_ROOT"
    
    # Check if branch exists
    if ! git branch -a | grep -q "$branch_name"; then
        log_info "Branch $branch_name not found"
        return 0
    fi
    
    if [ "$DRY_RUN" = true ]; then
        log "  Would delete branch: $branch_name"
    else
        # Check if it's the current branch
        current_branch=$(git branch --show-current)
        if [ "$current_branch" = "$branch_name" ]; then
            log_warning "Cannot delete current branch, switching to main"
            git checkout main
        fi
        
        log "  Deleting branch: $branch_name"
        git branch -D "$branch_name" 2>/dev/null || log_warning "Failed to delete branch: $branch_name"
    fi
}

# Update configuration files
update_config_files() {
    log_info "Updating configuration files..."
    
    # Update agent-config.json
    if [ -f "$CONFIG_FILE" ] && jq -e ".agents[\"$AGENT_NAME\"]" "$CONFIG_FILE" >/dev/null 2>&1; then
        if [ "$DRY_RUN" = true ]; then
            log "  Would remove agent from agent-config.json"
        else
            log "  Removing agent from agent-config.json"
            local temp_file=$(mktemp)
            jq "del(.agents[\"$AGENT_NAME\"])" "$CONFIG_FILE" > "$temp_file" && mv "$temp_file" "$CONFIG_FILE"
        fi
    fi
    
    # Update agent-ports.json
    if [ -f "$PORT_TRACKING_FILE" ] && jq -e ".allocations[\"$AGENT_NAME\"]" "$PORT_TRACKING_FILE" >/dev/null 2>&1; then
        if [ "$DRY_RUN" = true ]; then
            log "  Would remove port allocation from agent-ports.json"
        else
            log "  Removing port allocation from agent-ports.json"
            local temp_file=$(mktemp)
            jq "del(.allocations[\"$AGENT_NAME\"])" "$PORT_TRACKING_FILE" > "$temp_file" && mv "$temp_file" "$PORT_TRACKING_FILE"
        fi
    fi
}

# Clean up temporary files
cleanup_temp_files() {
    log_info "Cleaning up temporary files..."
    
    # Clean up any agent-specific temp files
    local temp_patterns=(
        "/tmp/${AGENT_NAME}-*"
        "/var/tmp/${AGENT_NAME}-*"
        "$PROJECT_ROOT/logs/${AGENT_NAME}-*"
    )
    
    for pattern in "${temp_patterns[@]}"; do
        local files=$(ls $pattern 2>/dev/null || echo "")
        if [ -n "$files" ]; then
            if [ "$DRY_RUN" = true ]; then
                log "  Would remove: $pattern"
            else
                log "  Removing: $pattern"
                rm -f $pattern
            fi
        fi
    done
}

# Summary of actions
print_summary() {
    echo
    if [ "$DRY_RUN" = true ]; then
        log_info "DRY RUN COMPLETED - No changes were made"
    else
        log_success "Cleanup completed successfully!"
    fi
    
    log_info "Summary of actions:"
    
    # Check what was cleaned
    local workspace_path="$WORKSPACES_DIR/$AGENT_NAME"
    if [ ! -d "$workspace_path" ] && [ "$DRY_RUN" = false ]; then
        log "  ${GREEN}✓${NC} Workspace directory removed"
    fi
    
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        local containers=$(docker ps -a --filter "name=${AGENT_NAME}-" --format "{{.Names}}" 2>/dev/null | grep -v "^$" || echo "")
        if [ -z "$containers" ] && [ "$DRY_RUN" = false ]; then
            log "  ${GREEN}✓${NC} Docker containers cleaned up"
        fi
    fi
    
    if [ -f "$CONFIG_FILE" ] && ! jq -e ".agents[\"$AGENT_NAME\"]" "$CONFIG_FILE" >/dev/null 2>&1 && [ "$DRY_RUN" = false ]; then
        log "  ${GREEN}✓${NC} Configuration files updated"
    fi
    
    # Check for any remaining resources
    if [ "$DRY_RUN" = false ]; then
        log_info "Checking for remaining resources..."
        
        local remaining=false
        
        if [ -d "$workspace_path" ]; then
            log_warning "Workspace directory still exists: $workspace_path"
            remaining=true
        fi
        
        if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
            local containers=$(docker ps -a --filter "name=${AGENT_NAME}-" --format "{{.Names}}" 2>/dev/null | grep -v "^$" || echo "")
            if [ -n "$containers" ]; then
                log_warning "Docker containers still exist"
                remaining=true
            fi
        fi
        
        if [ "$remaining" = false ]; then
            log_success "All resources cleaned up successfully!"
        fi
    fi
    
    log_info "Cleanup log saved to: $LOG_FILE"
}

# Main cleanup function
main() {
    log_info "Starting agent workspace cleanup - $(date)"
    log_info "Agent: $AGENT_NAME"
    
    if [ "$DRY_RUN" = true ]; then
        log_warning "DRY RUN MODE - No changes will be made"
    fi
    
    echo
    
    # Validate agent name
    validate_agent_name
    
    # Check if workspace exists
    if ! check_workspace_exists; then
        log_warning "No workspace found, checking for other resources..."
    else
        # Check for uncommitted changes
        check_uncommitted_changes
    fi
    
    # List resources to be cleaned up
    list_resources
    
    # Confirm cleanup
    confirm_cleanup
    
    # Perform cleanup steps
    stop_docker_containers
    kill_port_processes
    remove_git_worktree
    remove_git_branch
    update_config_files
    cleanup_temp_files
    
    # Print summary
    print_summary
    
    log_info "Cleanup completed - $(date)"
}

# Script entry point
parse_args "$@"
main