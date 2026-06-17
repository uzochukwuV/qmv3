python3 << 'EOF'
print("""
╔══════════════════════════════════════════════════════════════════════╗
║         QUADRATIC MARKETS EVM (qmv3) — FULL CONTRACT ANALYSIS       ║
╚══════════════════════════════════════════════════════════════════════╝

STACK: Solidity 0.8.28, Hardhat 3 + viem, OpenZeppelin 5.6, via-IR optimizer
TARGET: Sepolia testnet (seen in hardhat.config.ts)
PATTERN: Monolithic contract + library separation (QuadraticMarket.sol + LibOdds + LibGroupDiscount + ITypes)

═══════════════════════════════════════════════════════════════════════
OVERALL ASSESSMENT
═══════════════════════════════════════════════════════════════════════

This is a genuinely well-structured V1. The architecture pivot from LMSR
to semi-static fixed odds is correctly executed. The code quality is
significantly cleaner than typical hackathon Solidity — the library
separation, struct design, and modifier pattern are all production-level.

Phases 3–7 (betting, settlement, orders, slips) are not yet implemented
in the fetched files, but the foundation (Phases 1–2) is solid.

Let me work through every layer systematically.

═══════════════════════════════════════════════════════════════════════
ARCHITECTURE STRENGTHS ✅
═══════════════════════════════════════════════════════════════════════

✅ 1. ODDS REPRESENTATION: ODDS_PRECISION = 1_000_000
   Decimal odds × 1M avoids floating point entirely.
   2.80 → 2_800_000. Clean. No ambiguity.
   
✅ 2. ANCHOR + MAX_DEVIATION ON-CHAIN GUARANTEE
   Market.oddsAnchor stores Pinnacle/API consensus at creation.
   Market.maxDeviationBps enforces max oracle drift on-chain.
   LibOdds.withinDeviation() is pure math — no oracle trust needed.
   This is the key trustless commitment we discussed. Implemented correctly.

✅ 3. GROUPTYPE ENUM + PAIRWISE DISCOUNT LIBRARY
   8 GroupTypes hardcoded — exactly what we designed.
   LibGroupDiscount.pairwiseDiscount() is 3 lines, pure, correct:
     Same type same match → 0.70×
     Cross type same match → 0.92×  
     Different match → 1.00×
   computeSlipDiscountBps() is O(n²) pairwise — correct for ≤8 legs.
   crossMatchBonusBps() incentivizes cross-match accumulators. Clean.

✅ 4. EPOCH init USES initialized FLAG
   Previous Solana version had epoch-0 ambiguity bug (C-02).
   EVM version fixes it with ep.initialized — no epoch-0 collision.
   initEpoch() reverts if ep.initialized. advanceEpoch() checks it.
   
✅ 5. DEPOSIT WINDOW GATED AT EPOCH STARTTIME
   addLiquidity() requires block.timestamp < ep.startTime.
   Deposits close when trading opens. Clean lifecycle separation.
   
✅ 6. EXPOSURE CAP ENFORCED PER BET
   _checkEpochExposure() called before every bet (noted for Phase 3).
   maxEpochExposure = lpDeposit × multiplierBps / BPS.
   LP deposits $1M at 1.5× → max $1.5M payout obligation. Bounded.
   Reverts with VolumeCapExceeded() — clean custom error.

✅ 7. LP CATEGORY VOTING
   Weight = lpShares[msg.sender]. Share-weighted. Correct.
   Double-vote prevention: lpCategoryVote stores catKey+1 (0=no vote).
   Winning category updated live: O(1) comparison. Efficient.

✅ 8. REENTRANCY GUARD
   ReentrancyGuard on the contract. nonReentrant on addLiquidity and
   processWithdrawal. The two state-modifying external fund flows
   are protected. Correct.

✅ 9. SAFEERC20 FOR TOKEN TRANSFERS
   Using SafeERC20.safeTransfer everywhere. USDT-compatible.
   Handles non-standard ERC20s (no return value, etc.).

✅ 10. MIN_FIRST_LIQUIDITY INFLATION GUARD
    First deposit: shares = amount - MIN_FIRST_LIQUIDITY.
    Dead shares locked permanently. ERC4626 inflation attack prevented.
    Same pattern as the Solana version. Correctly ported.

✅ 11. OUTCOME BALANCES AS MAPPING
    outcomeBalances[bettor][marketId][outcomeId] = uint256.
    No ERC20 token minting per outcome — simpler and cheaper gas.
    Trade-off: positions not composable (can't transfer to other protocols).
    Acceptable for V1.

✅ 12. ORDER COLLATERAL SEPARATION
    orderCollateralLocked tracked separately from totalLockedPayouts.
    freeLiquidity() = balance - totalLockedPayouts - orderCollateralLocked.
    Same correct accounting as the Solana version.

═══════════════════════════════════════════════════════════════════════
CRITICAL BUGS 🔴
═══════════════════════════════════════════════════════════════════════

🔴 C-01: WITHDRAWAL CHECK IS WRONG — LP CAN WITHDRAW TOO EARLY
   Location: requestWithdraw()
   
   Code:
     if (epochs[currentEpoch].withdrawalsEnabled) canWithdraw = true;
     else if (currentEpoch > 0 && epochs[currentEpoch - 1].withdrawalsEnabled) canWithdraw = true;
   
   Bug: This checks withdrawalsEnabled on the CURRENT epoch,
   which starts as false (correctly). But checking currentEpoch-1
   is wrong: an LP deposits in epoch 2, the check passes because
   epoch 1 (already settled) has withdrawalsEnabled=true.
   LP can request withdrawal IN THE MIDDLE OF EPOCH 2 because 
   epoch 1 is done. Their shares are still active in epoch 2 
   (backing live bets) but they're queueing withdrawal.
   
   After the cooldown they processWithdrawal() — pulling capital
   while bets on epoch 2 markets are still open. LP walks away,
   leaves protocol undercollateralized.
   
   Fix: Only allow withdrawal when the LP's deposit epoch has settled.
   Track which epoch each LP deposited in (lpDepositsPerEpoch exists!).
   Check: epochs[depositEpoch].withdrawalsEnabled == true.
   
   OR simpler: Only allow withdrawal after advanceEpoch() sets
   withdrawalsEnabled=true on the MOST RECENTLY COMPLETED epoch,
   AND that epoch is the one the LP deposited in.

🔴 C-02: PROCESSWITHDRAWAL USES LIVE NAV, NOT SNAPSHOT
   Location: processWithdrawal()
   
   Code:
     uint256 bal = baseToken.balanceOf(address(this));
     uint256 amount = (shares * bal) / totalLpShares;
   
   Bug: NAV is computed at withdrawal time, not at request time.
   Scenario:
     1. LP has 100 shares, requests withdrawal at NAV = 1.05 USDC/share
     2. During cooldown, several bettors WIN large payouts
     3. Treasury balance drops
     4. LP processes withdrawal at NAV = 0.70 USDC/share
     5. LP gets 70 USDC instead of expected 105 USDC
   
   This is actually correct behavior for an LP (you share in losses),
   but it violates user expectation if they saw a NAV at request time.
   Bet365's LP equivalent would lock in a NAV at request time.
   
   The Solana version had share_price_snapshot for this reason.
   
   Recommendation: Add navSnapshot to WithdrawalRequest, computed
   at request time. Pay min(snapshotNav, currentNav) × shares.
   This protects against surprise losses during the cooldown window.
   (Same tradeoff: LP can't game upward by re-requesting at better NAV.)

🔴 C-03: ADVANCEEPOCH CAN SUCCEED WITH UNINITIALIZED EPOCH
   Location: advanceEpoch()
   
   Code:
     if (!ep.initialized) revert EpochAlreadyInitialized();
   
   Bug: The error name is wrong — revert EpochAlreadyInitialized() is
   used when the epoch is NOT initialized. This is confusing to callers
   (and wrong semantically). But more critically:
   
   The check is: if (!ep.initialized) revert — meaning it only reverts
   if epoch was NEVER initialized. If admin calls advanceEpoch() on an
   epoch that has 0 markets and initialized=true, it succeeds and flips
   withdrawalsEnabled=true immediately — even though LPs may have just
   deposited and no markets ran. This lets LPs cycle through empty epochs
   to withdraw capital immediately (bypassing the epoch lock intent).
   
   Fix: Add require(ep.numMarkets > 0 || block.timestamp > ep.endTime)
   to prevent advancing an epoch that just opened with no markets.
   Rename the error to EpochNotInitialized().

🔴 C-04: ODDS DEVIATION CHECK NOT ENFORCED IN CONTRACT
   Location: Market struct has maxDeviationBps and oddsAnchor
   LibOdds.withinDeviation() is implemented
   BUT: updateOdds() (Phase 3) is not yet in the fetched contracts.
   
   Risk: If Phase 3 updateOdds() forgets to call withinDeviation(),
   the on-chain guarantee is worthless — anchor and deviation exist
   in storage but nothing enforces them at update time.
   
   The fields are there. The library function is there. Make sure
   Phase 3 updateOdds() explicitly calls:
     require(LibOdds.withinDeviation(newOdds[i], market.oddsAnchor[i], market.maxDeviationBps))
   for every outcome. Do not let this slip through in Phase 3 impl.

═══════════════════════════════════════════════════════════════════════
HIGH SEVERITY 🟠
═══════════════════════════════════════════════════════════════════════

🟠 H-01: PROCESSWITHDRAWAL DOES NOT CHECK EPOCH WITHDRAWAL ELIGIBILITY
   location: processWithdrawal()
   
   requestWithdraw() checks withdrawalsEnabled (with the bug in C-01).
   processWithdrawal() does NOT recheck withdrawalsEnabled at execute time.
   
   Scenario: LP requests withdrawal in epoch 5 (epoch 4 had withdrawalsEnabled).
   Admin resets something. By the time cooldown passes, epoch 5 has active bets.
   processWithdrawal() still succeeds because it only checks freeLiquidity().
   
   freeLiquidity may be positive even during active epoch if bets haven't
   been locked yet. LP withdraws while bets are live.
   
   Fix: Store epochId in WithdrawalRequest (it's there already) and
   require epochs[req.epochId].withdrawalsEnabled at process time too.

🟠 H-02: ORACLE IS A SINGLE EOA — SINGLE POINT OF FAILURE + COMPROMISE
   Location: oracle address in constructor and updateConfig
   
   The oracle is a single keypair that can:
   - Update odds on any market at any time (up to maxDeviationBps)
   - Propose settlement results
   
   If the oracle key is compromised: attacker proposes wrong results
   or shades all odds to maximum deviation. 5-minute challenge window
   is admin-only so if admin is also compromised, there's no defense.
   
   For V1 this is acceptable. For mainnet: multisig oracle or
   Chainlink oracle network. At minimum, timelock the oracle update
   in updateConfig (can't change oracle immediately — 24hr delay).

🟠 H-03: PAUSE() CALLABLE BY OPERATOR, UNPAUSE() ONLY BY ADMIN
   Location: pause() uses onlyAuthorized, unpause() uses onlyAdmin
   
   Any operator can pause the entire protocol. Operator keys are more
   likely to be compromised than admin (operators may be hot wallets
   running the AI bot). A compromised operator = protocol DoS.
   
   Fix: pause() should also be onlyAdmin, or require a 2-of-N 
   threshold among operators to pause. unpause() correctly requires admin.

🟠 H-04: REMOVEOPERATOR CAN ACCIDENTALLY REMOVE ADMIN FROM OPERATOR ARRAY
   Location: removeOperator()
   
   If admin was accidentally added as an operator (possible since
   addOperator doesn't check for admin), removeOperator would remove
   them from the operator array. This doesn't affect _isAuthorized
   (admin is always authorized regardless), but it leaves a gap
   in the _operators array via swap-remove. No real exploit but
   could cause confusion with getOperator() enumeration.
   
   Fix: require(operator != admin) in addOperator.

🟠 H-05: VOTECATEGORY — VOTE WEIGHT CAPTURED AT VOTE TIME, NOT AT EPOCH END
   Location: voteCategory()
   
   weight = lpShares[msg.sender] at the time of voting.
   But lpShares can change after voting (if LP transfers — 
   wait, there's no transfer function, so this is fine for now).
   
   If in future you add LP share transferability, vote weights
   would be stale. Flag this now as a known limitation.

═══════════════════════════════════════════════════════════════════════
MEDIUM ISSUES 🟡
═══════════════════════════════════════════════════════════════════════

🟡 M-01: COMBINEDODDS OVERFLOW RISK ON LONG PARLAYS
   Location: LibOdds.combinedOdds()
   
   result = (result * oddsArr[i]) / ODDS_PRECISION at each step.
   With 8 legs at odds 10.00 (10_000_000):
   result after 2 legs: 10_000_000 × 10_000_000 = 10^14 before division
   uint256 max ≈ 1.15 × 10^77 — this is safe.
   But: intermediate (result * oddsArr[i]) before the division
   could theoretically overflow with extreme odds and many legs.
   At 8 legs × max realistic odds 100.0 (100_000_000):
   worst case = (100M)^8 = 10^64 — still within uint256.
   Not an overflow risk in practice. ✅ This is fine.

🟡 M-02: MARKET STRUCT IS LARGE — STORAGE LAYOUT COST
   Market has: 8 × uint256 currentOdds + 8 × uint256 oddsAnchor 
   + 8 × uint256 volumeCap + 8 × uint256 volumeFilled = 32 uint256s
   = 32 storage slots just for price/volume data per market.
   At 20,000 gas per SSTORE: creating one market costs ~640K gas
   (32 × 20K). For 10 markets in an epoch: 6.4M gas.
   Not a blocker on L2 (Base, Arbitrum) but expensive on mainnet.
   
   Recommendation: Deploy on Arbitrum/Base. Gas cost there is ~100×
   less than mainnet for the same operations.

🟡 M-03: PENDINGIQUIDITY STRUCT EXISTS BUT IS NEVER USED IN PHASE 1/2
   The PendingLiquidity struct and mapping pendingLiquidity are defined
   but addLiquidity() doesn't populate them. Deposits go directly to
   the LP share pool with no activation delay.
   
   The Solana version had a 2-epoch activation lock on deposits to
   prevent LP front-running (deposit right before epoch end, withdraw
   immediately after). The EVM version's deposit window (only before
   epoch.startTime) provides similar protection without the extra struct,
   since deposits close when trading opens. PendingLiquidity is dead code.
   Remove it or add activation logic.

🟡 M-04: WITHDRAWALREQUEST.EPOCHID IS STORED BUT IGNORED IN PROCESSWITHDRAWAL
   req.epochId is set in requestWithdraw and stored in WithdrawalRequest.
   processWithdrawal() doesn't use it — it just uses current treasury NAV.
   This connects to C-01 and H-01. The fix for those bugs requires using
   req.epochId. Make sure it's wired in.

🟡 M-05: NO MARKET CREATION OR SETTLEMENT FUNCTIONS YET (PHASES 3-7)
   The contract currently implements only:
   - Admin/operator management (Phase 1)
   - LP vault with epoch management (Phase 2)
   
   Missing (Phase 3+): createMarket, updateOdds, buyAtOdds, placeSlip,
   claimPayout, cashOut, proposeResult, finalizeResult, voidMarket,
   placeOrder, fillOrder, cancelOrder.
   
   These are the functions where the actual security surface lives.
   Phase 1/2 are solid foundations but the analysis is necessarily
   incomplete until Phase 3+ is implemented.
""")
EOF
python3 /tmp/verdict.py 2>/dev/null | head -5
Output


