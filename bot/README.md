# Bot workers

This folder has two separate Node.js jobs.

- market sync: fetch available Txodds fixtures, create the 3-market football group, seed pricing, and post odds proofs
- settlement: settle already-mapped fixtures from finalized Txodds scores

## Required env

- ARBITRUM_SEPOLIA_RPC_URL
- ARBITRUM_SEPOLIA_PRIVATE_KEY
- VITE_CORE_ADDRESS
- TXODDS_API_KEY or TXODDS_API_TOKEN
- TXODDS_NETWORK (mainnet or devnet, default mainnet)

## Txodds auth flow

Txodds uses a guest JWT from `/auth/guest/start`, and the data APIs expect an `X-Api-Token` header as documented in the quickstart.

For this bot, you can either:

- export an already activated token as `TXODDS_API_TOKEN`, or
- keep using `TXODDS_API_KEY` as a local alias if you already wired it that way in your env

The bot will always fetch a guest JWT, then call the snapshot endpoints with both headers.

## Market sync bot

The sync bot looks at upcoming soccer/football fixtures, builds the canonical 3-market book for each one, and posts the Txodds odds proof hash onchain for each market.

Useful flags:

- --limit=3
- --days=3
- --minStartBufferSeconds=3600
- --state=bot/market-sync.json

Run it with:

```bash
npm.cmd run bot:sync-markets
```

It will create the group if the fixture is not already in the local state file, then post odds to:

- Full-Time Result
- Over / Under 2.5
- Both Teams To Score

## Settlement bot

The older settlement worker is still available for mapped fixtures:

```bash
npm.cmd run bot:settle -- --mode=sync
```
