// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// ─── Enums ────────────────────────────────────────────────────────────────────

enum MarketStatus {
    PreOpen,          // Created, not yet open for betting
    Open,             // Accepting bets
    Suspended,        // Temporarily halted (e.g. live incident)
    AwaitingResult,   // Match finished, waiting for oracle to propose result
    Proposed,         // Oracle proposed outcome, in challenge window
    Settled,          // Finalized — winners can claim
    Voided            // Cancelled — all stakes refunded
}

enum MarketMode {
    FixedOdds,        // Default for sports — oracle-priced, buy_at_odds only
    Trading           // Prediction market style — direct share trading
}

/// @notice Type of betting market. Determines same-match parlay correlation discount.
/// A MarketGroup (real-world match) contains multiple Markets, each with a GroupType.
/// e.g. Arsenal vs Chelsea group: Market A (FTR), Market B (Goals), Market C (BTTS).
enum GroupType {
    FTR,              // 0 — Full-Time Result: Home / Draw / Away
    Goals,            // 1 — Goals: Over 2.5 / Under 2.5 / Over 3.5 etc.
    BTTS,             // 2 — Both Teams To Score: Yes / No
    AsianHandicap,    // 3 — Asian Handicap lines
    FirstGoal,        // 4 — First Goalscorer
    CorrectScore,     // 5 — Correct Score
    HTResult,         // 6 — Half-Time Result
    PlayerProps       // 7 — Player Props (shots, cards, etc.)
}

enum SlipStatus {
    Building,         // Multi-tx assembly in progress
    Active,           // Placed and live
    Claimed,          // Payout collected
    Cancelled         // Refunded
}

enum OrderSide {
    Back,             // Betting for an outcome (traditional bet)
    Lay               // Betting against an outcome (being the book)
}

enum DisputeStatus {
    Pending,          // Within challenge window
    Resolved,         // Challenge window passed — oracle result stands
    Overridden        // Admin corrected the oracle result
}

/// @notice Sport categories LPs vote on each epoch.
///         Admin creates markets only within the winning category/categories.
///         Voting weight = LP share balance at time of vote.
enum SportCategory {
    Football,         // 0 — Soccer / Association Football
    Tennis,           // 1
    Basketball,       // 2
    AmericanFootball, // 3
    Esports,          // 4
    Other             // 5
}

// ─── Structs ──────────────────────────────────────────────────────────────────

uint256 constant MAX_OUTCOMES    = 8;
uint256 constant MAX_SLIP_LEGS   = 8;
uint256 constant MAX_GROUP_MKTS  = 8;
uint256 constant MAX_OPERATORS   = 8;
uint256 constant ODDS_PRECISION  = 1_000_000;   // 2.80 stored as 2_800_000
uint256 constant BPS             = 10_000;       // basis points denominator

/// @notice A single real-world match/event that groups multiple betting markets.
/// e.g. "Arsenal vs Chelsea — Jun 14 2026" contains FTR market, Goals market, BTTS market.
struct MarketGroup {
    uint64   groupId;
    address  creator;
    string   title;              // "Arsenal vs Chelsea — Jun 14 2026"
    uint256  eventStartTime;
    uint256  maxGroupExposure;   // LP-backed max payout obligation for this event
    uint8    numMarkets;
    uint64[MAX_GROUP_MKTS] marketIds;  // IDs of all markets in this group
    bool     exists;
}

/// @notice An individual betting market within a MarketGroup.
/// e.g. the "Over 2.5 Goals" (GroupType.Goals) market inside the Arsenal vs Chelsea group.
struct Market {
    uint64      marketId;
    address     creator;
    uint256     startTime;
    MarketStatus status;
    uint8       numOutcomes;

    // ── Semi-Static Fixed Odds (replaces LMSR q_values + lmsr_b) ──────────────
    uint256[MAX_OUTCOMES] currentOdds;    // decimal odds × ODDS_PRECISION; set by oracle
    uint256[MAX_OUTCOMES] oddsAnchor;     // consensus odds at market creation (Pinnacle/API)
    uint256 maxDeviationBps;              // on-chain guarantee: currentOdds ≤ anchor ± this
    uint256[MAX_OUTCOMES] volumeCap;      // per-outcome max payout liability (LP-backed)
    uint256[MAX_OUTCOMES] volumeFilled;   // per-outcome running payout liability
    uint256 oddsLastUpdated;              // block.timestamp of last updateOdds call

    // ── Settlement ─────────────────────────────────────────────────────────────
    uint256  exposure;
    uint256  settlementTime;
    uint8    winningOutcome;