╔══════════════════════════════════════════════════════════════════════╗
║         QUADRATIC MARKETS EVM (qmv3) — FULL CONTRACT ANALYSIS       ║
╚══════════════════════════════════════════════════════════════════════╝

STACK: Solidity 0.8.28, Hardhat 3 + viem, OpenZeppelin 5.6, via-IR optimizer
TARGET: Sepolia testnet (seen in hardhat.config.ts)
PATTERN: Monolithic contract + library separation (QuadraticMarket.sol + LibOdds + LibGroupDiscount + ITypes)

═══════════════════════════════════════════════════════════════════════
OVERALL ASSESSMENT
═══════════════════════════════════════════════════════════════════════

This is a genuinely well-structured V1. The architecture pivot from LMSR
to semi-static fixed odds is correctly executed. The code quality is
significantly cleaner than typical hackathon Solidity — the library
separation, struct design, and modifier pattern are all production-level.

Phases 3–7 (betting, settlement, orders, slips) are not yet implemented
in the fetched files, but the foundation (Phases 1–2) is solid.

Let me work through every layer systematically.

═══════════════════════════════════════════════════════════════════════
ARCHITECTURE STRENGTHS ✅
═══════════════════════════════════════════════════════════════════════

✅ 1. ODDS REPRESENTATION: ODDS_PRECISION = 1_000_000
   Decimal odds × 1M avoids floating point entirely.
   2.80 → 2_800_000. Clean. No ambiguity.
   
