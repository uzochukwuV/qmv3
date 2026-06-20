# 1. OBJECTIVE

Split the monolithic `QuadraticMarket` contract (which already inherits through 4 abstract layers and is hitting the Solidity 24,576-byte bytecode limit) into **three standalone, cross-contract communicating contracts**, and remove `viaIR` from `hardhat.config.ts`.

The three contracts are:

1. **LiquidityVault** — LP deposits, withdrawals, NAV, category voting.
2. **BetSlips** — Multi-leg accumulator slip token (ownership, placement, settlement, P2P transfers).
3. **Core** (renamed from `QuadraticMarket`) — Admin/operator management, epoch lifecycle, market creation, oracle updates, settlement pipeline.

---

# 2. CONTEXT SUMMARY

## Current Architecture

The current inheritance chain is:

```
QuadraticMarketStorage  ← all state + modifiers + helpers
        ↑
QuadraticLP             ← LP vault logic
        ↑
QuadraticSlips          ← multi-leg slip logic
        ↑
QuadraticMarket         ← admin + epoch + market + oracle + settlement (CONCRETE/deployed)
```

`QuadraticMarket` is ~362 lines and already exceeds the bytecode limit because:
- It has ~2,400 lines of code across all inherited layers (storage + LP + slips + concrete)
- `viaIR: true` in `hardhat.config.ts` is needed only because without it the optimizer can't handle the complexity
- Removing `viaIR` without splitting would immediately break compilation

## Why Split Into Three?

- The **24,576-byte bytecode limit** counts all deployed bytecode including libraries and inherited code
- `QuadraticSlipMarketplace` is already separate (Phase 6 P2P marketplace)
- LP vault, slip logic, and core protocol are **natural separation points** that minimize cross-contract calls
- Smaller contracts → cheaper gas, easier to audit, upgradeable independently

## Cross-Contract Communication Pattern

All contracts share `baseToken` (USDC). State lives wherever it belongs naturally:

| Data | Owner Contract |
|---|---|
| LP shares, NAV, withdrawal queue | `LiquidityVault` |
| Slip ownership, slip bets, slip exposure | `BetSlips` |
| Markets, epochs, bettor balances, orders | `Core` |

`Core` is the **canonical entry point** — deployed first, holds USDC treasury, orchestrates all flows.

---

# 3. APPROACH OVERVIEW

## Architecture: Three-Contract Pattern

```
┌─────────────────────────────────────────────────────┐
│                   Core (QuadraticCore)              │
│  - admin, oracle, operators                         │
│  - epochs, markets, market groups                   │
│  - single-outcome bet placement (buyAtOdds)         │
│  - oracle updateOdds, settlement pipeline           │
│  - USDC treasury (receives bets, pays out)         │
│  - holds references to LiquidityVault & BetSlips   │
│  - cross-calls to lock/unlock LP exposure          │
└────────────────────┬────────────────────────────────┘
                     │ cross-contract (external calls)
         ┌───────────┴───────────┐
         ▼                       ▼
┌─────────────────────┐  ┌────────────────────────────┐
│  LiquidityVault     │  │       BetSlips              │
│  - addLiquidity     │  │  - placeSlip                │
│  - requestWithdraw  │  │  - claimSlipPayout          │
│  - processWithdrawal│  │  - cancelSlip               │
│  - voteCategory     │  │  - slipResult               │
│  - LP share NAV     │  │  - slip token ownership     │
│  - holds LP state   │  │  - holds slip state         │
└─────────────────────┘  └────────────────────────────┘
```

## Key Design Decisions

