#!/bin/bash

# Script to generate SSH key and add it to GitHub
# This script is run when the dev container is created

set -e

SSH_KEY_PATH="$HOME/.ssh/id_ed25519"
SSH_KEY_TITLE="Pocket Console Dev Container $(date +%Y-%m-%d)"

echo "🔑 Setting up SSH key for GitHub..."

# Check if SSH key already exists
if [ -f "$SSH_KEY_PATH" ]; then
    echo "✓ SSH key already exists at $SSH_KEY_PATH"
else
    echo "📝 Generating new SSH key..."
    ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "devcontainer@pocket-console"
    echo "✓ SSH key generated"
fi

# Start SSH agent if not running
if [ -z "$SSH_AUTH_SOCK" ]; then
    echo "🚀 Starting SSH agent..."
    eval "$(ssh-agent -s)"
fi

# Add key to SSH agent
ssh-add "$SSH_KEY_PATH" 2>/dev/null || true

# Check if gh CLI is authenticated
if ! gh auth status &>/dev/null; then
    echo ""
    echo "⚠️  GitHub CLI is not authenticated!"
    echo "Please run: gh auth login"
    echo "Then run this script again to add your SSH key to GitHub."
    exit 0
fi

# Get the public key
SSH_PUBLIC_KEY=$(cat "${SSH_KEY_PATH}.pub")

# Check if this key is already added to GitHub
echo "🔍 Checking if SSH key is already added to GitHub..."
EXISTING_KEYS=$(gh ssh-key list --json key,title || echo "[]")

if echo "$EXISTING_KEYS" | jq -r '.[].key' | grep -q "${SSH_PUBLIC_KEY%% *}"; then
    echo "✓ SSH key is already added to your GitHub account"
else
    echo "📤 Adding SSH key to GitHub..."
    echo "$SSH_PUBLIC_KEY" | gh ssh-key add --title "$SSH_KEY_TITLE" -
    echo "✓ SSH key added to GitHub successfully!"
fi

# Configure git to use SSH
echo "🔧 Configuring git to use SSH..."
git config --global url."git@github.com:".insteadOf "https://github.com/"

# Test SSH connection
echo ""
echo "🧪 Testing SSH connection to GitHub..."
if ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
    echo "✅ SSH connection to GitHub is working!"
else
    echo "⚠️  SSH test failed. You may need to check your configuration."
fi

echo ""
echo "🎉 SSH setup complete!"
echo ""
echo "Your SSH public key:"
echo "$SSH_PUBLIC_KEY"
echo ""