✅ 2. ANCHOR + MAX_DEVIATION ON-CHAIN GUARANTEE
   Market.oddsAnchor stores Pinnacle/API consensus at creation.
   Market.maxDeviationBps enforces max oracle drift on-chain.
   LibOdds.withinDeviation() is pure math — no oracle trust needed.
   This is the key trustless commitment we discussed. Implemented correctly.

✅ 3. GROUPTYPE ENUM + PAIRWISE DISCOUNT LIBRARY
   8 GroupTypes hardcoded — exactly what we designed.
   LibGroupDiscount.pairwiseDiscount() is 3 lines, pure, correct:
     Same type same match → 0.70×
     Cross type same match → 0.92×  
     Different match → 1.00×
   computeSlipDiscountBps() is O(n²) pairwise — correct for ≤8 legs.
   crossMatchBonusBps() incentivizes cross-match accumulators. Clean.

✅ 4. EPOCH init USES initialized FLAG
   Previous Solana version had epoch-0 ambiguity bug (C-02).
   EVM version fixes it with ep.initialized — no epoch-0 collision.
   initEpoch() reverts if ep.initialized. advanceEpoch() checks it.
   
✅ 5. DEPOSIT WINDOW GATED AT EPOCH STARTTIME
   addLiquidity() requires block.timestamp < ep.startTime.
   Deposits close when trading opens. Clean lifecycle separation.
   
