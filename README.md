# qmv3

QuadraticMarket v3 is a Hardhat 3 + viem Solidity project for a decentralized fixed-odds sports betting protocol. The current contracts implement an LP-backed sportsbook model, not the original LMSR/sample Counter design.

## What Is In This Repo

- `contracts/QuadraticMarket.sol` - deployed protocol entrypoint: admin/operator controls, epoch lifecycle, market creation, odds updates, single bets, settlement, and claims.
- `contracts/QuadraticLP.sol` - LP vault, epoch deposits, withdrawal queue, and category voting.
- `contracts/QuadraticSlips.sol` - multi-leg accumulator slips with transferable ownership and slip settlement.
- `contracts/QuadraticMarketStorage.sol` - shared storage, modifiers, accounting views, and exposure helpers.
- `contracts/interfaces/ITypes.sol` - protocol enums, structs, events, errors, and create/config parameter types.
- `contracts/libraries/LibOdds.sol` - decimal fixed-odds math, odds deviation checks, volume caps, and epoch exposure math.
- `contracts/libraries/LibGroupDiscount.sol` - same-match parlay correlation discount and cross-match bonus logic.
- `contracts/libraries/LibSlip.sol` - slip settlement helper logic split out to reduce main bytecode size.
- `contracts/mocks/MockUSDC.sol` - test-only 6-decimal ERC20 used by lifecycle tests.
- `hardhat.config.ts` - Hardhat 3 config using `@nomicfoundation/hardhat-toolbox-viem`.
- `test/QuadraticMarket.lifecycle.ts` - end-to-end protocol lifecycle coverage.
- `Claude1.md`, `Claude2.md`, `Claude3.md` - historical architecture notes and model-analysis transcripts.

## Protocol Model

The protocol uses semi-static fixed odds:

1. LPs deposit base token liquidity into an epoch before `epoch.startTime`.
2. LPs can vote on preferred `SportCategory` for that epoch.
3. Operators create event-level `MarketGroup` records and individual markets inside those groups.
4. Oracle-signed `oddsAnchor` values initialize each market's `currentOdds`.
5. Operators can update odds before event start using oracle-signed payloads, subject to `maxDeviationBps`.
6. Bettors place single-outcome bets with `buyAtOdds()` or multi-leg slips with `placeSlip()`.
7. Payout liability is capped by per-outcome `volumeCap` and epoch-level `maxExposureMultiplierBps`.
8. Oracle proposes results, the challenge window passes, markets finalize, and winners claim.
9. Once epoch markets settle, LPs can queue and process withdrawals after cooldown.

Odds use decimal odds scaled by `ODDS_PRECISION = 1_000_000`, so `2.80` is stored as `2_800_000`.

## Important Contracts And Flows

### Epochs And LPs

- `initEpoch(epochStartTime, maxExposureMultiplierBps)` opens a deposit window.
- `addLiquidity(amount)` is only accepted before `epoch.startTime`.
- `voteCategory(category)` records one weighted category vote per LP per epoch.
- `advanceEpoch()` requires all markets in the current epoch to be settled or voided, enables withdrawals, and increments `currentEpoch`.
- `requestWithdraw(shares)` and `processWithdrawal()` use a cooldown and redeem at the worse of request-time NAV and current NAV.

### Markets And Odds

- `createMarketGroup()` creates a real-world event container.
- `createMarket(CreateMarketParams)` creates a `PreOpen` market with signed anchor odds.
- `openMarket()` and `bulkOpenMarkets()` open eligible markets once the epoch has started.
- `updateOdds()` updates pre-start odds using an oracle signature and deviation limits.
- `suspendMarket()` / `resumeMarket()` halt or resume betting around operational incidents.

### Betting And Settlement

- `buyAtOdds(marketId, outcomeId, stake, minOdds)` places a single fixed-odds bet. `minOdds` is the bettor's slippage guard.
- `placeSlip(PlaceSlipParams)` places an accumulator; all legs must share an epoch.
- Same-event slip legs receive correlation discounts through `LibGroupDiscount`.
- Cross-event slip combinations can receive a bounded bonus.
- `proposeResult()`, `adminOverride()`, and `finalizeResult()` drive settlement.
- `voidIfExpired()` is a permissionless safety net when settlement misses the deadline.

## Development

Install dependencies:

```shell
npm install
```

Compile:

```shell
npx hardhat compile
```

Run tests:

```shell
npx hardhat test
```

Run only TypeScript or Solidity tests:

```shell
npx hardhat test nodejs
npx hardhat test solidity
```

## Current Gaps

- There is no QuadraticMarket Ignition deployment module yet.
- Test coverage currently has one happy-path lifecycle test; edge cases around reverts, slip handling, oracle updates, voids, and admin overrides still need focused tests.
- Root architecture notes mention several historic LMSR decisions; the Solidity code has already pivoted to fixed odds.
