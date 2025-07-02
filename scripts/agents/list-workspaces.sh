#!/bin/bash

# list-workspaces.sh - List and monitor all agent workspaces
# 
# This script provides comprehensive visibility into all active agent workspaces,
# showing their status, resource usage, and health information.
#
# Usage: ./list-workspaces.sh [options]
#
# Examples:
#   ./list-workspaces.sh                    # Show all workspaces
#   ./list-workspaces.sh --active          # Only show active workspaces
#   ./list-workspaces.sh --idle            # Only show idle workspaces
#   ./list-workspaces.sh --summary         # Show summary only
#   ./list-workspaces.sh --json            # Output as JSON
#   ./list-workspaces.sh --ports           # Show detailed port information

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACES_DIR="$PROJECT_ROOT/agent-workspaces"
CONFIG_FILE="$PROJECT_ROOT/.claude/agent-config.json"
PORT_TRACKING_FILE="$PROJECT_ROOT/.claude/agent-ports.json"

# Default options
SHOW_ALL=true
SHOW_ACTIVE=false
SHOW_IDLE=false
SHOW_SUMMARY=false
OUTPUT_JSON=false
SHOW_PORTS=false
VERBOSE=false

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

print_debug() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "${CYAN}[DEBUG]${NC} $1"
    fi
}

# Usage function
usage() {
    cat << EOF
Usage: $0 [options]

List and monitor all agent workspaces with their status and resource usage.

Options:
    --active            Show only active workspaces (with running processes)
    --idle              Show only idle workspaces (no running processes)
    --summary           Show summary statistics only
    --json              Output in JSON format
    --ports             Show detailed port allocation information
    --verbose           Enable verbose output
    -h, --help          Show this help message

Filter Options:
    --branch <pattern>  Filter by branch name pattern
    --status <status>   Filter by git status (clean, dirty, ahead, behind)

Output Formats:
    Default: Human-readable table format
    --json: Machine-readable JSON format
    --summary: Condensed overview

Examples:
    $0                          # List all workspaces
    $0 --active --ports         # Active workspaces with port details
    $0 --json --summary         # Summary in JSON format
    $0 --branch "feat/*"        # Workspaces on feature branches
    $0 --idle --verbose         # Idle workspaces with debug info

EOF
    exit 0
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --active)
                SHOW_ACTIVE=true
                SHOW_ALL=false
                shift
                ;;
            --idle)
                SHOW_IDLE=true
                SHOW_ALL=false
                shift
                ;;
            --summary)
                SHOW_SUMMARY=true
                shift
                ;;
            --json)
                OUTPUT_JSON=true
                shift
                ;;
            --ports)
                SHOW_PORTS=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --branch)
                BRANCH_FILTER="$2"
                shift 2
                ;;
            --status)
                STATUS_FILTER="$2"
                shift 2
                ;;
            -h|--help)
                usage
                ;;
            *)
                print_error "Unknown option: $1"
                usage
                ;;
        esac
    done
}

# Check if Docker is available and running
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        print_debug "Docker not available"
        return 1
    fi
    
    if ! docker info >/dev/null 2>&1; then
        print_debug "Docker daemon not running"
        return 1
    fi
    
    return 0
}

# Get disk usage for a directory in human readable format
get_disk_usage() {
    local dir="$1"
    if [[ -d "$dir" ]]; then
        du -sh "$dir" 2>/dev/null | cut -f1 || echo "N/A"
    else
        echo "N/A"
    fi
}

