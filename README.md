# TransCheck Bot

[![Node.js CI](https://github.com/akoody/transcheck-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/akoody/transcheck-bot/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Production-minded Telegram bot for tracking USDT transfers across BEP20 (BNB Smart Chain) and TRC20 (TRON) wallets. It is designed for operators who need fast wallet onboarding, clear alerts, and resilient blockchain API polling.

## What It Does

- Monitors incoming and outgoing USDT transfers for multiple wallets per Telegram user.
- Supports BEP20 and TRC20 with network-specific validation and explorer links.
- Sends HTML-formatted Telegram alerts with wallet name, amount, counterparty, and transaction link.
- Keeps per-user thresholds, wallet aliases, and seen transactions in a local JSON state file.
- Uses RPC-first BSC scanning with fallback RPC pools, optional explorer fallback, retries, cooldowns, and rate-limit handling.
- Provides Telegram command and button flows for wallet management, manual scans, thresholds, and status checks.

## Tech Stack

- Node.js 20+
- CommonJS modules
- `node-telegram-bot-api` for Telegram long polling
- `axios` for BSC/TRON API clients
- Local JSON persistence with serialized, atomic writes (temp file + rename)
- `node:test` unit tests and GitHub Actions CI

## Architecture

```text
src/
  bot/                 Telegram commands, menus, callback flows
  chains/              BSC and TRON blockchain clients
  config/              Environment parsing and runtime config
  repositories/        State persistence abstraction
  services/            Monitoring orchestration and alert delivery
  utils/               Formatting, validation, constants
```

The runtime flow is intentionally simple: Telegram handlers update user state, `MonitorService` polls configured wallets, chain clients normalize transactions, and the repository stores thresholds plus deduplication markers.

## Getting Started

```bash
npm ci
cp .env.example .env
npm run check
npm start
```

Required environment:

```bash
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

Optional API keys improve reliability and limits:

```bash
ETHERSCAN_API_KEY=
BSCSCAN_API_KEY=
TRONGRID_API_KEY=
ANKR_API_KEY=
NODEREAL_API_KEY=
```

## Telegram Commands

| Command | Purpose |
| --- | --- |
| `/add <network> <address> <name>` | Add a BEP20 or TRC20 wallet |
| `/add_bep20 <address> <name>` | Add a BSC wallet |
| `/add_trc20 <address> <name>` | Add a TRON wallet |
| `/wallets` | Show tracked wallets |
| `/rename <wallet_id> <name>` | Rename a wallet |
| `/remove <wallet_id>` | Remove a wallet |
| `/threshold <usd>` | Set alert threshold |
| `/status` | Show monitor statistics |
| `/scan_now` | Run an immediate scan |
| `/menu` | Show Telegram keyboard |
| `/cancel` | Cancel the active flow |

## Configuration Notes

- `.env` is intentionally ignored by git.
- `data/state.json` is ignored because it contains runtime user state.
- The default BSC mode scans Transfer logs through RPC endpoints.
- `BSC_USE_EXPLORER_FALLBACK=true` enables BscScan/Etherscan fallback after RPC failures.
- Cooldown settings are exposed to keep the bot stable under API limits and temporary provider outages.

## Quality Checks

```bash
npm run check
```

`npm run check` validates the syntax of every file under `src/` and runs the unit tests in `test/` with the built-in `node:test` runner (no extra dependencies). The tests cover address validation per network, alert formatting and HTML escaping, state persistence (ids, seen-transaction cap, atomic writes, recovery after a failed write) and the monitor loop with fake chain clients: threshold and `watchFromMs` filtering, incoming/outgoing detection, no duplicate alerts, retry when Telegram delivery fails and per-wallet backoff after API errors.

CI runs `npm ci` and `npm run check` on every pull request and push to `main`.

## License

MIT
