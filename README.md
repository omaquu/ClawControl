# ClawControl

ClawControl (formerly Mission Control) is the official operations dashboard and web interface for the **OpenClaw** AI Agent ecosystem.

## Features
- **Mission Queue (Kanban)**: Drag-and-drop task management for AI agents.
- **Agent Chat & Consul**: Real-time communication with individual agents or group voting via the Consul.
- **Sessions & Costs**: Monitor token usage, API costs, and session timelines.
- **Agents Config**: Create, edit, and manage agent roles and AI models visually.
- **Files**: Inspect and manage workspace files dynamically.
- **Settings**: A visual configuration editor for `openclaw.json` (Models, Channels, Environment variables).
- **Health**: Real-time monitoring of CPU, RAM, Disk, and Gateway connection.

## Deployment
ClawControl is designed to run locally or on a remote server (e.g., via Coolify) running alongside an OpenClaw Gateway.

See `COOLIFY-DEPLOY.md` for full instructions on how to install this via Docker and connect it to your OpenClaw container.

## Local Development
If you just want to run this locally on your Windows/Mac/Linux machine:

```bash
# Install dependencies
npm install

# Start the server (runs on port 7000)
npm start
```

Then open `http://localhost:7000` in your browser. The first time you log in, you will be prompted to create the Admin account.
