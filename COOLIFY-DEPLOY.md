# Deploying ClawControl + OpenClaw via Coolify

This guide explains how to deploy **ClawControl** alongside your existing **OpenClaw** gateway on a server using Coolify.

## Prerequisites

1. You have a server with **Coolify** installed.
2. You have a domain or subdomain ready (e.g., `mc.yourdomain.com`).
3. You have an **OpenClaw** gateway running in another Docker container (either deployed via Coolify or standalone Docker).

---

## Step 1: Push this project to a Git Repository

Coolify works best by pulling from a Git repository (GitHub/GitLab/Gitea). 
Commit this entire `frozen-ionosphere` folder to a private GitHub repository.

```bash
git init
git add .
git commit -m "Initial ClawControl commit"
# Push to GitHub
```

## Step 2: Create a new Resource in Coolify

1. Open your Coolify Dashboard.
2. Go to your Project -> Environment.
3. Click **+ New Resource**.
4. Select **Public Repository** (or Private if you linked your GitHub account to Coolify).
5. Enter the URL of your repository and select the branch (e.g., `main`).

## Step 3: Configure the Build Settings

Coolify will automatically detect the **Dockerfile** in the repository root.

1. **Build Pack**: Ensure it is set to `Docker`.
2. **Ports Exposes**: Set to `7000`.
3. **Domains**: Enter your public domain URL, e.g., `https://mc.yourdomain.com`.

## Step 4: Configure Data Volumes (Crucial)

ClawControl needs persistent storage for its SQLite database and the `workspace` directory (where OpenClaw config and files live).

Under the **Storage** tab in your Coolify service settings, add two volumes:

1. **Database Volume:**
   - Name: `mc_data`
   - Destination Path: `/data`

2. **Workspace Volume:**
   - Name: `mc_workspace`
   - Destination Path: `/workspace`

*Note: The `/data` folder holds `clawcontrol.db` and audit logs. The `/workspace` folder holds `openclaw.json` and any files the agents manipulate.*

## Step 5: Environment Variables

Under the **Environment Variables** tab in Coolify, add the following required variables:

```ini
NODE_ENV=production
PORT=7000
DATABASE_PATH=/data/clawcontrol.db
WORKSPACE_DIR=/workspace
OPENCLAW_DIR=/workspace
# Set this to true to allow logins over HTTPS proxied by Coolify (Coolify handles SSL, but the inner container sees HTTP)
DASHBOARD_ALLOW_HTTP=true

# Security (Optional but recommended to set)
MC_API_TOKEN=your_secure_random_string
WEBHOOK_SECRET=another_secure_string
```

### 🔗 Connecting to OpenClaw

To connect ClawControl to your OpenClaw container, you need to set the Gateway URL env var. 
Since both are running on the same server, you have two options:

**Option A: Use internal Docker routing (if both are in the same Coolify network)**
Find the internal container name of your OpenClaw service in Coolify (e.g., `openclaw-xxxx`).
```ini
OPENCLAW_GATEWAY_URL=ws://openclaw-xxxx:18789
OPENCLAW_GATEWAY_TOKEN=the_token_you_set_in_openclaw
```

**Option B: Use the public URL of OpenClaw**
If you expose OpenClaw through a domain (e.g., `wss://gateway.yourdomain.com`), use that:
```ini
OPENCLAW_GATEWAY_URL=wss://gateway.yourdomain.com
OPENCLAW_GATEWAY_TOKEN=the_token_you_set_in_openclaw
```

*(Note: If you run into WebSocket connection issues through the proxy, ClawControl allows you to manually override the Gateway URL directly in the browser via the Settings page!)*

## Step 6: Deploy

1. Click **Deploy** in Coolify.
2. Wait for the Docker image to build and start.
3. Once running, click the link to your domain (e.g., `https://mc.yourdomain.com`).

## First time login & Security

The first time you access the dashboard:
1. You will be greeted by the **Create Account** page.
2. The very first user to register becomes the sole admin.
3. **Mandatory**: Once logged in, go to the **Settings** tab and click **Setup TOTP** to enable Two-Factor Authentication using Google Authenticator or Authy. This secures the dashboard since it's now exposed to the internet.

## Troubleshooting

- **Database Locked / Read-only errors**: Ensure the Coolify storage volumes are working and the container has write permissions to `/data` and `/workspace`.
- **Can't connect to Gateway**: Go to the **Settings** tab inside ClawControl. Look for "Gateway Config". Put your OpenClaw WebSocket URL in the "Client Override URL" box and hit Save. This forces the browser to connect to OpenClaw directly.
- **CSP/Login blocked**: Ensure `DASHBOARD_ALLOW_HTTP=true` is set. Coolify terminates SSL at the reverse proxy (Traefik/Caddy), meaning the Express server sees an HTTP request. Without this environment variable, ClawControl's security checks will block the login.
