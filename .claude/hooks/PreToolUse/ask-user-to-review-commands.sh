#!/usr/bin/env bash
set -euo pipefail

# This script is called by Claude Code hooks before executing bash commands
# It lists commands that we want the model to stop and ask the user to review

# Exit codes:
# 0: allow model to continue
# 2: show stderr to model and block the tool call
# 3+: show stderr to user, but continue with tool call

# Configuration
readonly MAX_PAYLOAD_SIZE=10240 # 10KB limit for security
readonly SCRIPT_NAME="$(basename "$0")"
readonly DEBUG="${DEBUG:-false}"

# Global variables (parsed from input)
declare -g TOOL_NAME=""
declare -g COMMAND=""

# Logging functions
log_debug() {
    [[ "$DEBUG" == "true" ]] && echo "DEBUG [$SCRIPT_NAME]: $*" >&2
}

log_error() {
    echo "ERROR [$SCRIPT_NAME]: $*" >&2
}

# Check dependencies
check_dependencies() {
    local deps=("jq")
    local missing=()

    for dep in "${deps[@]}"; do
        if ! command -v "$dep" >/dev/null 2>&1; then
            missing+=("$dep")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing[*]}"
        log_error "Please install: sudo apt-get install ${missing[*]}"
        exit 3
    fi
}

# Parse command payload with security checks
parse_command_payload() {
    local payload=""
    local char
    local count=0

    # Read stdin with size limit for security
    while IFS= read -r -n1 char; do
        ((count++))
        if [[ $count -gt $MAX_PAYLOAD_SIZE ]]; then
            log_error "Payload exceeds maximum size limit ($MAX_PAYLOAD_SIZE bytes)"
            exit 3
        fi
        payload+="$char"
    done

    # Validate JSON format
    if ! echo "$payload" | jq . >/dev/null 2>&1; then
        log_error "Invalid JSON payload received"
        exit 3
    fi

    # Parse tool name and command with error handling
    if ! TOOL_NAME=$(echo "$payload" | jq -r '.tool_name // empty' 2>/dev/null); then
        log_error "Failed to parse tool_name from payload"
        exit 3
    fi

    if ! COMMAND=$(echo "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null); then
        log_error "Failed to parse command from payload"
        exit 3
    fi

    if [[ -z "$COMMAND" ]]; then
        log_error "No command supplied in payload"
        log_error "TOOL_NAME: $TOOL_NAME"
        exit 3
    fi

    log_debug "Parsed - Tool: '$TOOL_NAME', Command: '$COMMAND'"
}

# Enhanced command checking with better pattern matching
check_and_block() {
    local command_to_check="$1"
    local pattern="$2"
    local error_msg="${3:-stop and ask the user to review}"

    # Input validation
    if [[ -z "$command_to_check" || -z "$pattern" ]]; then
        log_error "check_and_block: Missing required parameters"
        return 1
    fi

    log_debug "Checking command '$COMMAND' against pattern '$pattern'"

    # Use bash's built-in pattern matching for better performance
    if [[ "$COMMAND" =~ $pattern ]]; then
        log_error "STOP: $command_to_check"
        log_error "  → \"$COMMAND\" matches pattern: $pattern"
        log_error "$error_msg"
        exit 2
    fi

    log_debug "Pattern '$pattern' did not match"
}

# Main execution
main() {
    log_debug "Starting command review process"

    # Check dependencies first
    check_dependencies

    # Parse the incoming payload
    parse_command_payload

    # Command pattern checks
    # Git PR Merge - more comprehensive pattern
    check_and_block \
        "GitHub PR Merge" \
        "gh[[:space:]]+pr[[:space:]]+merge|git[[:space:]]+merge.*origin" \
        "Stop and ask the user to review the PR merge operation."

    # Additional security-sensitive patterns
    check_and_block \
        "System Package Management" \
        "(sudo[[:space:]]+(apt|yum|dnf|pacman|brew)|pip[[:space:]]+install|npm[[:space:]]+install[[:space:]]+-g)" \
        "Stop and ask the user to install the system package."

    log_debug "All checks passed - allowing command execution"
    exit 0
}

# Run main function
main "$@"
