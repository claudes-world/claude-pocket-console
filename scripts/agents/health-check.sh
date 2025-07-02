#!/bin/bash

# health-check.sh - Monitor health of all agent workspaces
# 
# This script provides comprehensive health monitoring for agent workspaces,
# checking for port conflicts, Docker issues, git problems, and resource usage.
#
# Usage: ./health-check.sh [options]
#
# Examples:
#   ./health-check.sh                       # Full health check
#   ./health-check.sh --quick              # Quick check only
#   ./health-check.sh --json               # Output as JSON
#   ./health-check.sh --fix                # Auto-fix issues where possible
#   ./health-check.sh --agent agent-alpha  # Check specific agent only

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
HEALTH_REPORT_FILE="$PROJECT_ROOT/logs/health-$(date +%Y%m%d-%H%M%S).json"

# Default options
QUICK_CHECK=false
OUTPUT_JSON=false
AUTO_FIX=false
SPECIFIC_AGENT=""
VERBOSE=false
GENERATE_REPORT=true

# Health check categories
declare -A HEALTH_SCORES=(
    ["git"]=0
    ["docker"]=0
    ["ports"]=0
    ["config"]=0
    ["resources"]=0
    ["overall"]=0
)

# Issues tracking
declare -a CRITICAL_ISSUES=()
declare -a WARNING_ISSUES=()
declare -a INFO_ISSUES=()

# Ensure log directory exists
mkdir -p "$(dirname "$HEALTH_REPORT_FILE")"

# Function to print colored output
print_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
    CRITICAL_ISSUES+=("$1")
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
    WARNING_ISSUES+=("$1")
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
    INFO_ISSUES+=("$1")
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

Monitor health of all agent workspaces and identify potential issues.

Options:
    --quick             Perform quick checks only (skip resource-intensive checks)
    --json              Output results in JSON format
    --fix               Automatically fix issues where possible
    --agent <name>      Check specific agent only (e.g., agent-alpha)
    --no-report         Don't generate health report file
    --verbose           Enable verbose output
    -h, --help          Show this help message

Health Checks:
    • Git status and synchronization
    • Port conflicts and allocation
    • Docker container health
    • Configuration file integrity
    • Resource usage and limits
    • Workspace file structure

Output Formats:
    Default: Human-readable with recommendations
    --json: Machine-readable JSON format

Examples:
    $0                          # Full health check
    $0 --quick --json           # Quick check in JSON format
    $0 --agent agent-alpha      # Check single agent
    $0 --fix --verbose          # Auto-fix with detailed output

EOF
    exit 0
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --quick)
                QUICK_CHECK=true
                shift
                ;;
            --json)
                OUTPUT_JSON=true
                shift
                ;;
            --fix)
                AUTO_FIX=true
                shift
                ;;
            --agent)
                SPECIFIC_AGENT="$2"
                shift 2
                ;;
            --no-report)
                GENERATE_REPORT=false
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
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

# Check if Docker is available and healthy
check_docker_health() {
    local docker_status="healthy"
    local docker_issues=()
    
    print_debug "Checking Docker health..."
    
    if ! command -v docker >/dev/null 2>&1; then
        docker_status="unavailable"
        docker_issues+=("Docker command not found")
        return 1
    fi
    
    if ! docker info >/dev/null 2>&1; then
        docker_status="daemon-down"
        docker_issues+=("Docker daemon not running")
        return 1
    fi
    
    # Check Docker system health
    local docker_info=$(docker system df --format "json" 2>/dev/null || echo "{}")
    
    # Check for resource usage issues
    if [[ "$QUICK_CHECK" == false ]]; then
        local container_count=$(docker ps -q | wc -l)
        local total_containers=$(docker ps -a -q | wc -l)
        
        if [[ "$container_count" -gt 50 ]]; then
            docker_issues+=("Many running containers ($container_count)")
            docker_status="warning"
        fi
        
        if [[ "$total_containers" -gt 100 ]]; then
            docker_issues+=("Many total containers ($total_containers)")
            docker_status="warning"
        fi
    fi
    
    HEALTH_SCORES["docker"]=$([[ "$docker_status" == "healthy" ]] && echo 100 || echo 50)
    
    for issue in "${docker_issues[@]}"; do
        if [[ "$docker_status" == "unavailable" ]] || [[ "$docker_status" == "daemon-down" ]]; then
            print_error "Docker: $issue"
        else
            print_warning "Docker: $issue"
        fi
    done
    
    return 0
}

