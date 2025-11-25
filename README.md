# Copilot CLI On-Demand

A system for selling access to on-demand containers with SSH access to run GitHub Copilot CLI. Deploy on Railway with Stripe payment integration.

## Features

- **GitHub OAuth Authentication**: Sign in with GitHub to link your Copilot subscription
- **Stripe Payment Integration**: Accept payments for container access subscriptions
- **On-Demand Containers**: Launch containerized environments with Copilot CLI pre-installed
- **SSH Access**: Secure SSH access to containers with automatic GitHub token propagation
- **Railway Deployment**: Easy deployment to Railway's infrastructure

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web Browser   │────▶│   Web Service   │────▶│    Railway      │
│   (User)        │     │   (Express.js)  │     │    Platform     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                       │
         │                      ▼                       ▼
         │              ┌─────────────────┐     ┌─────────────────┐
         │              │     Stripe      │     │   Container     │
         │              │   (Payments)    │     │  (Copilot CLI)  │
         │              └─────────────────┘     └─────────────────┘
         │                                              │
         └──────────────── SSH Connection ──────────────┘
```

## Project Structure

```
.
├── web/                    # Web application (Express.js)
│   ├── src/
│   │   └── index.js       # Main application
│   ├── views/             # EJS templates
│   │   ├── index.ejs      # Landing page
│   │   ├── dashboard.ejs  # User dashboard
│   │   └── pricing.ejs    # Pricing page
│   ├── public/            # Static assets
│   ├── package.json       # Node.js dependencies
│   ├── railway.json       # Railway deployment config
│   └── .env.example       # Environment variables template
├── container/             # Container image for Copilot CLI
│   ├── Dockerfile         # Container definition
│   ├── entrypoint.sh      # Container startup script
│   ├── auth-helper.sh     # Authentication helper
│   └── railway.json       # Railway deployment config
└── README.md              # This file
```

## Prerequisites

1. **GitHub OAuth Application**: Create at [GitHub Developer Settings](https://github.com/settings/developers)
2. **Stripe Account**: Create at [Stripe](https://stripe.com) and get API keys
3. **Railway Account**: Create at [Railway](https://railway.app)
4. **GitHub Copilot Subscription**: Users need an active Copilot subscription

## Configuration

### Environment Variables

Copy `web/.env.example` to `web/.env` and configure:

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `GITHUB_CALLBACK_URL` | OAuth callback URL |
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_...) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (pk_...) |
| `STRIPE_PRICE_ID` | Stripe Price ID for subscription |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `SESSION_SECRET` | Express session secret |
| `RAILWAY_API_TOKEN` | Railway API token |
| `RAILWAY_PROJECT_ID` | Railway project ID |
| `APP_BASE_URL` | Application base URL |
| `CONTAINER_IMAGE` | Container image URL |

### Stripe Setup

1. Create a Product in Stripe Dashboard
2. Add a Price (e.g., $19/month)
3. Copy the Price ID to `STRIPE_PRICE_ID`
4. Set up webhook endpoint at `/webhook/stripe`
5. Enable `customer.subscription.updated` and `customer.subscription.deleted` events

### GitHub OAuth Setup

1. Go to GitHub Developer Settings > OAuth Apps
2. Create a new OAuth App
3. Set Homepage URL to your app URL
4. Set Authorization callback URL to `{APP_BASE_URL}/auth/github/callback`
5. Copy Client ID and Client Secret

## Local Development

```bash
# Install dependencies
cd web
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your configuration

# Start development server
npm run dev
```

Visit `http://localhost:3000` in your browser.

## Deployment to Railway

### Deploy Web Application

```bash
# Using Railway CLI
cd web
railway login
railway init
railway up

# Or connect GitHub repo in Railway dashboard
```

### Deploy Container Image

The container can be built and pushed to a container registry:

```bash
cd container
docker build -t ghcr.io/yourusername/copilot-cli-container:latest .
docker push ghcr.io/yourusername/copilot-cli-container:latest
```

### Railway Project Structure

For production, set up a Railway project with:
1. **Web Service**: Deploy the `web/` directory
2. **PostgreSQL**: For production database (optional, SQLite works for small scale)

## Usage

### For End Users

1. Visit the web application
2. Sign in with GitHub (must have Copilot subscription)
3. Subscribe via Stripe
4. Launch a container from the dashboard
5. SSH into the container using provided credentials
6. Use Copilot CLI:
   ```bash
   gh copilot suggest "how to find large files in git"
   gh copilot explain "tar -xzvf archive.tar.gz"
   ```

### SSH Connection

After launching a container, connect via SSH:

```bash
ssh -p <port> user@<host>
# Password: <ssh_token from dashboard>
```

The container will have:
- GitHub CLI pre-authenticated with your account
- Copilot CLI extension installed
- Common development tools

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Landing page |
| `/auth/github` | GET | Start GitHub OAuth |
| `/auth/github/callback` | GET | OAuth callback |
| `/dashboard` | GET | User dashboard |
| `/pricing` | GET | Pricing page |
| `/create-checkout-session` | POST | Create Stripe checkout |
| `/subscription/success` | GET | Subscription success |
| `/webhook/stripe` | POST | Stripe webhooks |
| `/containers/create` | POST | Create new container |
| `/containers/:id` | GET | Get container details |
| `/containers/:id` | DELETE | Delete container |
| `/api/verify-token` | GET | Verify SSH token |
| `/health` | GET | Health check |

## Security Considerations

- GitHub tokens are stored encrypted in the database
- SSH tokens are unique per container session
- Stripe webhook signatures are verified
- Sessions use secure cookies in production
- Container access expires after 24 hours

## License

MIT