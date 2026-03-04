# OpenClaw Agent Usage Guide

Welcome to **ClawControl**, the central mission control and dashboard for OpenClaw agents. As an autonomous agent, you are running in an environment managed and monitored by this dashboard. 

Here is how you interact with the system and utilize its features:

## 1. Reading Your Configuration
Your environment variables and settings are centrally managed by ClawControl. You should read your configuration from the `openclaw.json` file.
- The path to this file is provided in the `OPENCLAW_DIR` environment variable. By default, this is usually `~/.openclaw` or the root of your workspace.
- The `openclaw.json` file contains information about available LLM providers, your agent configuration, and other system settings.
- **Dynamic Updates**: If the user updates the config in the dashboard, the changes are saved to this file. Make sure you reload or parse this file periodically or on startup.

## 2. Connecting to the Gateway WebSocket
ClawControl runs an **OpenClaw Gateway** that handles live event telemetry, chat routing, and proxying.
- **Gateway URL**: Use the `OPENCLAW_GATEWAY_URL` environment variable to determine where to connect. (e.g., `ws://localhost:18789`).
- **Gateway Token**: Use the `OPENCLAW_GATEWAY_TOKEN` environment variable for authentication.
- **Connection**: Connect your WebSocket client to this URL. Important: If you see the URL starts with `ws://` but you are running inside a container trying to reach the host, or if you are connecting over Tailscale, ensure your WebSocket client allows self-signed certificates (e.g., `rejectUnauthorized: false` in Node.js or `verify_mode=ssl.CERT_NONE` in Python).

## 3. Reporting Events & Activity
Once connected to the Gateway, you must report your activities so the user can see what you are doing in the **Live Feed** and **3D Office**.
- Send JSON messages to the WebSocket gateway in the following structure:
  ```json
  {
    "type": "event_type",
    "payload": {
       "agent_id": "your_unique_id",
       "message": "What you are currently doing"
    }
  }
  ```
- **Updating Status**: To reflect your activity in the 3D office, send status updates. Valid statuses include: `active`, `busy`, `standby`, `idle`, `offline`, or `error`.
  ```json
  {
    "type": "STATUS_UPDATE",
    "payload": { "agent_id": "your_id", "status": "active", "message": "Analyzing logs" }
  }
  ```

## 4. Reading and Writing Memory
ClawControl provides a centralized **Memory System**. You should use the API to read and write context.
- The memory API is located at `http://<DASHBOARD_IP>:<DASHBOARD_PORT>/api/memory`.
- **Write Memory**: Send a `POST` request to store important facts, keys, or summarized findings.
- **Read/Search Memory**: Send a `GET` request to `/api/memory` or `/api/search?q=your_query` to retrieve context from previous sessions. This is critical for maintaining long-term context beyond your immediate context window.

## 5. Using the Kanban Mission Queue
Tasks are assigned to you by the user via the **Mission Queue** (Kanban board).
- You can query `GET /api/tasks` to check for tasks assigned to your `agent_id` or tasks that are in the `PLANNING` or `TODO` columns.
- When you begin a task, send a `PUT /api/tasks/:id` request to update its status to `IN_PROGRESS` or `EXECUTION`.
- When you finish, update the status to `DONE` or `VERIFICATION`, and add the results to the task's `deliverables` array.

## 6. Sending Notifications to the User
If you require human intervention, approval, or want to alert the user of a completed milestone, use the Notification system.
- Send a `POST /api/notifications` request with a `title` and `body`.
- The user will see a red badge on the bell icon in their dashboard. Keep the body concise.

## 7. Using the Internal API Proxy
If configured, you can route your LLM calls through the ClawControl API Gateway proxy. This allows the dashboard to track your token usage, manage load balancing, and handle provider fallbacks.
- Check `openclaw.json` or query `/api/providers` to see the available models proxy.
- Point your LLM client base URL to the ClawControl proxy endpoint (e.g., `http://localhost:7000/api/proxy/chat`). Use your assigned `agent_id` so the system can track your usage.

## 8. 3D Office Routing
The dashboard renders you inside a 3D Office. Your placement is determined by your `role`.
- `developer`, `coder`, `engineer` → **Coding Zone**
- `qa`, `tester`, `debug` → **Debugger Zone**
- `artist`, `creative`, `design` → **Art Studio**
- `researcher`, `search`, `scout` → **Explorer Zone**
- `finance`, `economist`, `analyst` → **Economist Zone**
- `writer`, `author`, `content` → **Writer Zone**
- `security`, `guard`, `maintenance` → **Security Zone**
- `orchestrator`, `manager`, `boss` → **Management Zone (Whiteboard)**
- If your status is `idle`, you move to the Lounge. If `offline`, you move to the Bedroom. Update your status accurately to be represented correctly!
