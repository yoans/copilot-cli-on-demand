#!/bin/bash
set -e

# Configuration from environment variables
SSH_TOKEN="${SSH_TOKEN:-}"
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

echo "Starting Copilot CLI Container..."

# If SSH_TOKEN is set, verify with the web service and get GitHub token
if [ -n "$SSH_TOKEN" ]; then
    echo "Authenticating with web service..."
    
    # Call web service to verify token and get GitHub credentials
    RESPONSE=$(curl -s -H "X-SSH-Token: $SSH_TOKEN" "${API_BASE_URL}/api/verify-token" || echo '{"valid": false}')
    
    if echo "$RESPONSE" | jq -e '.valid' > /dev/null 2>&1; then
        GITHUB_TOKEN=$(echo "$RESPONSE" | jq -r '.githubToken')
        USERNAME=$(echo "$RESPONSE" | jq -r '.username')
        
        echo "Authenticated as: $USERNAME"
        
        # Configure GitHub CLI for the user
        if [ -n "$GITHUB_TOKEN" ]; then
            echo "$GITHUB_TOKEN" > /home/user/.github_token
            chown user:user /home/user/.github_token
            chmod 600 /home/user/.github_token
            
            # Create gh config for the user
            mkdir -p /home/user/.config/gh
            cat > /home/user/.config/gh/hosts.yml <<EOF
github.com:
    oauth_token: $GITHUB_TOKEN
    user: $USERNAME
    git_protocol: https
EOF
            chown -R user:user /home/user/.config
            chmod 600 /home/user/.config/gh/hosts.yml
            
            echo "GitHub CLI configured for $USERNAME"
        fi
    else
        echo "Warning: Token verification failed"
    fi
elif [ -n "$GITHUB_TOKEN" ]; then
    # Direct GitHub token provided (for testing)
    echo "$GITHUB_TOKEN" > /home/user/.github_token
    chown user:user /home/user/.github_token
    chmod 600 /home/user/.github_token
    
    # Create gh config for the user
    mkdir -p /home/user/.config/gh
    cat > /home/user/.config/gh/hosts.yml <<EOF
github.com:
    oauth_token: $GITHUB_TOKEN
    user: user
    git_protocol: https
EOF
    chown -R user:user /home/user/.config
    chmod 600 /home/user/.config/gh/hosts.yml
    
    echo "GitHub CLI configured with provided token"
fi

# Generate SSH host keys if they don't exist
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
    ssh-keygen -t rsa -f /etc/ssh/ssh_host_rsa_key -N ''
fi
if [ ! -f /etc/ssh/ssh_host_ecdsa_key ]; then
    ssh-keygen -t ecdsa -f /etc/ssh/ssh_host_ecdsa_key -N ''
fi
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
    ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N ''
fi

# Setup token-based authentication
# For simplicity, we'll use the SSH_TOKEN as a password via PAM
# In production, you'd want public key authentication
if [ -n "$SSH_TOKEN" ]; then
    # Enable password authentication for this session
    sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
    
    # Set user password to SSH_TOKEN
    echo "user:$SSH_TOKEN" | chpasswd
    
    echo "Token-based authentication enabled"
fi

# Create a welcome message
cat > /etc/motd <<'EOF'
╔═══════════════════════════════════════════════════════════════╗
║     Welcome to Copilot CLI On-Demand Container!               ║
║                                                               ║
║  GitHub CLI and Copilot are pre-configured.                   ║
║                                                               ║
║  Try these commands:                                          ║
║    gh copilot suggest "how to list files"                     ║
║    gh copilot explain "git log --oneline"                     ║
║                                                               ║
║  For help: gh copilot --help                                  ║
╚═══════════════════════════════════════════════════════════════╝
EOF

# Create .bashrc additions for user
cat >> /home/user/.bashrc <<'EOF'

# Copilot CLI aliases
alias suggest='gh copilot suggest'
alias explain='gh copilot explain'

# Check GitHub authentication status on login
if command -v gh &> /dev/null; then
    if gh auth status &> /dev/null; then
        echo "✓ GitHub CLI authenticated"
    else
        echo "⚠ GitHub CLI not authenticated. Run: gh auth login"
    fi
fi
EOF

chown user:user /home/user/.bashrc

echo "Starting SSH server..."
exec /usr/sbin/sshd -D -e