    // ── Metadata ───────────────────────────────────────────────────────────────
    string   title;
    string   description;
    uint8    category;           // sport category byte (0=football, 1=tennis, …)

    // ── Market Group membership ────────────────────────────────────────────────
    uint64   groupId;
    bool     hasGroup;
    uint8    groupMarketIndex;   // index of this market within its group's marketIds array
    GroupType marketType;        // what kind of bet this is → drives parlay discount

    // ── Epoch ──────────────────────────────────────────────────────────────────
    uint64   epochId;
    bool     settledInEpoch;

    // ── Per-market financials ──────────────────────────────────────────────────
    uint256  backing;            // sum of all stakes collected on this market
    uint256  lockedPayout;       // total outstanding redemption liability
}

/// @notice Time-bounded LP period. All markets within an epoch share the LP pool.
///
/// Timeline:
///   [initEpoch called]
///     → deposit window opens  (LPs deposit USDC, receive shares)
///   [startTime]
///     → deposit window CLOSES (no more deposits)
///     → markets open for betting
///   [endTime]
///     → no new bets accepted
///     → oracle settles markets
///   [allMarketsSettled == true]
///     → withdrawalsEnabled flipped by advanceEpoch
///     → LPs requestWithdraw → processWithdrawal (after cooldown)
struct Epoch {
    uint64   epochId;
    uint256  startTime;           // epoch trading begins; deposit window closes here
    uint256  endTime;             // epoch trading ends
    uint256  totalLiquidityAdded;    // sum of all LP deposits this epoch
    uint256  totalLiquidityRemoved;  // sum of all LP withdrawals this epoch
    uint16   numMarkets;
    uint16   numSettledMarkets;
    bool     allMarketsSettled;
    bool     withdrawalsEnabled;
    bool     initialized;            // guards against double-init (fixes epoch-0 bug)
    uint256  lpSharesAtClose;
    // Risk controls (from MD files)
    uint256  maxExposureMultiplierBps; // e.g. 15_000 = 1.5× → max LP loss = 50% of deposit
    uint256  totalLockedPayouts;       // running payout obligations; must stay ≤ maxExposure
    // Category governance
    uint8    winningSportCategory;     // SportCategory with most vote-weight this epoch
}

/// @notice One leg of a multi-market bet slip.
struct SlipLeg {
    uint64  marketId;
    uint8   outcomeId;
    uint256 stake;           // base-token amount staked on this leg
    uint256 odds;            // odds at placement (× ODDS_PRECISION); locked at bet time
}

/// @notice Multi-leg accumulator bet. All legs must win for payout.
struct BetSlip {
    uint64      slipId;
    address     creator;
    SlipLeg[MAX_SLIP_LEGS] legs;
    uint8       numLegs;
    uint256     totalStake;
    uint256     combinedOdds;     // product of all leg odds (× ODDS_PRECISION)
    uint256     houseMarginBps;   // margin applied at placement
    uint256     potentialPayout;  // stake × combinedOdds / ODDS_PRECISION
    uint256     discountBps;      // parlay correlation discount applied
    uint256     lockedAmount;     // LP-backed bonus gap reserved for this slip
    bool        claimed;
    SlipStatus  status;
    uint256     createdAt;
}

/// @notice Peer-to-peer limit order.
struct Order {
    uint64    orderId;
    uint64    marketId;
    uint8     outcomeId;
    OrderSide side;
    address   maker;
    uint256   numShares;
    uint256   pricePerShare;    // ODDS_PRECISION-scaled
    uint256   expiresAt;
    uint256   filledShares;
    bool      cancelled;
}

/// @notice Queued LP withdrawal (cooldown-gated).
struct WithdrawalRequest {
    uint256  shares;
    uint256  requestedAt;
    uint64   epochId;
    bool     exists;
}

/// @notice Pending LP deposit waiting for next epoch activation.
struct PendingLiquidity {
    uint256  amount;
    uint256  shares;
    uint256  activationTime;
    uint64   epochId;
    bool     exists;
}

/// @notice Oracle-proposed settlement with challenge window.
struct Dispute {
    uint64        marketId;
    uint8         proposedOutcome;
    address       proposer;
    uint256       createdAt;
    uint256       challengeDeadline;
    DisputeStatus status;
}

// ─── Events ───────────────────────────────────────────────────────────────────

