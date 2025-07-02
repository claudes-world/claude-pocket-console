#!/usr/bin/env bash
set -euo pipefail
# Validate commands before execution - security hook for Claude Code

# This script is called by Claude Code hooks before executing bash commands
# It should validate that commands are safe to execute in our environment

# Read the entire JSON payload from stdin
read -r -d '' PAYLOAD || true

# Parse tool name and command
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$PAYLOAD")
COMMAND=$(jq -r '.tool_input.command // empty' <<<"$PAYLOAD")

echo "TOOL_NAME: $TOOL_NAME"
echo "COMMAND: $COMMAND"

if [[ -z "$COMMAND" ]]; then
    echo "ERROR: No command supplied" >&2
    # exit >2: show stderr to user, but continue with tool call
    exit 3
fi

# Define patterns that should be blocked
BLOCKED_PATTERNS=(
    # Total‐wipe / disk‐writes
    '^rm[[:space:]]+-rf[[:space:]]+/$'
    'dd[[:space:]]+if=/dev/zero'
    'dd[[:space:]]+if=.*[[:space:]]+of=/dev/[hs]d[a-z]'
    'mkfs\.(ext[234]|xfs|btrfs|fat|ntfs)'
    'wipefs'
    'shred'
    '(parted|fdisk|sgdisk)'

    # Raw‐device redirections
    '>[[:space:]]*/dev/sd[a-z]'

    # Privileged / volume‐mount tricks
    'docker.*--privileged'
    'docker.*-v.*/:/.*'

    # Shutdown / reboot / kernel panic
    '(^|\s)(shutdown|reboot|halt|poweroff)(\s|$)'
    '(^|\s)init[[:space:]]+0|telinit[[:space:]]+0'
    'systemctl .*(reboot|halt|poweroff)'
    'echo[[:space:]]+c[[:space:]]*>[[:space:]]*/proc/sysrq-trigger'

    # File‐permission lockouts
    'chmod[[:space:]].*0+[0-7]*'
    'chown[[:space:]]+-R[[:space:]]+root:root[[:space:]]+/'
    'chattr[[:space:]]+\+i[[:space:]]+/'

    # User / group tampering
    '(usermod|useradd|userdel|groupadd|groupdel|passwd)(\s|$)'
    'sudo.*(\s|^)su(\s|$)'

    # Remote code execution
    'curl.*\|\s*bash'
    'wget.*\|\s*sh'
    '(perl[[:space:]]+-e|python[[:space:]]+-c|ruby[[:space:]]+-e)'
    'nc.*-e[[:space:]]*/bin/sh'
    'bash[[:space:]]+-i[[:space:]]+>&[[:space:]]*/dev/tcp/'

    # Firewall / networking nukes
    'iptables.*-F'
    'ip6tables.*-F'
    '(ifconfig|ip link set).*(down|delete)'
)

# run through the blacklist
for pat in "${BLOCKED_PATTERNS[@]}"; do
    if echo "$COMMAND" | grep -qE "$pat"; then
        echo "ERROR: Command blocked by security policy." >&2
        echo "  → \"$COMMAND\" matches pattern: $pat" >&2
        # exit code 2: show stderr to model and block the tool call
        exit 2
    fi
done

# (Optional) further hooks:
#  - verify docker images against an allowlist
#  - forbid access to /etc/shadow, /root, etc.
#  - ensure PWD is under /home/your-project/…
#
# Audit log (make sure this file is only writable by root)
LOGFILE="${HOME}/.claude/claude_code_audit.log"
# mkdir -p "$(dirname "$LOGFILE")"
echo "$(date '+%F %T') : $COMMAND" >>"$LOGFILE"

# All clear
exit 0