✅ 6. EXPOSURE CAP ENFORCED PER BET
   _checkEpochExposure() called before every bet (noted for Phase 3).
   maxEpochExposure = lpDeposit × multiplierBps / BPS.
   LP deposits $1M at 1.5× → max $1.5M payout obligation. Bounded.
   Reverts with VolumeCapExceeded() — clean custom error.

✅ 7. LP CATEGORY VOTING
   Weight = lpShares[msg.sender]. Share-weighted. Correct.
   Double-vote prevention: lpCategoryVote stores catKey+1 (0=no vote).
   Winning category updated live: O(1) comparison. Efficient.

✅ 8. REENTRANCY GUARD
   ReentrancyGuard on the contract. nonReentrant on addLiquidity and
   processWithdrawal. The two state-modifying external fund flows
   are protected. Correct.

✅ 9. SAFEERC20 FOR TOKEN TRANSFERS
   Using SafeERC20.safeTransfer everywhere. USDT-compatible.
   Handles non-standard ERC20s (no return value, etc.).

✅ 10. MIN_FIRST_LIQUIDITY INFLATION GUARD
    First deposit: shares = amount - MIN_FIRST_LIQUIDITY.
    Dead shares locked permanently. ERC4626 inflation attack prevented.
    Same pattern as the Solana version. Correctly ported.