interface IQuadraticMarketEvents {
    // Admin
    event AdminTransferred(address indexed prevAdmin, address indexed newAdmin);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);
    event ProtocolPaused(address indexed by);
    event ProtocolUnpaused(address indexed by);
    event ConfigUpdated(address indexed by);

    // Epoch
    event EpochInitialized(uint64 indexed epochId, uint256 startTime, uint256 endTime);
    event EpochAdvanced(uint64 indexed prevEpoch, uint64 indexed newEpoch);

    // Markets
    event MarketCreated(
        uint64 indexed marketId,
        uint64 indexed groupId,
        GroupType marketType,
        string title,
        uint256 startTime
    );
    event MarketStatusChanged(uint64 indexed marketId, MarketStatus status);
    event OddsUpdated(uint64 indexed marketId, uint256[MAX_OUTCOMES] newOdds, uint256 timestamp);

    // Trading
    event BetPlaced(
        uint64 indexed marketId,
        address indexed bettor,
        uint8 outcomeId,
        uint256 stake,
        uint256 odds,
        uint256 payout
    );
    event CashOut(
        uint64 indexed marketId,
        address indexed bettor,
        uint8 outcomeId,
        uint256 shares,
        uint256 payout
    );

    // Bet Slips
    event SlipPlaced(
        uint64 indexed slipId,
        address indexed creator,
        uint8 numLegs,
        uint256 totalStake,
        uint256 potentialPayout
    );
    event SlipClaimed(uint64 indexed slipId, address indexed creator, uint256 payout);
    event SlipCancelled(uint64 indexed slipId, address indexed creator);

    // Settlement
    event ResultProposed(uint64 indexed marketId, uint8 outcome, address indexed oracle);
    event ResultOverridden(uint64 indexed marketId, uint8 correctedOutcome, address indexed admin);
    event MarketFinalized(uint64 indexed marketId, uint8 winningOutcome);
    event PayoutClaimed(uint64 indexed marketId, address indexed bettor, uint256 amount);

    // LP
    event LiquidityAdded(address indexed lp, uint256 amount, uint256 sharesIssued, uint64 epochId);
    event WithdrawalRequested(address indexed lp, uint256 shares, uint64 epochId);
    event WithdrawalProcessed(address indexed lp, uint256 amount, uint256 shares);
    event CategoryVoted(address indexed lp, uint64 indexed epochId, SportCategory category, uint256 weight);
    event EpochDepositsGated(uint64 indexed epochId, uint256 startTime);

    // Market Groups
    event MarketGroupCreated(uint64 indexed groupId, string title, uint256 eventStartTime);
    event MarketAddedToGroup(uint64 indexed groupId, uint64 indexed marketId, uint8 index);

    // Orders
    event OrderPlaced(uint64 indexed orderId, uint64 indexed marketId, address indexed maker);
    event OrderFilled(uint64 indexed orderId, address indexed taker, uint256 shares);
    event OrderCancelled(uint64 indexed orderId, address indexed maker);
}

/// @notice Struct passed to updateConfig to avoid stack-too-deep on many params.
struct ConfigUpdate {
    uint256 maxMarketExposure;
    uint256 challengeWindowSeconds;
    uint256 settlementDeadlineSeconds;
    uint256 slipHouseMarginBps;
    uint256 maxSlipBonusMultiplierBps;
    uint256 epochDurationSeconds;
    uint256 withdrawalCooldownSeconds;
    uint256 maxSingleBet;
    uint256 buyFeeBps;
    uint256 cashOutMarginBps;
    uint256 crossMatchBonusPerPairBps;
    address oracle;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

interface IQuadraticMarketErrors {
    error Unauthorized();
    error ProtocolIsPaused();
    error InvalidAmount();
    error InsufficientLiquidity();
    error MathOverflow();
    error ZeroAddress();

    error MarketNotOpen();
    error MarketAlreadyStarted();
    error InvalidOutcomeId();
    error MaxExposureReached();
    error MarketAlreadySettled();
    error InvalidNumOutcomes();
    error MarketNotSettled();
    error MarketNotVoidable();
    error InvalidMarketStatus();
    error MarketExpired();
    error SettlementDeadlineNotPassed();
    error VolumeCapExceeded();

    error OddsDeviationExceeded();
    error OddsBelowMinimum();
    error OddsSlippageExceeded();    // bet rejected: odds moved below user's minOdds

    error SlipNoLegs();
    error SlipTooManyLegs();
    error SlipAlreadyClaimed();
    error SlipNotActive();
    error SlipStillOpen();

    error EpochNotSettled();
    error EpochAlreadyInitialized();
    error WithdrawalCooldownActive();
    error NoPendingWithdrawal();
    error EpochLiquidityGated();

    error GroupNotFound();
    error GroupFull();
    error InvalidOracleSignature();
    error ChallengeWindowActive();
    error ChallengeWindowExpired();

    error OrderExpired();
    error OrderAlreadyCancelled();
    error OrderInsufficientShares();
}
