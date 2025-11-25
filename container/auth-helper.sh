#!/bin/bash
# Helper script to authenticate with GitHub using the provided token

GITHUB_TOKEN_FILE="/home/user/.github_token"
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"

auth_github() {
    if [ -f "$GITHUB_TOKEN_FILE" ]; then
        GITHUB_TOKEN=$(cat "$GITHUB_TOKEN_FILE")
        
        if [ -n "$GITHUB_TOKEN" ]; then
            echo "Authenticating with GitHub..."
            echo "$GITHUB_TOKEN" | gh auth login --with-token
            
            if [ $? -eq 0 ]; then
                echo "✓ Successfully authenticated with GitHub"
                
                # Install Copilot extension if not installed
                if ! gh extension list | grep -q "gh-copilot"; then
                    echo "Installing GitHub Copilot CLI extension..."
                    gh extension install github/gh-copilot
                fi
                
                return 0
            else
                echo "✗ Failed to authenticate with GitHub"
                return 1
            fi
        fi
    fi
    
    echo "No GitHub token found. Please run: gh auth login"
    return 1
}

refresh_token() {
    SSH_TOKEN="${SSH_TOKEN:-}"
    
    if [ -n "$SSH_TOKEN" ]; then
        echo "Refreshing token from web service..."
        RESPONSE=$(curl -s -H "X-SSH-Token: $SSH_TOKEN" "${API_BASE_URL}/api/verify-token")
        
        if echo "$RESPONSE" | jq -e '.valid' > /dev/null 2>&1; then
            GITHUB_TOKEN=$(echo "$RESPONSE" | jq -r '.githubToken')
            echo "$GITHUB_TOKEN" > "$GITHUB_TOKEN_FILE"
            chmod 600 "$GITHUB_TOKEN_FILE"
            echo "Token refreshed successfully"
            auth_github
        else
            echo "Failed to refresh token"
            return 1
        fi
    else
        echo "No SSH token available for refresh"
        return 1
    fi
}

status() {
    echo "=== GitHub Authentication Status ==="
    gh auth status
    echo ""
    echo "=== Copilot Extension Status ==="
    if gh extension list | grep -q "gh-copilot"; then
        echo "✓ Copilot extension installed"
    else
        echo "✗ Copilot extension not installed"
    fi
}

case "$1" in
    auth)
        auth_github
        ;;
    refresh)
        refresh_token
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: auth-helper.sh {auth|refresh|status}"
        echo ""
        echo "Commands:"
        echo "  auth    - Authenticate with GitHub using stored token"
        echo "  refresh - Refresh token from web service"
        echo "  status  - Show authentication status"
        exit 1
        ;;
esac
