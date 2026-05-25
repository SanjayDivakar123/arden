# Arden

**Autonomous AI agent framework.** Deploy persistent agents that live in WhatsApp, Telegram, and more — with full system access, web automation, email, calendar, finance, smart devices, and self-evolving skills.

## Install

```bash
npm install -g ardenai
```

## Quick Start

```bash
arden onboard   # configure your agent
arden deploy    # deploy to your VPS
```

To remove the local agent and start over:

```bash
arden erase     # delete local agent state, credentials, memory, auth, and schedules
arden onboard   # build a new agent
```

## Features

### 🤖 Core Autonomous Actions
- **Shell & File Access** — execute commands, read/write files, automate processes
- **Web Automation** — navigate sites, fill forms, extract data, take screenshots via Playwright
- **Smart Device Control** — control Home Assistant devices, call any local API
- **Finance** — real-time stock/crypto prices, portfolio tracking, financial news

### 📅 Personal & Daily Administration
- **Morning Briefings** — scan calendar, email, and tasks; receive a daily summary
- **Calendar Management** — create, update, delete events; coordinate across time zones
- **Inbox Triage** — list, read, send, and reply to emails automatically

### 🧠 Memory, Skills & Self-Evolution
- **Persistent Memory** — SOUL.md, MEMORY.md, AGENTS.md, daily logs
- **Skills System** — save and load skill files; extend the agent without code
- **Cron Scheduling** — trigger tasks on a schedule (e.g. daily briefing at 7am)

### ✍️ Content Creation & Research
- **Content Drafting** — save posts, newsletters, threads, and scripts to disk
- **Web Research** — search the web, research people and companies automatically

### 📱 Channels
- WhatsApp
- Telegram
- REST API + WebSocket gateway

## Requirements

- Node.js 22+
- Anthropic or OpenAI API key
- VPS for deployment (Ubuntu 22+ recommended)

## Configuration

After `arden onboard`, your agent is configured via:
- `workspace/SOUL.md` — agent personality and instructions
- `workspace/AGENTS.md` — multi-agent routing rules
- `workspace/MEMORY.md` — long-term memory
- `arden.config.json` — model, channels, cron settings
- `.env` — API keys and secrets

## Environment Variables

```env
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
TELEGRAM_BOT_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
HOME_ASSISTANT_URL=
HOME_ASSISTANT_TOKEN=
```

## License

MIT