1. **Core is the USDC hub** — all tokens flow through Core. LiquidityVault and BetSlips call `baseToken.safeTransferFrom/To` directly (Core is the approver for slip stakes and pays out LP withdrawals).
2. **Core is the entry point** — frontend and users interact with Core. Core delegates to Vault/Slips via external calls.
3. **No diamond pattern** — keep it simple. Three fixed contracts, no upgradeability in V1.
4. **Re-entrancy guards** on all external-calling functions.
5. **LibOdds, LibGroupDiscount, LibSlip** remain as internal libraries (their bytecode is cheap and doesn't hit the limit).

## Removing viaIR

Without `viaIR: true`, the standard optimizer (200 runs) must handle complex expression trees. Key strategies:
- Break large internal functions into smaller helpers
- Move complex pure math into libraries (already done)
- Avoid deeply nested struct accesses in tight loops
- Use internal view functions to cache storage reads

---

# 4. IMPLEMENTATION STEPS

## Step 1 — Create `interfaces/IInterContract.sol`

**Goal:** Define shared interfaces for cross-contract calls before any contract is built.

**Method:** Create a new interfaces file with interface definitions that each contract will import.

**Reference:** New file — `contracts/interfaces/IInterContract.sol`

Define:
```solidity
interface ILiquidityVault {
    function addLiquidity(uint256 amount) external;
    function requestWithdraw(uint256 shares) external;
    function processWithdrawal() external;
    function voteCategory(SportCategory category) external;
    function lpNav() external view returns (uint256);
    function lpSharesOf(address lp) external view returns (uint256);
    function totalLpShares() external view returns (uint256);
    function freeLiquidity() external view returns (uint256);
    function getVaultEpochLiquidityAdded(uint64 epochId) external view returns (uint256);
    function getVaultEpochMaxExposureBps(uint64 epochId) external view returns (uint256);
    function getVaultEpochLockedPayouts(uint64 epochId) external view returns (uint256);
    function vaultLockPayout(uint64 epochId, uint256 amount) external;
    function vaultUnlockPayout(uint64 epochId, uint256 amount) external;
    function vaultWithdrawalsEnabled(uint64 epochId) external view returns (bool);
    function vaultLastSettledEpoch() external view returns (uint64);
    function vaultSetCore(address core) external;
    function vaultEpochInitialized(uint64 epochId) external view returns (bool);
}

interface IBetSlips {
    function placeSlip(PlaceSlipParams calldata p) external returns (uint64 slipId);
    function claimSlipPayout(uint64 slipId) external;
    function claimSlipVoidRefund(uint64 slipId) external;
    function cancelSlip(uint64 slipId) external;
    function settleLostSlip(uint64 slipId) external;
    function slipResult(uint64 slipId) external view returns (bool,bool,bool,bool);
    function getSlipOwner(uint64 slipId) external view returns (address);
    function approveSlip(uint64 slipId, address approved) external;
    function setSlipOperator(address operator, bool approved) external;
    function transferSlip(uint64 slipId, address to) external;
    function slipMarketEpoch(uint64 slipId) external view returns (uint64);
    function slipPotentialPayout(uint64 slipId) external view returns (uint256);
    function slipStatus(uint64 slipId) external view returns (SlipStatus);
    function slipEpochLockedPayouts(uint64 slipId) external view returns (uint256);
    function slipsSetCore(address core) external;
    function slipsLockPayout(uint64 epochId, uint256 amount) external;
    function slipsUnlockPayout(uint64 epochId, uint256 amount) external;
    function slipEpochInitialized(uint64 epochId) external view returns (bool);
}
```

---

## Step 2 — Create `LiquidityVault.sol`

**Goal:** Extract all LP vault logic into a standalone contract. Core does NOT inherit from it.

**Method:**
1. Create `contracts/LiquidityVault.sol` inheriting from `QuadraticMarketStorage` but **removing** all slip/market/admin code.
2. Keep only: LP share mappings, withdrawal requests, pending liquidity, epoch LP accounting, `addLiquidity`, `requestWithdraw`, `processWithdrawal`, `voteCategory`, `lpNav`, `freeLiquidity`, `lpValue`, and the vault-side of exposure helpers.
3. Add `core` address field — set once at deployment. All state-mutating functions call `ICore(core).someCallback()` or just validate `msg.sender == core`.
4. Move LP-share-weighted category voting here (already well-contained).

**Reference:** `contracts/LiquidityVault.sol` (new)

**Key changes vs current `QuadraticLP`:**
- Replace `onlyAuthorized` with `onlyCore` (reverts if `msg.sender != core`)
- Replace `epochs[epochId].withdrawalsEnabled` check — use `IBetSlips` query or rely on Core's epoch state
- Add `setCore(address _core)` callable by admin (called by Core after deployment)
- `addLiquidity` calls `Core.vaultLockPayout(epochId, 0)` for any cross-validation needed
- `processWithdrawal` calls `Core.pullFromVault(amount)` which does `baseToken.safeTransferFrom(vault, msg.sender, amount)` — but since Core holds tokens, Vault just updates its share accounting and Core does the transfer. **Decision:** Since Core holds the USDC, Vault does share accounting only, and Core handles the actual token movement via a `pullLiquidity(address lp, uint256 amount)` callback.
- Rename `onlyAuthorized` → `onlyCore`

**Storage fields to keep in Vault:**
- `lpShares`, `withdrawalRequests`, `pendingLiquidity`, `lpDepositsPerEpoch`, `lpCategoryVote`, `epochCategoryVotes`
- `totalLpShares`
- `core` address
- Epoch LP state (already in `Epoch` struct in Storage — keep there, shared)

---

## Step 3 — Create `BetSlips.sol`

**Goal:** Extract multi-leg slip logic into a standalone contract.

**Method:**
1. Create `contracts/BetSlips.sol` inheriting from `QuadraticMarketStorage`.
2. Keep only: Slip token ownership, slip placement, slip settlement, slip exposure tracking.
3. Core provides market data via `getMarketStatus()`, `getMarketOdds()`, `getMarketEpoch()` — BetSlips calls back to Core for market reads.
4. Add `core` address field. All state-mutating functions validate `msg.sender == core`.
5. Slip placement calls `core.lockPayoutForSlip(epochId, payout)` — Core updates `epochs[epochId].totalLockedPayouts` and global `totalLockedPayouts`.
6. Slip claims call `core.unlockPayoutForSlip(epochId, payout)` — Core does the same reverse update.
7. Slip `claimSlipPayout` calls `core.payoutToSlipWinner(slipId, owner, amount)` — Core does `baseToken.safeTransfer`.

**Reference:** `contracts/BetSlips.sol` (new)

**Key changes vs current `QuadraticSlips`:**
- Replace `onlyAuthorized` on `placeSlip` → `onlyCore`
- All market reads become external calls: `Market storage m = markets[leg.marketId]` → `Market memory m = core.getMarket(leg.marketId)` (add getter to Core)
- Add `setCore(address _core)` callable by admin
- `_lockPayout` / `_unlockPayout` → `core.lockPayout(epochId, amount)` / `core.unlockPayout(epochId, amount)`

---

## Step 4 — Refactor `QuadraticMarket.sol` → `Core.sol`

**Goal:** Make the main contract the thin orchestrator with all market/settlement logic, removing all LP and slip code.

**Method:**
1. Rename `QuadraticMarket.sol` → `Core.sol`.
2. Remove the inheritance from `QuadraticSlips`. Instead, Core imports `ILiquidityVault` and `IBetSlips`.
3. Add `liquidityVault` and `betSlips` address fields.
4. Add `setLiquidityVault(address)` and `setBetSlips(address)` admin functions.
5. Keep ALL market/settlement/epoch/admin code.
6. Implement cross-contract call functions:
   - `lockPayout(uint64 epochId, uint256 amount)` — updates `epochs[epochId].totalLockedPayouts += amount` and `totalLockedPayouts`
   - `unlockPayout(uint64 epochId, uint256 amount)` — reverse
   - `getMarket(uint64 marketId) external view returns (Market memory)` — returns market struct for BetSlips
   - `pullFromVault(address lp, uint256 amount)` — called by Vault when processing withdrawal
7. `addLiquidity` on Core is removed (moved to Vault).
8. Single-outcome `buyAtOdds` (Phase 3, noted as placeholder) stays on Core.
9. `placeSlip` on Core removed — users call `betSlips.placeSlip()` directly (or via Core's `placeSlip` wrapper that forwards).
10. `claimSlipPayout` on Core removed — users call `betSlips.claimSlipPayout()`.
11. Epoch init/advance stays on Core.
12. `initEpoch` now also initializes Vault's epoch LP state (calls `vault.onEpochInit(epochId)`).

**Reference:** `contracts/Core.sol` (renamed from `QuadraticMarket.sol`)

**Key cross-call flow for bet placement:**
```
Core.createMarket()          ← oracle-signed, stores markets + epochs
  ↕ (read)
BetSlips.placeSlip()         ← validates legs against Core.getMarket()
  → core.lockPayout()        ← Core locks LP exposure
  → baseToken.safeTransferFrom(bettor, Core, stake)
  ↕ (read)
LiquidityVault.lpNav()       ← used by BetSlips to validate exposure cap
```

---

## Step 5 — Update `QuadraticMarketStorage.sol`

**Goal:** Remove storage fields that belong to Vault/Slips, keep only Core state.

**Method:**
1. Remove from Storage:
   - `lpShares` mapping
   - `withdrawalRequests` mapping
   - `pendingLiquidity` mapping
   - `lpDepositsPerEpoch` mapping
   - `slipOwner`, `slipApproved`, `slipOperatorApprovals` mappings
   - `lpCategoryVote`, `epochCategoryVotes` mappings
   - `nextSlipId` counter
   - `totalLpShares`
   - `orderCollateralLocked` (keep here — belongs to Core's order book)
2. Keep in Storage:
   - Protocol config (admin, oracle, operators, paused)
   - Token (baseToken, treasury)
   - Market IDs, Group IDs, Order IDs
   - All timing/fee/risk params
   - Epoch struct (fields shared with Vault)
   - Market, MarketGroup, BetSlip, Order, Dispute structs (for Core reads)
   - `epochs`, `markets`, `marketGroups`, `orders`, `disputes`
   - `outcomeBalances`, `outcomeStakes` (bettor positions on Core)
   - `epochs[].totalLockedPayouts` (shared, managed by Core on behalf of Vault+Slips)
3. Replace `onlyAuthorized` modifier — Core's operators still need access. Keep the modifier.
4. Keep `onlyAdmin` and `whenNotPaused`.
5. Keep all internal helpers (`_requireOpen`, `_requireNotStarted`, `_checkEpochExposure`, `_lockPayout`, `_unlockPayout`).

---

## Step 6 — Update `ITypes.sol`

**Goal:** Split struct ownership across contracts cleanly.

**Method:**
- Keep all structs in `ITypes.sol` (single source of truth, no duplication)
- `BetSlip` struct stays in ITypes (used by both Core and BetSlips)
- `WithdrawalRequest` struct stays in ITypes (used by Vault)
- Add `enum SlipStatus` (already there) — used by BetSlips
- No new enums needed

---

## Step 7 — Update `hardhat.config.ts` — Remove `viaIR`

**Goal:** Remove `viaIR: true` from both `default` and `production` profiles.

**Method:**
```typescript
// BEFORE
settings: {
  viaIR: true,
  optimizer: { enabled: true, runs: 1 },
  metadata: { bytecodeHash: "none" },
}

// AFTER
settings: {
  optimizer: { enabled: true, runs: 200 },  // 200 = good balance of size vs speed
  metadata: { bytecodeHash: "none" },
}
```

Also increase `runs` from 1 to 200 since without `viaIR`, the optimizer needs more runs to produce smaller bytecode. `runs: 1` was set for size; with three contracts, we want a balance. Use `runs: 200` as a safe default.

**Reference:** `hardhat.config.ts`

---

## Step 8 — Update/Add Tests

**Goal:** Ensure all tests pass with the new three-contract architecture.

**Method:**
1. Update `test/QuadraticMarket.lifecycle.ts`:
   - Before each test, deploy the three contracts in order: Core → LiquidityVault → BetSlips
   - Call `core.setLiquidityVault(vaultAddress)` and `core.setBetSlips(slipsAddress)`
   - Call `vault.setCore(coreAddress)` and `slips.setCore(coreAddress)`
   - Update all function calls to route through correct contract addresses
2. Add integration tests for cross-contract flows:
   - LP deposits → bet placed → settlement → LP withdraws
   - Slip placed → slip settled → slip owner claims
   - Oracle proposes → challenge window → finalize → bettors claim
3. Update `test/QuadraticMarket.regression.ts` — same deployment pattern
4. Update `test/QuadraticSlipMarketplace.ts` — update slip marketplace to use `BetSlips.slipOwner()` interface

---

## Step 9 — Update Supporting Files

**Goal:** Fix imports and references across the project.

**Method:**
1. Update `hardhat.config.ts` imports if needed
2. Update `package.json` scripts if any reference contract names
3. Update any TypeScript deploy scripts in `scripts/` — deploy order must be: Core first, then Vault and BetSlips, then link them
4. Add deployment script `scripts/deploy.ts`:
   ```typescript
   // 1. Deploy Core
   const core = await viem.deployContract("Core", [usdc, oracle, maxExposure]);
   // 2. Deploy LiquidityVault
   const vault = await viem.deployContract("LiquidityVault", []);
   // 3. Deploy BetSlips
   const slips = await viem.deployContract("BetSlips", []);
   // 4. Link them
   await core.write.setLiquidityVault([vault.address]);
   await core.write.setBetSlips([slips.address]);
   await vault.write.setCore([core.address]);
   await slips.write.setCore([core.address]);
   // 5. Approve USDC
   await usdc.write.approve([core.address, MaxUint256]);
   ```
5. Update `CLAUDE.md` / `AGENTS.md` with the new architecture documentation

---

# 5. TESTING AND VALIDATION

## Compilation
- `npx hardhat compile` succeeds with **no errors**
- All three contracts compile independently under the 24,576-byte bytecode limit
- No `viaIR` warnings

## Bytecode Size Check
After compilation, each contract's deployed bytecode should be well under 24,576 bytes:
- `Core` — estimated ~12,000–16,000 bytes (contains market + settlement logic)
- `LiquidityVault` — estimated ~6,000–8,000 bytes (LP vault only)
- `BetSlips` — estimated ~8,000–10,000 bytes (slip logic)
- `QuadraticSlipMarketplace` — already separate (~2,000 bytes)

Run `npx hardhat compile && npx hardhat size-contracts` (if `hardhat-contracts-size` plugin is available) or manually check artifact sizes.

## Unit Tests Pass
- `npx hardhat test` passes all existing tests
- New integration tests for cross-contract flows pass:
  1. LP deposits via Vault → Vault shares minted
  2. Slip placed via BetSlips → Core locks payout, BetSlips stores slip
  3. Slip won → owner claims via BetSlips → Core transfers payout
  4. Epoch advanced via Core → Vault withdrawals enabled
  5. LP requests + processes withdrawal via Vault → Core transfers USDC

## Cross-Contract Reverts
- Calling `Vault.addLiquidity()` directly (not via Core) should revert with `OnlyCore`
- Calling `BetSlips.placeSlip()` directly with invalid market → correctly queries Core and reverts
- Gas usage for a full bet-to-settlement cycle should be reasonable (~200K–400K gas for a slip with 3 legs)

## Specific Bug Fixes to Verify
- **C-01 (LP withdrawal too early):** Vault's `processWithdrawal` now checks `epochs[req.epochId].withdrawalsEnabled` AND that `msg.sender == core`
- **C-03 (advanceEpoch empty epoch):** Core's `advanceEpoch` enforces `ep.numMarkets > 0` before advancing
- **H-03 (pause by operator):** `pause()` moved to `onlyAdmin` — verify only admin can pause

