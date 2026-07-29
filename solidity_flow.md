# Solidity Flow - Current Scope

This document describes the Solidity implementation slice that is being built and tested now. It intentionally excludes later backend-heavy or Solana-specific concepts from the broader group architecture draft.

## What Solidity must do now

- Exactly 3 markets per market group.
- Group-level 9-state pricing shared across the 3 markets.
- One canonical match result drives settlement for all 3 markets.
- LP deposit, epoch gating, and withdrawal controls.
- One settlement authority for now.
- Simple slip placement and claim flow only if needed for testing.

## Core on-chain model

A market group represents one football match. Each group contains exactly three correlated markets: 1x2, Over/Under 2.5, and GG/NG.

The group owns the pricing state. Individual markets do not maintain separate pricing models beyond their projected odds.

## Epoch Flow (with Market Declaration Phase)

The epoch lifecycle now has an explicit declaration phase that separates market creation from trading:

1. **`initEpoch()`** — Admin initializes the epoch. Deposit window opens. `marketsDeclared = false`, `tradingOpen = false`.
2. **Declaration Phase** — Admin creates the MarketGroup and individual Markets via `createMarketGroup()` + `createMarket()`. Markets stay in `PreOpen` status. LPs can see what markets exist and decide to deposit.
3. **Deposit Window** — LPs call `addLiquidity()` to deposit USDC and receive LP shares. Deposits are gated by `block.timestamp < epoch.startTime` AND `!tradingOpen`.
4. **`openEpochForTrading()`** — Admin calls this function to transition from declaration to trading. It:
   - Requires `marketsDeclared == true` (markets must be declared first)
   - Requires `block.timestamp >= epoch.startTime` (can't open before start time)
   - Sets `tradingOpen = true`
   - Opens all `PreOpen` markets in the epoch to `Open`
   - Emits `EpochTradingOpened`
5. **Trading Phase** — Bettors call `buyAtOdds()`. Oracle calls `updateOdds()`. Markets can also be individually opened via `openMarket()` or `bulkOpenMarkets()` (both require `tradingOpen == true`).
6. **Settlement** — Oracle proposes group result, markets finalize.
7. **`advanceEpoch()`** — Flips `withdrawalsEnabled`, increments epoch.
8. **Withdrawal** — LPs request and process withdrawals.

## Pricing

The Solidity contract uses a 9-state group model.

- The 3 markets are treated as marginals of the same state space.
- A single pricing update mutates the group state.
- Market odds are derived from the shared group state vector.
- The contract must reject attempts to add a fourth market to the group.

## Settlement

Settlement is group-scoped.

- One canonical match result is proposed for the whole group.
- Finalization maps that result to all 3 markets.
- The contract should not require separate settlement flows for each market.
- The settlement authority is a single operator/oracle for now.

## LP flow

The LP flow is epoch-based.

- LPs opt in before the epoch starts.
- Deposits close when trading opens (either at `startTime` or when `openEpochForTrading()` is called, whichever is later).
- Withdrawals are only allowed after the relevant epoch is eligible.
- Treasury accounting must respect locked payouts and epoch constraints.

## Slip flow

Slip support is optional in this Solidity slice.

If slips are kept for testing, they should remain simple:

- place a slip
- reserve the payout liability
- settle the markets
- claim payout or refund

Do not add the full backend-orchestrated slip architecture here.
Do not add slip PDAs, multi-operator quorum logic, bonus staking, or cancellation pipelines unless those are explicitly part of the current Solidity scope.

## Explicitly out of scope for now

- Slip PDA / backend execution model
- Multi-operator settlement quorum
- Operator staking and slashing
- Slip bonus liability tables
- Per-group vault segregation if the current Solidity treasury model does not need it yet
- Any Solana-specific account model or instruction choreography

## Design rule

When adding Solidity code, prefer the smallest implementation that proves the 3-market group flow end to end.

If a feature exists only to support a later architecture phase, keep it out of the Solidity contracts until it becomes necessary for testing or deployment.