# Get git status information
get_git_status() {
    local workspace_path="$1"
    local git_status=""
    local branch_name=""
    local uncommitted_changes=false
    local ahead_behind=""
    
    if [[ -d "$workspace_path/.git" ]]; then
        cd "$workspace_path" 2>/dev/null || return 1
        
        # Get branch name
        branch_name=$(git branch --show-current 2>/dev/null || echo "detached")
        
        # Check for uncommitted changes
        if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
            uncommitted_changes=true
        fi
        
        # Check ahead/behind status
        if [[ "$branch_name" != "detached" ]]; then
            local upstream=$(git rev-parse --abbrev-ref @{upstream} 2>/dev/null || echo "")
            if [[ -n "$upstream" ]]; then
                local ahead=$(git rev-list --count HEAD..@{upstream} 2>/dev/null || echo "0")
                local behind=$(git rev-list --count @{upstream}..HEAD 2>/dev/null || echo "0")
                
                if [[ "$ahead" -gt 0 ]] && [[ "$behind" -gt 0 ]]; then
                    ahead_behind="±${ahead}/${behind}"
                elif [[ "$ahead" -gt 0 ]]; then
                    ahead_behind="↓${ahead}"
                elif [[ "$behind" -gt 0 ]]; then
                    ahead_behind="↑${behind}"
                else
                    ahead_behind="✓"
                fi
            fi
        fi
        
        # Determine overall status
        if [[ "$uncommitted_changes" == true ]]; then
            git_status="dirty"
        elif [[ "$ahead_behind" == "✓" ]]; then
            git_status="clean"
        elif [[ "$ahead_behind" =~ ↓ ]]; then
            git_status="behind"
        elif [[ "$ahead_behind" =~ ↑ ]]; then
            git_status="ahead"
        else
            git_status="diverged"
        fi
        
        cd - >/dev/null
    else
        git_status="no-git"
        branch_name="N/A"
    fi
    
    echo "${git_status}|${branch_name}|${uncommitted_changes}|${ahead_behind}"
}

# Get port information for an agent
get_port_info() {
    local agent_name="$1"
    local ports_used=()
    local ports_allocated=""
    
    # Get allocated ports from config
    if [[ -f "$CONFIG_FILE" ]]; then
        local port_start=$(jq -r ".agents[\"$agent_name\"].portRange.start // empty" "$CONFIG_FILE" 2>/dev/null || echo "")
        local port_end=$(jq -r ".agents[\"$agent_name\"].portRange.end // empty" "$CONFIG_FILE" 2>/dev/null || echo "")
        
        if [[ -n "$port_start" ]] && [[ -n "$port_end" ]]; then
            ports_allocated="${port_start}-${port_end}"
            
            # Check which ports are actually in use
            for port in $(seq "$port_start" "$port_end"); do
                if lsof -i :"$port" >/dev/null 2>&1; then
                    ports_used+=("$port")
                fi
            done
        fi
    fi
    
    echo "${ports_allocated}|${ports_used[*]}"
}

# Get Docker container information
get_docker_info() {
    local agent_name="$1"
    local containers=()
    local running_containers=()
    
    if check_docker; then
        # Get all containers for this agent
        local all_containers=$(docker ps -a --filter "name=${agent_name}-" --format "{{.Names}}:{{.Status}}" 2>/dev/null || echo "")
        
        if [[ -n "$all_containers" ]]; then
            while IFS= read -r container_info; do
                if [[ -n "$container_info" ]]; then
                    local container_name="${container_info%%:*}"
                    local container_status="${container_info##*:}"
                    
                    containers+=("$container_name")
                    
                    if [[ "$container_status" =~ ^Up ]]; then
                        running_containers+=("$container_name")
                    fi
                fi
            done <<< "$all_containers"
        fi
    fi
    
    echo "${#containers[@]}|${#running_containers[@]}|${containers[*]}|${running_containers[*]}"
}

# Get process information
get_process_info() {
    local workspace_path="$1"
    local agent_name="$2"
    local process_count=0
    local node_processes=0
    local docker_processes=0
    
    # Count processes that might be related to this workspace
    # Look for processes with the workspace path or agent name
    if command -v pgrep >/dev/null 2>&1; then
        # Count Node.js processes that might be from this workspace
        node_processes=$(pgrep -f "node.*${workspace_path}" 2>/dev/null | wc -l || echo "0")
        
        # Count processes with agent name
        local agent_processes=$(pgrep -f "$agent_name" 2>/dev/null | wc -l || echo "0")
        
        process_count=$((node_processes + agent_processes))
    fi
    
    echo "${process_count}|${node_processes}|${docker_processes}"
}

# Check if workspace is active (has running processes or containers)
is_workspace_active() {
    local agent_name="$1"
    local workspace_path="$2"
    
    # Check processes
    local process_info=$(get_process_info "$workspace_path" "$agent_name")
    local process_count="${process_info%%|*}"
    
    if [[ "$process_count" -gt 0 ]]; then
        return 0
    fi
    
    # Check Docker containers
    local docker_info=$(get_docker_info "$agent_name")
    IFS='|' read -r total_containers running_containers _ _ <<< "$docker_info"
    
    if [[ "$running_containers" -gt 0 ]]; then
        return 0
    fi
    
    # Check ports
    local port_info=$(get_port_info "$agent_name")
    local ports_used="${port_info##*|}"
    
    if [[ -n "$ports_used" ]] && [[ "$ports_used" != " " ]]; then
        return 0
    fi
    
    return 1
}

