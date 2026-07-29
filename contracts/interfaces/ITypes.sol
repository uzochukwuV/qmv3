// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// â”€â”€â”€ Enums â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

enum MarketStatus {
    PreOpen,          // Created, not yet open for betting
    Open,             // Accepting bets
    Suspended,        // Temporarily halted (e.g. live incident)
    AwaitingResult,   // Match finished, waiting for oracle to propose result
    Proposed,         // Oracle proposed outcome, in challenge window
    Settled,          // Finalized â€” winners can claim
    Voided            // Cancelled â€” all stakes refunded
}

enum MarketMode {
    FixedOdds,        // Default for sports â€” oracle-priced, buy_at_odds only
    Trading           // Prediction market style â€” direct share trading
}

/// @notice Type of betting market. Determines same-match parlay correlation discount.
/// A MarketGroup (real-world match) contains multiple Markets, each with a GroupType.
/// e.g. Arsenal vs Chelsea group: Market A (FTR), Market B (Goals), Market C (BTTS).
enum GroupType {
    FTR,              // 0 â€” Full-Time Result: Home / Draw / Away
    Goals,            // 1 â€” Goals: Over 2.5 / Under 2.5 / Over 3.5 etc.
    BTTS,             // 2 â€” Both Teams To Score: Yes / No
    AsianHandicap,    // 3 â€” Asian Handicap lines
    FirstGoal,        // 4 â€” First Goalscorer
    CorrectScore,     // 5 â€” Correct Score
    HTResult,         // 6 â€” Half-Time Result
    PlayerProps       // 7 â€” Player Props (shots, cards, etc.)
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
    Resolved,         // Challenge window passed - oracle result stands
    Overridden        // Admin corrected the oracle result
}

/// @notice How a market derives its winning outcome from a finalized match score.
enum SettlementRule {
    Manual,           // legacy per-market oracle result
    FTR,              // home/draw/away from final score
    BTTS,             // both teams scored: yes/no
    TotalGoalsOver,   // total goals > settlementLine, where 25 means 2.5
    TotalGoalsUnder   // total goals < settlementLine, where 25 means 2.5
}

/// @notice Sport categories LPs vote on each epoch.
///         Admin creates markets only within the winning category/categories.
///         Voting weight = LP share balance at time of vote.
enum SportCategory {
    Football,         // 0 â€” Soccer / Association Football
    Tennis,           // 1
    Basketball,       // 2
    AmericanFootball, // 3
    Esports,          // 4
    Other             // 5
}

// â”€â”€â”€ Structs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

uint256 constant MAX_OUTCOMES         = 8;
uint256 constant MAX_SLIP_LEGS        = 8;
uint256 constant MAX_GROUP_MKTS       = 8;
uint256 constant MAX_OPERATORS        = 8;
uint256 constant ODDS_PRECISION       = 1_000_000;   // 2.80 stored as 2_800_000
uint256 constant BPS                  = 10_000;       // basis points denominator
uint256 constant SETTLE_REWARD_BPS   = 10;           // caller reward for settleLostSlip (0.1%)
uint8   constant NUM_SPORT_CATEGORIES = 6;            // length of the SportCategory enum

/// @notice A single real-world match/event that groups multiple betting markets.
/// e.g. "Arsenal vs Chelsea â€” Jun 14 2026" contains FTR market, Goals market, BTTS market.
struct MarketGroup {
    uint64   groupId;
    address  creator;
    string   title;              // "Arsenal vs Chelsea â€” Jun 14 2026"
    uint256  eventStartTime;
    uint256  maxGroupExposure;   // LP-backed max payout obligation for this event
    uint256  currentExposure;    // running payout liability linked to this event
    uint8    numMarkets;
    uint64[MAX_GROUP_MKTS] marketIds;  // IDs of all markets in this group
    bool     exists;

    // Group-level state-space pricing for the 3-market football book.
    bool     pricingInitialized;
    uint256  pricingB;           // LMSR depth parameter, 1e18-scaled
    int256[9] stateQ;            // cumulative state shares, 1e18-scaled

