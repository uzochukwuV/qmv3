# TradeBook

TradeBook is our UXmaxx Hackathon entry: a consumer-grade sports betting app for end users, built on Arbitrum Sepolia with Magic embedded wallets and a contract-backed odds/LP flow.

## Hackathon position

We are entering the General Track.

That choice matches the product we are actually shipping: a polished consumer app with low-friction onboarding, real onchain market data, a faucet for test funds, and a liquidity-provider flow driven by epochs.

We are also aligned with the hackathon's bonus directions:

- Magic Labs bonus: embedded wallet onboarding is wired into the frontend.
- Arbitrum bounty: the contracts and bot flow target Arbitrum Sepolia.

## What the app does

- Users sign in with Magic instead of a browser wallet extension.
- The dashboard loads real onchain groups, markets, odds, LP stats, and epoch state.
- The odds table is sports-style: one match per row, with the 3-market book shown inline.
- The bet slip enforces the contract rules in the UI.
- A faucet modal mints mock USDC for testing bets and LP flows.
- The LP page is epoch-driven and shows the active group/market book.
- A bot can bootstrap new epochs and create the canonical 3-market book for a match.

## Current contract and frontend stack

- Solidity 0.8.28 + Hardhat 3 + viem
- Arbitrum Sepolia deployment target
- Magic embedded wallets in the frontend
- Bot-driven market creation and faucet services
- Real contract snapshot loading in the dashboard

## Repo layout

- `contracts/` — Solidity contracts, libraries, and types
- `bot/` — market sync, bootstrap, settlement, and faucet services
- `frontend/` — React/Vite app
- `test/` — contract and integration tests
- `group_market_architecture.md` — original architecture reference
- `solidity_flow.md` — simplified Solidity flow we are keeping now
- `TSODDS.md` — Txodds integration notes

## Setup

Install dependencies:

```shell
npm install
```

Compile contracts:

```shell
npx hardhat compile
```

Run tests:

```shell
npx hardhat test
```

Build the frontend:

```shell
cd frontend
npm run build
```

## Bot commands

Start the faucet service:

```shell
npm run bot:faucet
```

Bootstrap the next epoch and canonical 3-market book:

```shell
npm run bot:bootstrap-epoch
```

Sync markets from Txodds:

```shell
npm run bot:sync-markets
```

## Notes

- Markets currently load from the deployed contract snapshot, not mock data.
- The contract flow is intentionally narrower than the original architecture draft: exactly 3 markets per group, group-level 9-state pricing, a single settlement authority, and LP epoch controls.
- The README is focused on the hackathon version of the product, not the older experimental design.