# Get workspace information
get_workspace_info() {
    local workspace_path="$1"
    local agent_name="$(basename "$workspace_path")"
    
    # Basic info
    local disk_usage=$(get_disk_usage "$workspace_path")
    local git_info=$(get_git_status "$workspace_path")
    local port_info=$(get_port_info "$agent_name")
    local docker_info=$(get_docker_info "$agent_name")
    local process_info=$(get_process_info "$workspace_path" "$agent_name")
    
    # Parse git info
    IFS='|' read -r git_status branch_name uncommitted_changes ahead_behind <<< "$git_info"
    
    # Parse port info
    IFS='|' read -r ports_allocated ports_used <<< "$port_info"
    
    # Parse docker info
    IFS='|' read -r total_containers running_containers all_containers running_container_names <<< "$docker_info"
    
    # Parse process info
    IFS='|' read -r process_count node_processes docker_processes <<< "$process_info"
    
    # Determine if active
    local is_active="false"
    if is_workspace_active "$agent_name" "$workspace_path"; then
        is_active="true"
    fi
    
    # Create JSON object
    cat << EOF
{
    "agent_name": "$agent_name",
    "workspace_path": "$workspace_path",
    "disk_usage": "$disk_usage",
    "is_active": $is_active,
    "git": {
        "status": "$git_status",
        "branch": "$branch_name",
        "uncommitted_changes": $uncommitted_changes,
        "ahead_behind": "$ahead_behind"
    },
    "ports": {
        "allocated": "$ports_allocated",
        "used": [$([[ -n "$ports_used" ]] && echo "\"${ports_used// /\",\"}\""  | sed 's/,""//g' || echo "")]
    },
    "docker": {
        "total_containers": $total_containers,
        "running_containers": $running_containers,
        "container_names": [$([[ -n "$all_containers" ]] && echo "\"${all_containers// /\",\"}\""  | sed 's/,""//g' || echo "")]
    },
    "processes": {
        "total": $process_count,
        "node": $node_processes
    },
    "last_modified": "$(stat -c %Y "$workspace_path" 2>/dev/null || echo "0")"
}
EOF
}