# Check port conflicts and allocation
check_port_conflicts() {
    local port_issues=()
    local conflicts_found=false
    
    print_debug "Checking port allocations and conflicts..."
    
    if [[ ! -f "$CONFIG_FILE" ]]; then
        print_warning "Agent configuration file not found: $CONFIG_FILE"
        HEALTH_SCORES["ports"]=70
        return 1
    fi
    
    # Track all allocated ports
    declare -A port_allocations
    declare -A agent_ports
    
    # Read port allocations from config
    while IFS= read -r agent_name; do
        if [[ -n "$agent_name" ]]; then
            local port_start=$(jq -r ".agents[\"$agent_name\"].portRange.start // empty" "$CONFIG_FILE" 2>/dev/null)
            local port_end=$(jq -r ".agents[\"$agent_name\"].portRange.end // empty" "$CONFIG_FILE" 2>/dev/null)
            
            if [[ -n "$port_start" ]] && [[ -n "$port_end" ]]; then
                agent_ports["$agent_name"]="$port_start-$port_end"
                
                for port in $(seq "$port_start" "$port_end"); do
                    if [[ -n "${port_allocations[$port]:-}" ]]; then
                        print_error "Port conflict: Port $port allocated to both ${port_allocations[$port]} and $agent_name"
                        conflicts_found=true
                    else
                        port_allocations["$port"]="$agent_name"
                    fi
                done
            fi
        fi
    done < <(jq -r '.agents | keys[]' "$CONFIG_FILE" 2>/dev/null || echo "")
    
    # Check for processes using allocated ports
    local unauthorized_ports=()
    for port in "${!port_allocations[@]}"; do
        if lsof -i :"$port" >/dev/null 2>&1; then
            local process_info=$(lsof -i :"$port" -t 2>/dev/null | head -1)
            local agent_name="${port_allocations[$port]}"
            
            # Try to determine if this is expected (from the correct agent)
            local process_cmd=""
            if [[ -n "$process_info" ]]; then
                process_cmd=$(ps -p "$process_info" -o comm= 2>/dev/null || echo "unknown")
            fi
            
            # This is a simplified check - in a real environment you'd want more sophisticated detection
            if [[ ! "$process_cmd" =~ (node|npm|pnpm|next) ]]; then
                unauthorized_ports+=("$port:$agent_name:$process_cmd")
            fi
        fi
    done
    
    # Report unauthorized port usage
    for port_info in "${unauthorized_ports[@]}"; do
        IFS=':' read -r port agent process <<< "$port_info"
        print_warning "Unauthorized process '$process' using port $port (allocated to $agent)"
    done
    
    # Check for port range overlaps in common ranges
    local common_ports=(3000 8000 8080 9000 5000)
    for port in "${common_ports[@]}"; do
        if [[ -n "${port_allocations[$port]:-}" ]]; then
            print_info "Common port $port is allocated to ${port_allocations[$port]}"
        fi
    done
    
    # Calculate health score
    local port_score=100
    if [[ "$conflicts_found" == true ]]; then
        port_score=20
    elif [[ ${#unauthorized_ports[@]} -gt 0 ]]; then
        port_score=70
    fi
    
    HEALTH_SCORES["ports"]=$port_score
    
    return 0
}

# Check git status across all workspaces
check_git_health() {
    local git_issues=()
    local clean_repos=0
    local total_repos=0
    
    print_debug "Checking git health across workspaces..."
    
    if [[ ! -d "$WORKSPACES_DIR" ]]; then
        print_warning "No workspaces directory found"
        HEALTH_SCORES["git"]=100
        return 0
    fi
    
    for workspace_path in "$WORKSPACES_DIR"/*/; do
        if [[ -d "$workspace_path" ]]; then
            local agent_name="$(basename "$workspace_path")"
            
            # Skip if checking specific agent
            if [[ -n "$SPECIFIC_AGENT" ]] && [[ "$agent_name" != "$SPECIFIC_AGENT" ]]; then
                continue
            fi
            
            total_repos=$((total_repos + 1))
            
            if [[ -d "$workspace_path/.git" ]]; then
                cd "$workspace_path" 2>/dev/null || continue
                
                # Check for uncommitted changes
                if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
                    git_issues+=("$agent_name: Uncommitted changes")
                else
                    clean_repos=$((clean_repos + 1))
                fi
                
                # Check if ahead/behind remote
                local branch_name=$(git branch --show-current 2>/dev/null || echo "")
                if [[ -n "$branch_name" ]]; then
                    local upstream=$(git rev-parse --abbrev-ref @{upstream} 2>/dev/null || echo "")
                    if [[ -n "$upstream" ]]; then
                        local ahead=$(git rev-list --count HEAD..@{upstream} 2>/dev/null || echo "0")
                        local behind=$(git rev-list --count @{upstream}..HEAD 2>/dev/null || echo "0")
                        
                        if [[ "$ahead" -gt 0 ]]; then
                            git_issues+=("$agent_name: $ahead commits behind remote")
                        fi
                        if [[ "$behind" -gt 0 ]]; then
                            git_issues+=("$agent_name: $behind commits ahead of remote")
                        fi
                    else
                        git_issues+=("$agent_name: No upstream branch configured")
                    fi
                fi
                
                # Check for untracked files
                local untracked=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l)
                if [[ "$untracked" -gt 10 ]]; then
                    git_issues+=("$agent_name: Many untracked files ($untracked)")
                fi
                
                cd - >/dev/null
            else
                git_issues+=("$agent_name: Not a git repository")
            fi
        fi
    done
    
    # Report git issues
    for issue in "${git_issues[@]}"; do
        if [[ "$issue" =~ "Not a git repository" ]]; then
            print_error "Git: $issue"
        else
            print_warning "Git: $issue"
        fi
    done
    
    # Calculate git health score
    local git_score=100
    if [[ "$total_repos" -gt 0 ]]; then
        git_score=$((clean_repos * 100 / total_repos))
        
        # Penalize for critical issues
        local critical_git_issues=$(printf '%s\n' "${git_issues[@]}" | grep -c "Not a git repository" || echo "0")
        if [[ "$critical_git_issues" -gt 0 ]]; then
            git_score=$((git_score - critical_git_issues * 20))
        fi
    fi
    
    HEALTH_SCORES["git"]=$([[ "$git_score" -lt 0 ]] && echo 0 || echo "$git_score")
    
    return 0
}

# Check configuration files integrity
check_config_health() {
    local config_issues=()
    
    print_debug "Checking configuration file integrity..."
    
    # Check main config file
    if [[ ! -f "$CONFIG_FILE" ]]; then
        config_issues+=("Agent configuration file missing: $CONFIG_FILE")
    else
        if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
            config_issues+=("Agent configuration file has invalid JSON")
        else
            # Validate config structure
            local agents_count=$(jq '.agents | keys | length' "$CONFIG_FILE" 2>/dev/null || echo "0")
            if [[ "$agents_count" -eq 0 ]]; then
                config_issues+=("No agents configured in $CONFIG_FILE")
            fi
            
            # Check for required fields
            while IFS= read -r agent_name; do
                if [[ -n "$agent_name" ]]; then
                    local port_start=$(jq -r ".agents[\"$agent_name\"].portRange.start // empty" "$CONFIG_FILE" 2>/dev/null)
                    local branch=$(jq -r ".agents[\"$agent_name\"].branch // empty" "$CONFIG_FILE" 2>/dev/null)
                    
                    if [[ -z "$port_start" ]]; then
                        config_issues+=("Agent $agent_name missing port configuration")
                    fi
                    
                    if [[ -z "$branch" ]]; then
                        config_issues+=("Agent $agent_name missing branch configuration")
                    fi
                fi
            done < <(jq -r '.agents | keys[]' "$CONFIG_FILE" 2>/dev/null || echo "")
        fi
    fi
    
    # Check port tracking file
    if [[ -f "$PORT_TRACKING_FILE" ]]; then
        if ! jq empty "$PORT_TRACKING_FILE" 2>/dev/null; then
            config_issues+=("Port tracking file has invalid JSON")
        fi
    fi
    
    # Check workspace-specific configs
    if [[ -d "$WORKSPACES_DIR" ]]; then
        for workspace_path in "$WORKSPACES_DIR"/*/; do
            if [[ -d "$workspace_path" ]]; then
                local agent_name="$(basename "$workspace_path")"
                
                # Skip if checking specific agent
                if [[ -n "$SPECIFIC_AGENT" ]] && [[ "$agent_name" != "$SPECIFIC_AGENT" ]]; then
                    continue
                fi
                
                # Check for .env.local
                if [[ ! -f "$workspace_path/.env.local" ]]; then
                    config_issues+=("$agent_name: Missing .env.local file")
                fi
                
                # Check for agent config
                if [[ -d "$workspace_path/.agent-config" ]]; then
                    local agent_config="$workspace_path/.agent-config/agent.json"
                    if [[ -f "$agent_config" ]]; then
                        if ! jq empty "$agent_config" 2>/dev/null; then
                            config_issues+=("$agent_name: Invalid agent.json format")
                        fi
                    fi
                fi
                
                # Check package.json exists
                if [[ ! -f "$workspace_path/package.json" ]]; then
                    config_issues+=("$agent_name: Missing package.json")
                fi
            fi
        done
    fi
    
    # Report configuration issues
    for issue in "${config_issues[@]}"; do
        if [[ "$issue" =~ "missing|Invalid|has invalid" ]]; then
            print_error "Config: $issue"
        else
            print_warning "Config: $issue"
        fi
    done
    
    # Calculate config health score
    local config_score=100
    local critical_config_issues=$(printf '%s\n' "${config_issues[@]}" | grep -c -E "(missing|Invalid|has invalid)" || echo "0")
    local minor_config_issues=$((${#config_issues[@]} - critical_config_issues))
    
    config_score=$((config_score - critical_config_issues * 30 - minor_config_issues * 10))
    HEALTH_SCORES["config"]=$([[ "$config_score" -lt 0 ]] && echo 0 || echo "$config_score")
    
    return 0
}

# Check resource usage
check_resource_health() {
    local resource_issues=()
    
    print_debug "Checking resource usage..."
    
    if [[ "$QUICK_CHECK" == true ]]; then
        print_debug "Skipping detailed resource checks (quick mode)"
        HEALTH_SCORES["resources"]=100
        return 0
    fi
    
    # Check disk usage
    if [[ -d "$WORKSPACES_DIR" ]]; then
        local total_usage_kb=0
        local workspace_count=0
        
        for workspace_path in "$WORKSPACES_DIR"/*/; do
            if [[ -d "$workspace_path" ]]; then
                workspace_count=$((workspace_count + 1))
                local usage_kb=$(du -sk "$workspace_path" 2>/dev/null | cut -f1 || echo "0")
                total_usage_kb=$((total_usage_kb + usage_kb))
                
                # Check individual workspace size
                local usage_mb=$((usage_kb / 1024))
                if [[ "$usage_mb" -gt 1000 ]]; then  # > 1GB
                    local agent_name="$(basename "$workspace_path")"
                    resource_issues+=("$agent_name: Large workspace size (${usage_mb}MB)")
                fi
            fi
        done
        
        local total_usage_gb=$((total_usage_kb / 1024 / 1024))
        if [[ "$total_usage_gb" -gt 10 ]]; then  # > 10GB total
            resource_issues+=("Total workspace usage is large (${total_usage_gb}GB)")
        fi
        
        print_debug "Total disk usage: ${total_usage_gb}GB across $workspace_count workspaces"
    fi
    
    # Check memory usage of Node processes
    if command -v pgrep >/dev/null 2>&1 && command -v ps >/dev/null 2>&1; then
        local node_processes=$(pgrep node 2>/dev/null | wc -l || echo "0")
        if [[ "$node_processes" -gt 20 ]]; then
            resource_issues+=("Many Node.js processes running ($node_processes)")
        fi
        
        # Check for high memory usage processes
        local high_mem_processes=$(ps aux --no-headers | awk '$4 > 10 && $11 ~ /node/ {print $11 ":" $4}' | wc -l || echo "0")
        if [[ "$high_mem_processes" -gt 0 ]]; then
            resource_issues+=("$high_mem_processes Node.js processes using >10% memory")
        fi
    fi
    
    # Check system load if available
    if [[ -f /proc/loadavg ]]; then
        local load_1min=$(cut -d' ' -f1 /proc/loadavg)
        local cpu_count=$(nproc 2>/dev/null || echo "1")
        local load_per_cpu=$(echo "$load_1min / $cpu_count" | bc -l 2>/dev/null || echo "0")
        
        if (( $(echo "$load_per_cpu > 2.0" | bc -l 2>/dev/null || echo "0") )); then
            resource_issues+=("High system load: $load_1min (${load_per_cpu} per CPU)")
        fi
    fi
    
    # Report resource issues
    for issue in "${resource_issues[@]}"; do
        if [[ "$issue" =~ "High system load" ]]; then
            print_error "Resources: $issue"
        else
            print_warning "Resources: $issue"
        fi
    done
    
    # Calculate resource health score
    local resource_score=100
    local critical_resource_issues=$(printf '%s\n' "${resource_issues[@]}" | grep -c "High system load" || echo "0")
    local minor_resource_issues=$((${#resource_issues[@]} - critical_resource_issues))
    
    resource_score=$((resource_score - critical_resource_issues * 40 - minor_resource_issues * 15))
    HEALTH_SCORES["resources"]=$([[ "$resource_score" -lt 0 ]] && echo 0 || echo "$resource_score")
    
    return 0
}

# Auto-fix issues where possible
auto_fix_issues() {
    if [[ "$AUTO_FIX" == false ]]; then
        return 0
    fi
    
    print_info "Attempting to auto-fix issues..."
    
    local fixes_applied=0
    
    # Fix 1: Clean up stopped Docker containers
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        local stopped_containers=$(docker ps -a --filter "status=exited" -q | wc -l)
        if [[ "$stopped_containers" -gt 0 ]]; then
            print_info "Removing $stopped_containers stopped containers..."
            docker container prune -f >/dev/null 2>&1 || true
            fixes_applied=$((fixes_applied + 1))
        fi
    fi
    
    # Fix 2: Create missing .env.local files
    if [[ -d "$WORKSPACES_DIR" ]]; then
        for workspace_path in "$WORKSPACES_DIR"/*/; do
            if [[ -d "$workspace_path" ]] && [[ ! -f "$workspace_path/.env.local" ]]; then
                local agent_name="$(basename "$workspace_path")"
                print_info "Creating missing .env.local for $agent_name..."
                
                # Create basic .env.local (this would need agent-specific port info)
                cat > "$workspace_path/.env.local" << EOF
# Auto-generated .env.local for $agent_name
NODE_ENV=development
NEXT_TELEMETRY_DISABLED=1
AGENT_NAME=$agent_name
EOF
                fixes_applied=$((fixes_applied + 1))
            fi
        done
    fi
    
    # Fix 3: Git cleanup (remove untracked files in node_modules, etc.)
    # This is intentionally conservative - only clean obvious temp files
    
    print_success "Applied $fixes_applied automatic fixes"
    
    return 0
}

# Generate health recommendations
generate_recommendations() {
    local recommendations=()
    
    # Git recommendations
    if [[ "${HEALTH_SCORES["git"]}" -lt 80 ]]; then
        recommendations+=("Review git status across workspaces - commit or stash changes")
        if grep -q "behind remote" <<< "${WARNING_ISSUES[*]} ${CRITICAL_ISSUES[*]}"; then
            recommendations+=("Pull latest changes from remote repositories")
        fi
    fi
    
    # Port recommendations
    if [[ "${HEALTH_SCORES["ports"]}" -lt 80 ]]; then
        recommendations+=("Resolve port conflicts - check agent configuration")
        recommendations+=("Kill unauthorized processes using allocated ports")
    fi
    
    # Docker recommendations
    if [[ "${HEALTH_SCORES["docker"]}" -lt 80 ]]; then
        recommendations+=("Clean up unused Docker containers and images")
        recommendations+=("Check Docker daemon status and resource limits")
    fi
    
    # Config recommendations
    if [[ "${HEALTH_SCORES["config"]}" -lt 80 ]]; then
        recommendations+=("Validate and fix configuration files")
        recommendations+=("Ensure all agents have required configuration")
    fi
    
    # Resource recommendations
    if [[ "${HEALTH_SCORES["resources"]}" -lt 80 ]]; then
        recommendations+=("Monitor resource usage - consider cleanup")
        recommendations+=("Check for memory leaks in long-running processes")
    fi
    
    # General recommendations
    recommendations+=("Run health check regularly to monitor system health")
    recommendations+=("Use '--fix' option to automatically resolve common issues")
    
    printf '%s\n' "${recommendations[@]}"
}

# Calculate overall health score
calculate_overall_health() {
    local total_score=0
    local category_count=0
    
    for category in "${!HEALTH_SCORES[@]}"; do
        if [[ "$category" != "overall" ]]; then
            local score="${HEALTH_SCORES[$category]}"
            total_score=$((total_score + score))
            category_count=$((category_count + 1))
        fi
    done
    
    if [[ "$category_count" -gt 0 ]]; then
        HEALTH_SCORES["overall"]=$((total_score / category_count))
    else
        HEALTH_SCORES["overall"]=0
    fi
}

# Generate health report
generate_health_report() {
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    local report_json=$(cat << EOF
{
    "timestamp": "$timestamp",
    "overall_health": ${HEALTH_SCORES["overall"]},
    "health_scores": {
        "git": ${HEALTH_SCORES["git"]},
        "docker": ${HEALTH_SCORES["docker"]},
        "ports": ${HEALTH_SCORES["ports"]},
        "config": ${HEALTH_SCORES["config"]},
        "resources": ${HEALTH_SCORES["resources"]}
    },
    "issues": {
        "critical": [$(printf '"%s",' "${CRITICAL_ISSUES[@]}" | sed 's/,$//')],
        "warnings": [$(printf '"%s",' "${WARNING_ISSUES[@]}" | sed 's/,$//')],
        "info": [$(printf '"%s",' "${INFO_ISSUES[@]}" | sed 's/,$//')],
        "total_critical": ${#CRITICAL_ISSUES[@]},
        "total_warnings": ${#WARNING_ISSUES[@]},
        "total_info": ${#INFO_ISSUES[@]}
    },
    "recommendations": [$(generate_recommendations | sed 's/.*/"&"/' | paste -sd',')],
    "system_info": {
        "workspaces_directory": "$WORKSPACES_DIR",
        "quick_check": $QUICK_CHECK,
        "auto_fix_enabled": $AUTO_FIX,
        "specific_agent": "${SPECIFIC_AGENT:-null}"
    }
}
EOF
)
    
    if [[ "$GENERATE_REPORT" == true ]]; then
        echo "$report_json" > "$HEALTH_REPORT_FILE"
        print_debug "Health report saved to: $HEALTH_REPORT_FILE"
    fi
    
    if [[ "$OUTPUT_JSON" == true ]]; then
        echo "$report_json" | jq '.'
    fi
}

# Display human-readable results
display_results() {
    if [[ "$OUTPUT_JSON" == true ]]; then
        return 0
    fi
    
    local overall_health="${HEALTH_SCORES["overall"]}"
    local health_color="$RED"
    local health_status="CRITICAL"
    
    if [[ "$overall_health" -ge 80 ]]; then
        health_color="$GREEN"
        health_status="HEALTHY"
    elif [[ "$overall_health" -ge 60 ]]; then
        health_color="$YELLOW"
        health_status="WARNING"
    fi
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "                    AGENT WORKSPACE HEALTH CHECK"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    printf "  Overall Health: %s%s (%d%%)%s\n" "$health_color" "$health_status" "$overall_health" "$NC"
    echo ""
    echo "┌─────────────────┬────────┬─────────────────────────────────────┐"
    echo "│ Category        │ Score  │ Status                              │"
    echo "├─────────────────┼────────┼─────────────────────────────────────┤"
    
    for category in "git" "docker" "ports" "config" "resources"; do
        local score="${HEALTH_SCORES[$category]}"
        local status_color="$RED"
        local status_text="FAIL"
        
        if [[ "$score" -ge 90 ]]; then
            status_color="$GREEN"
            status_text="EXCELLENT"
        elif [[ "$score" -ge 80 ]]; then
            status_color="$GREEN"
            status_text="GOOD"
        elif [[ "$score" -ge 60 ]]; then
            status_color="$YELLOW"
            status_text="WARNING"
        elif [[ "$score" -ge 40 ]]; then
            status_color="$RED"
            status_text="POOR"
        fi
        
        printf "│ %-15s │ %3d%%   │ %s%-35s%s │\n" \
            "${category^}" "$score" "$status_color" "$status_text" "$NC"
    done
    
    echo "└─────────────────┴────────┴─────────────────────────────────────┘"
    echo ""
    
    # Issue summary
    if [[ ${#CRITICAL_ISSUES[@]} -gt 0 ]] || [[ ${#WARNING_ISSUES[@]} -gt 0 ]]; then
        echo "Issues Found:"
        echo ""
        
        if [[ ${#CRITICAL_ISSUES[@]} -gt 0 ]]; then
            echo "  ${RED}Critical Issues (${#CRITICAL_ISSUES[@]}):${NC}"
            for issue in "${CRITICAL_ISSUES[@]:0:5}"; do  # Show max 5
                echo "    • $issue"
            done
            if [[ ${#CRITICAL_ISSUES[@]} -gt 5 ]]; then
                echo "    ... and $((${#CRITICAL_ISSUES[@]} - 5)) more"
            fi
            echo ""
        fi
        
        if [[ ${#WARNING_ISSUES[@]} -gt 0 ]]; then
            echo "  ${YELLOW}Warnings (${#WARNING_ISSUES[@]}):${NC}"
            for issue in "${WARNING_ISSUES[@]:0:5}"; do  # Show max 5
                echo "    • $issue"
            done
            if [[ ${#WARNING_ISSUES[@]} -gt 5 ]]; then
                echo "    ... and $((${#WARNING_ISSUES[@]} - 5)) more"
            fi
            echo ""
        fi
    else
        echo "${GREEN}✓ No critical issues found${NC}"
        echo ""
    fi
    
    # Recommendations
    echo "Recommendations:"
    echo ""
    local recommendations=($(generate_recommendations))
    for rec in "${recommendations[@]:0:3}"; do  # Show top 3
        echo "  • $rec"
    done
    
    if [[ ${#recommendations[@]} -gt 3 ]]; then
        echo "  ... and $((${#recommendations[@]} - 3)) more recommendations"
    fi
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    
    if [[ "$GENERATE_REPORT" == true ]]; then
        echo ""
        echo "Detailed report saved to: $HEALTH_REPORT_FILE"
    fi
    
    echo ""
}

# Main execution
main() {
    parse_args "$@"
    
    # Validate dependencies
    if ! command -v jq >/dev/null 2>&1; then
        print_error "jq is required but not installed. Please install jq."
        exit 1
    fi
    
    if [[ "$OUTPUT_JSON" == false ]]; then
        print_info "Starting agent workspace health check..."
        if [[ "$QUICK_CHECK" == true ]]; then
            print_info "Running in quick check mode"
        fi
        if [[ -n "$SPECIFIC_AGENT" ]]; then
            print_info "Checking specific agent: $SPECIFIC_AGENT"
        fi
        echo ""
    fi
    
    # Run health checks
    check_docker_health
    check_port_conflicts
    check_git_health
    check_config_health
    check_resource_health
    
    # Auto-fix if requested
    auto_fix_issues
    
    # Calculate overall health
    calculate_overall_health
    
    # Generate report
    generate_health_report
    
    # Display results
    display_results
    
    # Exit with appropriate code
    local exit_code=0
    if [[ "${HEALTH_SCORES["overall"]}" -lt 60 ]]; then
        exit_code=1
    elif [[ ${#CRITICAL_ISSUES[@]} -gt 0 ]]; then
        exit_code=1
    fi
    
    exit $exit_code
}

# Run main function
main "$@"