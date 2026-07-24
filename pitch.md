# TradeBook pitch

TradeBook is a consumer sports betting app for the UXmaxx Hackathon. It is built for end users, not protocol developers: Magic embedded wallets handle sign-in, the dashboard loads real onchain odds and market groups, and a faucet/modal flow keeps the demo usable without real funds.

## Hackathon position

We are submitting to the General Track.

That is the right fit because the project is about product quality and user experience first: a sports-style betting interface, real contract-backed market data, and a clean LP flow that normal users can understand quickly.

We also qualify for the hackathon's bonus directions:

- Magic Labs bonus: the frontend uses Magic embedded wallets.
- Arbitrum bounty: the contracts and bot flow are built around Arbitrum Sepolia.

## What we built

- A sports-book style dashboard where one match occupies one row and all 3 markets appear inline.
- Contract-backed odds tables, live match cards, and LP stats.
- A bet slip that enforces the contract rules in the UI.
- A faucet modal for daily mock USDC minting.
- An epoch-driven LP page.
- A bot service that can bootstrap the next epoch and create the canonical 3-market group for a match.

## Why it matters

Most onchain betting interfaces feel like protocol dashboards. TradeBook is trying to feel like a real sportsbook:

- one login with Magic,
- real market data on load,
- no mock dashboard content,
- one-row match presentation,
- and a clean LP experience that maps to epochs instead of abstract contract state.

## Demo flow

1. Sign in with Magic.
2. Open the faucet and mint mock USDC.
3. Load the dashboard and inspect real groups/markets/odds.
4. Add selections to the bet slip and see the payout/bonus preview.
5. Visit the LP page and inspect the current epoch.
6. Run the bot to bootstrap the next match group if needed.

## Current status

- Frontend is wired to real contract reads.
- The dashboard is no longer mock-driven.
- The faucet and LP page are wired in.
- The bot can create the next epoch and canonical 3-market book.
- The contracts are deployed on Arbitrum Sepolia.

## Setup

```shell
npm install
npx hardhat compile
cd frontend
npm run build
```

Bot commands:

```shell
npm run bot:faucet
npm run bot:bootstrap-epoch
npm run bot:sync-markets
```