# Display workspace in table format
display_workspace_table() {
    local workspace_info="$1"
    
    local agent_name=$(echo "$workspace_info" | jq -r '.agent_name')
    local disk_usage=$(echo "$workspace_info" | jq -r '.disk_usage')
    local is_active=$(echo "$workspace_info" | jq -r '.is_active')
    local git_status=$(echo "$workspace_info" | jq -r '.git.status')
    local branch_name=$(echo "$workspace_info" | jq -r '.git.branch')
    local ahead_behind=$(echo "$workspace_info" | jq -r '.git.ahead_behind')
    local ports_allocated=$(echo "$workspace_info" | jq -r '.ports.allocated')
    local ports_used=$(echo "$workspace_info" | jq -r '.ports.used | join(",")')
    local running_containers=$(echo "$workspace_info" | jq -r '.docker.running_containers')
    local process_count=$(echo "$workspace_info" | jq -r '.processes.total')
    
    # Color coding based on status
    local status_color="$NC"
    local status_symbol="○"
    
    if [[ "$is_active" == "true" ]]; then
        status_color="$GREEN"
        status_symbol="●"
    else
        status_color="$YELLOW"
        status_symbol="○"
    fi
    
    # Git status color
    local git_color="$NC"
    case "$git_status" in
        "clean") git_color="$GREEN" ;;
        "dirty") git_color="$RED" ;;
        "ahead") git_color="$BLUE" ;;
        "behind") git_color="$YELLOW" ;;
        "diverged") git_color="$MAGENTA" ;;
    esac
    
    # Format branch name (truncate if too long)
    local branch_display="$branch_name"
    if [[ ${#branch_name} -gt 25 ]]; then
        branch_display="${branch_name:0:22}..."
    fi
    
    # Format ports display
    local ports_display="$ports_allocated"
    if [[ -n "$ports_used" ]] && [[ "$SHOW_PORTS" == true ]]; then
        ports_display="$ports_allocated ($ports_used)"
    fi
    
    printf "%-15s %s%-8s%s %-25s %s%-10s%s %-15s %3s %3s %6s\n" \
        "$agent_name" \
        "$status_color" "$status_symbol" "$NC" \
        "$branch_display" \
        "$git_color" "$git_status" "$NC" \
        "$ports_display" \
        "$running_containers" \
        "$process_count" \
        "$disk_usage"
    
    # Show additional details if verbose
    if [[ "$VERBOSE" == true ]]; then
        if [[ -n "$ahead_behind" ]] && [[ "$ahead_behind" != "null" ]]; then
            printf "    └─ Git: %s\n" "$ahead_behind"
        fi
        
        if [[ "$SHOW_PORTS" == true ]] && [[ -n "$ports_used" ]]; then
            printf "    └─ Active ports: %s\n" "$ports_used"
        fi
        
        local container_names=$(echo "$workspace_info" | jq -r '.docker.container_names | join(", ")')
        if [[ -n "$container_names" ]] && [[ "$container_names" != "" ]]; then
            printf "    └─ Containers: %s\n" "$container_names"
        fi
    fi
}

# Display summary statistics
display_summary() {
    local workspaces_json="$1"
    
    local total_workspaces=$(echo "$workspaces_json" | jq 'length')
    local active_workspaces=$(echo "$workspaces_json" | jq '[.[] | select(.is_active == true)] | length')
    local idle_workspaces=$((total_workspaces - active_workspaces))
    
    local total_containers=$(echo "$workspaces_json" | jq '[.[].docker.total_containers] | add // 0')
    local running_containers=$(echo "$workspaces_json" | jq '[.[].docker.running_containers] | add // 0')
    local total_processes=$(echo "$workspaces_json" | jq '[.[].processes.total] | add // 0')
    
    local dirty_repos=$(echo "$workspaces_json" | jq '[.[] | select(.git.status == "dirty")] | length')
    local behind_repos=$(echo "$workspaces_json" | jq '[.[] | select(.git.status == "behind")] | length')
    
    # Calculate total disk usage (approximate)
    local total_disk="N/A"
    if command -v numfmt >/dev/null 2>&1; then
        local disk_bytes=0
        while IFS= read -r usage; do
            if [[ "$usage" != "N/A" ]]; then
                local bytes=$(numfmt --from=iec "$usage" 2>/dev/null || echo "0")
                disk_bytes=$((disk_bytes + bytes))
            fi
        done < <(echo "$workspaces_json" | jq -r '.[].disk_usage')
        
        if [[ "$disk_bytes" -gt 0 ]]; then
            total_disk=$(numfmt --to=iec "$disk_bytes")
        fi
    fi
    
    if [[ "$OUTPUT_JSON" == true ]]; then
        cat << EOF
{
    "summary": {
        "total_workspaces": $total_workspaces,
        "active_workspaces": $active_workspaces,
        "idle_workspaces": $idle_workspaces,
        "total_disk_usage": "$total_disk",
        "docker": {
            "total_containers": $total_containers,
            "running_containers": $running_containers
        },
        "processes": {
            "total": $total_processes
        },
        "git": {
            "dirty_repos": $dirty_repos,
            "behind_repos": $behind_repos
        }
    }
}
EOF
    else
        echo ""
        echo "═══════════════════════════════════════════════════════════════"
        echo "                        WORKSPACE SUMMARY"
        echo "═══════════════════════════════════════════════════════════════"
        echo ""
        printf "  Total Workspaces:     %s%d%s\n" "$CYAN" "$total_workspaces" "$NC"
        printf "  Active Workspaces:    %s%d%s\n" "$GREEN" "$active_workspaces" "$NC"
        printf "  Idle Workspaces:      %s%d%s\n" "$YELLOW" "$idle_workspaces" "$NC"
        echo ""
        printf "  Docker Containers:    %s%d%s total, %s%d%s running\n" "$BLUE" "$total_containers" "$NC" "$GREEN" "$running_containers" "$NC"
        printf "  Active Processes:     %s%d%s\n" "$CYAN" "$total_processes" "$NC"
        printf "  Total Disk Usage:     %s%s%s\n" "$MAGENTA" "$total_disk" "$NC"
        echo ""
        if [[ "$dirty_repos" -gt 0 ]] || [[ "$behind_repos" -gt 0 ]]; then
            echo "⚠️  Attention Required:"
            if [[ "$dirty_repos" -gt 0 ]]; then
                printf "  • %s%d%s workspaces have uncommitted changes\n" "$RED" "$dirty_repos" "$NC"
            fi
            if [[ "$behind_repos" -gt 0 ]]; then
                printf "  • %s%d%s workspaces are behind remote\n" "$YELLOW" "$behind_repos" "$NC"
            fi
            echo ""
        fi
        echo "═══════════════════════════════════════════════════════════════"
        echo ""
    fi
}

# Main function to list workspaces
list_workspaces() {
    if [[ ! -d "$WORKSPACES_DIR" ]]; then
        if [[ "$OUTPUT_JSON" == true ]]; then
            echo "[]"
        else
            print_warning "No agent workspaces directory found: $WORKSPACES_DIR"
            print_info "Run './setup-workspace.sh' to create your first agent workspace"
        fi
        return 0
    fi
    
    local workspaces=()
    local workspace_data="["
    local first=true
    
    # Collect workspace information
    for workspace_path in "$WORKSPACES_DIR"/*/; do
        if [[ -d "$workspace_path" ]]; then
            local agent_name="$(basename "$workspace_path")"
            
            # Skip if not matching pattern
            if [[ -n "${BRANCH_FILTER:-}" ]]; then
                local git_info=$(get_git_status "$workspace_path")
                local branch_name="${git_info##*|}"
                branch_name="${branch_name%|*}"
                if [[ ! "$branch_name" =~ $BRANCH_FILTER ]]; then
                    continue
                fi
            fi
            
            local workspace_info=$(get_workspace_info "$workspace_path")
            workspaces+=("$workspace_info")
            
            # Build JSON array
            if [[ "$first" == true ]]; then
                first=false
            else
                workspace_data+=","
            fi
            workspace_data+="$workspace_info"
        fi
    done
    workspace_data+="]"
    
    # Filter by status if requested
    if [[ -n "${STATUS_FILTER:-}" ]]; then
        workspace_data=$(echo "$workspace_data" | jq "[.[] | select(.git.status == \"$STATUS_FILTER\")]")
    fi
    
    # Filter by active/idle
    if [[ "$SHOW_ACTIVE" == true ]]; then
        workspace_data=$(echo "$workspace_data" | jq '[.[] | select(.is_active == true)]')
    elif [[ "$SHOW_IDLE" == true ]]; then
        workspace_data=$(echo "$workspace_data" | jq '[.[] | select(.is_active == false)]')
    fi
    
    # Check if we have any workspaces after filtering
    local workspace_count=$(echo "$workspace_data" | jq 'length')
    if [[ "$workspace_count" -eq 0 ]]; then
        if [[ "$OUTPUT_JSON" == true ]]; then
            echo "[]"
        else
            print_info "No workspaces match the specified criteria"
        fi
        return 0
    fi
    
    # Output results
    if [[ "$OUTPUT_JSON" == true ]]; then
        if [[ "$SHOW_SUMMARY" == true ]]; then
            display_summary "$workspace_data"
        else
            echo "$workspace_data" | jq '.'
        fi
    else
        if [[ "$SHOW_SUMMARY" == true ]]; then
            display_summary "$workspace_data"
        else
            # Display table header
            echo ""
            echo "Agent Workspaces Status"
            echo "═══════════════════════════════════════════════════════════════════════════════════════"
            printf "%-15s %-8s %-25s %-10s %-15s %-3s %-3s %s\n" \
                "AGENT" "STATUS" "BRANCH" "GIT" "PORTS" "CTR" "PRC" "DISK"
            echo "───────────────────────────────────────────────────────────────────────────────────────"
            
            # Display each workspace
            echo "$workspace_data" | jq -r '.[] | @base64' | while read -r workspace_b64; do
                local workspace_info=$(echo "$workspace_b64" | base64 --decode)
                display_workspace_table "$workspace_info"
            done
            
            echo "───────────────────────────────────────────────────────────────────────────────────────"
            echo ""
            
            # Legend
            echo "Legend: ● Active  ○ Idle  |  CTR=Containers  PRC=Processes"
            if [[ "$SHOW_PORTS" == true ]]; then
                echo "        Ports format: allocated-range (active-ports)"
            fi
            echo ""
        fi
    fi
}

# Main execution
main() {
    parse_args "$@"
    
    # Validate dependencies
    if ! command -v jq >/dev/null 2>&1; then
        print_error "jq is required but not installed. Please install jq."
        exit 1
    fi
    
    list_workspaces
}

# Run main function
main "$@"