✅ 11. OUTCOME BALANCES AS MAPPING
    outcomeBalances[bettor][marketId][outcomeId] = uint256.
    No ERC20 token minting per outcome — simpler and cheaper gas.
    Trade-off: positions not composable (can't transfer to other protocols).
    Acceptable for V1.

✅ 12. ORDER COLLATERAL SEPARATION
    orderCollateralLocked tracked separately from totalLockedPayouts.
    freeLiquidity() = balance - totalLockedPayouts - orderCollateralLocked.
    Same correct accounting as the Solana version.

═══════════════════════════════════════════════════════════════════════
CRITICAL BUGS 🔴
═══════════════════════════════════════════════════════════════════════

🔴 C-01: WITHDRAWAL CHECK IS WRONG — LP CAN WITHDRAW TOO EARLY
   Location: requestWithdraw()
   
   Code:
     if (epochs[currentEpoch].withdrawalsEnabled) canWithdraw = true;
     else if (currentEpoch > 0 && epochs[currentEpoch - 1].withdrawalsEnabled) canWithdraw = true;
   
   Bug: This checks withdrawalsEnabled on the CURRENT epoch,
   which starts as false (correctly). But checking currentEpoch-1
   is wrong: an LP deposits in epoch 2, the check passes because
   epoch 1 (already settled) has withdrawalsEnabled=true.
   LP can request withdrawal IN THE MIDDLE OF EPOCH 2 because 
   epoch 1 is done. Their shares are still active in epoch 2 
   (backing live bets) but they're queueing withdrawal.
   
   After the cooldown they processWithdrawal() — pulling capital
   while bets on epoch 2 markets are still open. LP walks away,
   leaves protocol undercollateralized.
   
   Fix: Only allow withdrawal when the LP's deposit epoch has settled.
   Track which epoch each LP deposited in (lpDepositsPerEpoch exists!).
   Check: epochs[depositEpoch].withdrawalsEnabled == true.
   
   OR simpler: Only allow withdrawal after advanceEpoch() sets
   withdrawalsEnabled=true on the MOST RECENTLY COMPLETED epoch,
   AND that epoch is the one the LP deposited in.

🔴 C-02: PROCESSWITHDRAWAL USES LIVE NAV, NOT SNAPSHOT
   Location: processWithdrawal()
   
   Code:
     uint256 bal = baseToken.balanceOf(address(this));
     uint256 amount = (shares * bal) / totalLpShares;
   
   Bug: NAV is computed at withdrawal time, not at request time.
   Scenario:
     1. LP has 100 shares, requests withdrawal at NAV = 1.05 USDC/share
     2. During cooldown, several bettors WIN large payouts
     3. Treasury balance drops
     4. LP processes withdrawal at NAV = 0.70 USDC/share
     5. LP gets 70 USDC instead of expected 105 USDC
   
   This is actually correct behavior for an LP (you share in losses),
   but it violates user expectation if they saw a NAV at request time.
   Bet365's LP equivalent would lock in a NAV at request time.
   
   The Solana version had share_price_snapshot for this reason.
   
   Recommendation: Add navSnapshot to WithdrawalRequest, computed
   at request time. Pay min(snapshotNav, currentNav) × shares.
   This protects against surprise losses during the cooldown window.
   (Same tradeoff: LP can't game upward by re-requesting at better NAV.)

🔴 C-03: ADVANCEEPOCH CAN SUCCEED WITH UNINITIALIZED EPOCH
   Location: advanceEpoch()
   
   Code:
     if (!ep.initialized) revert EpochAlreadyInitialized();
   
   Bug: The error name is wrong — revert EpochAlreadyInitialized() is
   used when the epoch is NOT initialized. This is confusing to callers
   (and wrong semantically). But more critically:
   
   The check is: if (!ep.initialized) revert — meaning it only reverts
   if epoch was NEVER initialized. If admin calls advanceEpoch() on an
   epoch that has 0 markets and initialized=true, it succeeds and flips
   withdrawalsEnabled=true immediately — even though LPs may have just
   deposited and no markets ran. This lets LPs cycle through empty epochs
   to withdraw capital immediately (bypassing the epoch lock intent).
   
   Fix: Add require(ep.numMarkets > 0 || block.timestamp > ep.endTime)
   to prevent advancing an epoch that just opened with no markets.
   Rename the error to EpochNotInitialized().

🔴 C-04: ODDS DEVIATION CHECK NOT ENFORCED IN CONTRACT
   Location: Market struct has maxDeviationBps and oddsAnchor
   LibOdds.withinDeviation() is implemented
   BUT: updateOdds() (Phase 3) is not yet in the fetched contracts.
   
   Risk: If Phase 3 updateOdds() forgets to call withinDeviation(),
   the on-chain guarantee is worthless — anchor and deviation exist
   in storage but nothing enforces them at update time.
   
   The fields are there. The library function is there. Make sure
   Phase 3 updateOdds() explicitly calls:
     require(LibOdds.withinDeviation(newOdds[i], market.oddsAnchor[i], market.maxDeviationBps))
   for every outcome. Do not let this slip through in Phase 3 impl.

═══════════════════════════════════════════════════════════════════════
HIGH SEVERITY 🟠
═══════════════════════════════════════════════════════════════════════

🟠 H-01: PROCESSWITHDRAWAL DOES NOT CHECK EPOCH WITHDRAWAL ELIGIBILITY
   location: processWithdrawal()
   
   requestWithdraw() checks withdrawalsEnabled (with the bug in C-01).
   processWithdrawal() does NOT recheck withdrawalsEnabled at execute time.
   
   Scenario: LP requests withdrawal in epoch 5 (epoch 4 had withdrawalsEnabled).
   Admin resets something. By the time cooldown passes, epoch 5 has active bets.
   processWithdrawal() still succeeds because it only checks freeLiquidity().
   
   freeLiquidity may be positive even during active epoch if bets haven't
   been locked yet. LP withdraws while bets are live.
   
   Fix: Store epochId in WithdrawalRequest (it's there already) and
   require epochs[req.epochId].withdrawalsEnabled at process time too.

🟠 H-02: ORACLE IS A SINGLE EOA — SINGLE POINT OF FAILURE + COMPROMISE
   Location: oracle address in constructor and updateConfig
   
   The oracle is a single keypair that can:
   - Update odds on any market at any time (up to maxDeviationBps)
   - Propose settlement results
   
   If the oracle key is compromised: attacker proposes wrong results
   or shades all odds to maximum deviation. 5-minute challenge window
   is admin-only so if admin is also compromised, there's no defense.
   
   For V1 this is acceptable. For mainnet: multisig oracle or
   Chainlink oracle network. At minimum, timelock the oracle update
   in updateConfig (can't change oracle immediately — 24hr delay).

🟠 H-03: PAUSE() CALLABLE BY OPERATOR, UNPAUSE() ONLY BY ADMIN
   Location: pause() uses onlyAuthorized, unpause() uses onlyAdmin
   
   Any operator can pause the entire protocol. Operator keys are more
   likely to be compromised than admin (operators may be hot wallets
   running the AI bot). A compromised operator = protocol DoS.
   
   Fix: pause() should also be onlyAdmin, or require a 2-of-N 
   threshold among operators to pause. unpause() correctly requires admin.

🟠 H-04: REMOVEOPERATOR CAN ACCIDENTALLY REMOVE ADMIN FROM OPERATOR ARRAY
   Location: removeOperator()
   
   If admin was accidentally added as an operator (possible since
   addOperator doesn't check for admin), removeOperator would remove
   them from the operator array. This doesn't affect _isAuthorized
   (admin is always authorized regardless), but it leaves a gap
   in the _operators array via swap-remove. No real exploit but
   could cause confusion with getOperator() enumeration.
   
   Fix: require(operator != admin) in addOperator.

🟠 H-05: VOTECATEGORY — VOTE WEIGHT CAPTURED AT VOTE TIME, NOT AT EPOCH END
   Location: voteCategory()
   
   weight = lpShares[msg.sender] at the time of voting.
   But lpShares can change after voting (if LP transfers — 
   wait, there's no transfer function, so this is fine for now).
   
   If in future you add LP share transferability, vote weights
   would be stale. Flag this now as a known limitation.

═══════════════════════════════════════════════════════════════════════
MEDIUM ISSUES 🟡
═══════════════════════════════════════════════════════════════════════

🟡 M-01: COMBINEDODDS OVERFLOW RISK ON LONG PARLAYS
   Location: LibOdds.combinedOdds()
   
   result = (result * oddsArr[i]) / ODDS_PRECISION at each step.
   With 8 legs at odds 10.00 (10_000_000):
   result after 2 legs: 10_000_000 × 10_000_000 = 10^14 before division
   uint256 max ≈ 1.15 × 10^77 — this is safe.
   But: intermediate (result * oddsArr[i]) before the division
   could theoretically overflow with extreme odds and many legs.
   At 8 legs × max realistic odds 100.0 (100_000_000):
   worst case = (100M)^8 = 10^64 — still within uint256.
   Not an overflow risk in practice. ✅ This is fine.

🟡 M-02: MARKET STRUCT IS LARGE — STORAGE LAYOUT COST
   Market has: 8 × uint256 currentOdds + 8 × uint256 oddsAnchor 
   + 8 × uint256 volumeCap + 8 × uint256 volumeFilled = 32 uint256s
   = 32 storage slots just for price/volume data per market.
   At 20,000 gas per SSTORE: creating one market costs ~640K gas
   (32 × 20K). For 10 markets in an epoch: 6.4M gas.
   Not a blocker on L2 (Base, Arbitrum) but expensive on mainnet.
   
   Recommendation: Deploy on Arbitrum/Base. Gas cost there is ~100×
   less than mainnet for the same operations.

🟡 M-03: PENDINGIQUIDITY STRUCT EXISTS BUT IS NEVER USED IN PHASE 1/2
   The PendingLiquidity struct and mapping pendingLiquidity are defined
   but addLiquidity() doesn't populate them. Deposits go directly to
   the LP share pool with no activation delay.
   
   The Solana version had a 2-epoch activation lock on deposits to
   prevent LP front-running (deposit right before epoch end, withdraw
   immediately after). The EVM version's deposit window (only before
   epoch.startTime) provides similar protection without the extra struct,
   since deposits close when trading opens. PendingLiquidity is dead code.
   Remove it or add activation logic.

🟡 M-04: WITHDRAWALREQUEST.EPOCHID IS STORED BUT IGNORED IN PROCESSWITHDRAWAL
   req.epochId is set in requestWithdraw and stored in WithdrawalRequest.
   processWithdrawal() doesn't use it — it just uses current treasury NAV.
   This connects to C-01 and H-01. The fix for those bugs requires using
   req.epochId. Make sure it's wired in.

🟡 M-05: NO MARKET CREATION OR SETTLEMENT FUNCTIONS YET (PHASES 3-7)
   The contract currently implements only:
   - Admin/operator management (Phase 1)
   - LP vault with epoch management (Phase 2)
   
   Missing (Phase 3+): createMarket, updateOdds, buyAtOdds, placeSlip,
   claimPayout, cashOut, proposeResult, finalizeResult, voidMarket,
   placeOrder, fillOrder, cancelOrder.
   
   These are the functions where the actual security surface lives.
   Phase 1/2 are solid foundations but the analysis is necessarily
   incomplete until Phase 3+ is implemented.


THE HONEST CASE FOR SEMI-STATIC OVER LMSR
==========================================

WHY LMSR MADE SENSE AS A STARTING POINT
Done