    // Group-level canonical settlement. One final score settles all score-derived child markets.
    uint16   homeScore;
    uint16   awayScore;
    bool     resultFinalized;
    bytes32  settlementProofHash;
}

/// @notice An individual betting market within a MarketGroup.
/// e.g. the "Over 2.5 Goals" (GroupType.Goals) market inside the Arsenal vs Chelsea group.
struct Market {
    uint64      marketId;
    address     creator;
    uint256     startTime;
    MarketStatus status;
    uint8       numOutcomes;

    // â”€â”€ Semi-Static Fixed Odds (replaces LMSR q_values + lmsr_b) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    uint256[MAX_OUTCOMES] currentOdds;    // decimal odds Ã— ODDS_PRECISION; set by oracle
    uint256[MAX_OUTCOMES] oddsAnchor;     // consensus odds at market creation (Pinnacle/API)
    uint256 maxDeviationBps;              // on-chain guarantee: currentOdds â‰¤ anchor Â± this
    uint256[MAX_OUTCOMES] volumeCap;      // per-outcome max payout liability (LP-backed)
    uint256[MAX_OUTCOMES] volumeFilled;   // per-outcome running payout liability
    uint256[MAX_OUTCOMES] slipVolumeFilled; // per-outcome liability from active multi-leg slips
    uint256 oddsLastUpdated;              // block.timestamp of last updateOdds call
    bytes32  oddsProofHash;               // txodds odds hash/id commitment

    // â”€â”€ Settlement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    uint256  exposure;
    uint256  settlementTime;
    uint8    winningOutcome;

    // â”€â”€ Metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    string   title;
    string   description;
    uint8    category;           // sport category byte (0=football, 1=tennis, â€¦)

    // â”€â”€ Market Group membership â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    uint64   groupId;
    bool     hasGroup;
    uint8    groupMarketIndex;   // index of this market within its group's marketIds array
    GroupType marketType;        // what kind of bet this is - drives parlay discount

    // Score-derived settlement metadata. Outcome IDs are configurable because markets may
    // list outcomes in different orders, e.g. [Away, Draw, Home] instead of [Home, Draw, Away].
    SettlementRule settlementRule;
    uint16   settlementLine;     // total-goals line in tenths: 25 = 2.5, 35 = 3.5
    uint8    homeOutcomeId;
    uint8    drawOutcomeId;
    uint8    awayOutcomeId;
    uint8    yesOutcomeId;
    uint8    noOutcomeId;
    uint8    overOutcomeId;
    uint8    underOutcomeId;
    // â”€â”€ Epoch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    uint64   epochId;
    bool     settledInEpoch;

    // â”€â”€ Per-market financials â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    uint256  backing;            // sum of all stakes collected on this market
    uint256  lockedPayout;       // total outstanding redemption liability
}

/// @notice Compact market view for slip validation and settlement checks.
struct MarketSlipView {
    MarketStatus status;
    uint256 startTime;
    uint8 numOutcomes;
    uint64 epochId;
    uint64 groupId;
    GroupType marketType;
    uint256[MAX_OUTCOMES] currentOdds;
    uint256[MAX_OUTCOMES] volumeCap;
    uint256[MAX_OUTCOMES] volumeFilled;
    uint256[MAX_OUTCOMES] slipVolumeFilled;
    uint8 winningOutcome;
}

/// @notice Compact epoch view for slip validation.
struct EpochSlipView {
    uint256 totalLiquidityAdded;
    uint256 maxExposureMultiplierBps;
    uint256 totalLockedPayouts;
}

/// @notice Time-bounded LP period. All markets within an epoch share the LP pool.
///
/// Timeline:
///   [initEpoch called]
///     → deposit window opens (LPs deposit USDC, receive shares)
///     → admin declares markets (createMarketGroup + createMarket)
///   [startTime]
///     → deposit window CLOSES (no more deposits)
///     → admin calls openEpochForTrading() to open all markets
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
    bool     marketsDeclared;        // true when at least one market has been created
    bool     tradingOpen;            // true when openEpochForTrading() has been called
    uint256  lpSharesAtClose;
    // Risk controls (from MD files)
    uint256  maxExposureMultiplierBps; // e.g. 15_000 = 1.5× → max LP loss = 50% of deposit
    uint256  totalLockedPayouts;       // running payout obligations; must stay ≤ maxExposure
    // Category governance
    uint8    winningSportCategory;     // SportCategory with most vote-weight this epoch
}

/// @notice One leg stored inside a placed BetSlip (locked at placement time).
struct SlipLeg {
    uint64  marketId;
    uint8   outcomeId;
    uint256 odds;            // odds Ã— ODDS_PRECISION, locked at bet placement
}

/// @notice Input descriptor for one leg when calling placeSlip.
struct PlaceSlipLeg {
    uint64  marketId;
    uint8   outcomeId;
    uint256 minOdds;         // per-leg slippage guard â€” reverts if current odds < this
}

/// @notice Full input for placeSlip (avoids stack-too-deep on many params).
struct PlaceSlipParams {
    PlaceSlipLeg[MAX_SLIP_LEGS] legs;
    uint8   numLegs;
    uint256 totalStake;         // single USDC amount staked on the whole accumulator
    uint256 minCombinedOdds;    // overall slippage guard on final combined odds
}

struct SlipQuote {
    uint64 epochId;
    uint8 numLegs;
    uint256 totalStake;
    uint256 combinedOdds;
    uint256 potentialPayout;
    uint256 houseMarginBps;
    uint256 discountBps;
    uint256 crossBonusBps;
}

struct SlipStatusView {
    SlipStatus status;
    address owner;
    bool pending;
    bool won;
    bool hasVoid;
    bool hasLost;
    bool claimable;
    bool refundable;
    uint256 potentialPayout;
}

/// @notice Multi-leg accumulator bet. All legs must win for payout.
///
/// Tokenization: ownership is tracked by slipOwner[slipId] in the main contract,
/// NOT by `creator`. The current owner receives the payout, not the original placer.
/// Ownership can be transferred via transferSlip / approveSlip / setSlipOperator,
/// making the slip a tradeable instrument in the Phase 6 P2P marketplace.
///
/// Void rule (V1): if ANY leg's market is voided, slip is refunded in full.
struct BetSlip {
    uint64      slipId;
    address     creator;         // original placer (historical record only)
    uint64      epochId;         // all legs belong to this epoch
    SlipLeg[MAX_SLIP_LEGS] legs;
    uint8       numLegs;
    uint256     totalStake;
    uint256     combinedOdds;    // final odds after margin + discount + cross-match bonus
    uint256     houseMarginBps;  // margin captured at placement
    uint256     discountBps;     // correlation discount applied (FULL_BPS = 10_000 = no discount)
    uint256     crossBonusBps;   // cross-match bonus applied
    uint256     potentialPayout; // totalStake Ã— combinedOdds / ODDS_PRECISION
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
    uint256  snapshotNav;   // NAV (Ã— ODDS_PRECISION) at request time â€” withdrawal uses min(snapshot, current)
    uint64   epochId;
    bool     exists;

}

struct LPStats {
    uint256 shares;
    uint256 totalShares;
    uint256 nav;
    uint256 positionValue;
    uint256 freeLiquidity;
    uint256 pendingWithdrawalShares;
    uint256 withdrawalAvailableAt;
    uint64 withdrawalEpochId;
    bool withdrawalPending;
    bool withdrawalEpochSettled;
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

/// @notice Oracle-proposed canonical final score for a whole MarketGroup.
struct GroupDispute {
    uint64        groupId;
    uint16        homeScore;
    uint16        awayScore;
    address       proposer;
    uint256       createdAt;
    uint256       challengeDeadline;
    DisputeStatus status;
    bool          exists;
}

// â”€â”€â”€ Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    event EpochTradingOpened(uint64 indexed epochId);

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
    event OddsProofPosted(uint64 indexed marketId, bytes32 indexed proofHash, string proofId);

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
    event SlipClaimed(uint64 indexed slipId, address indexed owner, uint256 payout);
    event SlipCancelled(uint64 indexed slipId, address indexed owner);
    event SlipVoidRefund(uint64 indexed slipId, address indexed owner, uint256 refund);
    event SlipLostSettled(uint64 indexed slipId, address indexed owner);
    // Slip token events (ERC721-like transfer primitives for P2P marketplace)
    event SlipTransferred(uint64 indexed slipId, address indexed from, address indexed to);
    event SlipApproved(uint64 indexed slipId, address indexed owner, address indexed approved);
    event SlipOperatorSet(address indexed owner, address indexed operator, bool approved);

    // Settlement
    event ResultProposed(uint64 indexed marketId, uint8 outcome, address indexed oracle);
    event ResultOverridden(uint64 indexed marketId, uint8 correctedOutcome, address indexed admin);
    event GroupResultProposed(uint64 indexed groupId, uint16 homeScore, uint16 awayScore, address indexed oracle);
    event GroupResultOverridden(uint64 indexed groupId, uint16 homeScore, uint16 awayScore, address indexed admin);
    event GroupFinalized(uint64 indexed groupId, uint16 homeScore, uint16 awayScore);
    event GroupSettlementProofPosted(uint64 indexed groupId, bytes32 indexed proofHash, string proofId);
    event MarketFinalized(uint64 indexed marketId, uint8 winningOutcome);
    event PayoutClaimed(uint64 indexed marketId, address indexed bettor, uint256 amount);
    event VoidRefunded(uint64 indexed marketId, address indexed bettor, uint256 amount);

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

/// @notice Parameters for creating a new betting market (avoids stack-too-deep).
///         oddsAnchor must be signed by the oracle to prove external provenance.
struct CreateMarketParams {
    uint64      groupId;          // MarketGroup this belongs to (0 = standalone)
    string      title;            // e.g. "Full-Time Result"
    string      description;      // extended description
    uint256     startTime;        // unix timestamp when the event kicks off (bets close here)
    uint8       numOutcomes;      // 2â€“8
    GroupType   marketType;       // FTR / Goals / BTTS / AsianHandicap / â€¦
    uint8       category;         // uint8(SportCategory)
    uint256[MAX_OUTCOMES] oddsAnchor;  // reference odds signed by oracle (Ã— ODDS_PRECISION)
    uint256     maxDeviationBps;  // max oracle drift from anchor (0 â†’ 10% default)
    uint256[MAX_OUTCOMES] volumeCap;   // per-outcome payout cap (0 -> auto from epoch LP pool)
    SettlementRule settlementRule;      // how this market is settled from a group score
    uint16      settlementLine;         // total-goals line in tenths: 25 = 2.5
    uint8       homeOutcomeId;          // FTR home outcome id
    uint8       drawOutcomeId;          // FTR draw outcome id
    uint8       awayOutcomeId;          // FTR away outcome id
    uint8       yesOutcomeId;           // BTTS yes outcome id
    uint8       noOutcomeId;            // BTTS no outcome id
    uint8       overOutcomeId;          // totals over outcome id
    uint8       underOutcomeId;         // totals under outcome id
    uint256     sigDeadline;      // oracle sig expires after this timestamp
    bytes       oracleSig;        // oracle ECDSA sig over (params + chainId + address(this))
}

/// @notice Struct passed to updateConfig to avoid stack-too-deep on many params.
///         Pass type(uint256).max (or address(type(uint160).max) for oracle) to leave a field unchanged.
///         Pass the desired value â€” including 0 â€” to update a field.
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

// â”€â”€â”€ Errors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    error EpochNotInitialized();
    error MarketsNotDeclared();
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
