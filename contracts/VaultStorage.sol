// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/ITypes.sol";
import "./interfaces/IInterContract.sol"; // ILiquidityVault, ICore

/// @title VaultStorage
/// @notice Abstract base for LiquidityVault — owns all LP vault state.
///
/// State ownership:
///   Vault (this):  lpShares, withdrawalRequests, lpDepositsPerEpoch,
///                   epoch LP accounting, category votes, totalLpShares
///   Core:           baseToken, epochs, freeLiquidity
abstract contract VaultStorage is ReentrancyGuard, IQuadraticMarketEvents, IQuadraticMarketErrors {
    using SafeERC20 for IERC20;

    // Import SafeERC20 methods on IERC20 globally within this contract
    function _safeToken(IERC20 tok) internal pure returns (IERC20) {
        return tok; // SafeERC20 methods available via `using SafeERC20 for IERC20`
    }

    // ─── Cross-contract reference ──────────────────────────────────────────────

    address public core;

    // ─── Admin ──────────────────────────────────────────────────────────────

    address public admin;

    // ─── LP share accounting ──────────────────────────────────────────────────

    /// @notice Total LP shares in circulation (ERC4626-style NAV denominator).
    uint256 public totalLpShares;

    /// @notice LP shares: address → number of shares held.
    mapping(address => uint256) public lpShares;

    // ─── Withdrawal queue ─────────────────────────────────────────────────────

    /// @notice Pending withdrawal requests: address → request struct.
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    // ─── Epoch LP accounting ──────────────────────────────────────────────────

    /// @notice Total USDC deposited by an LP in a specific epoch.
    mapping(address => mapping(uint64 => uint256)) public lpDepositsPerEpoch;

    /// @notice Per-epoch LP totals (mirrors Core's epoch state for the Vault's use).
    mapping(uint64 => uint256) public epochLiquidityAdded;
    mapping(uint64 => uint256) public epochMaxExposureBps;
    mapping(uint64 => bool)    public epochInitialized;
    mapping(uint64 => bool)    public epochWithdrawalsEnabled;
    mapping(uint64 => uint256) public epochLockedPayouts;

    // ─── Category governance ──────────────────────────────────────────────────

    /// @notice LP's vote in a given epoch: (lp, epochId) → category byte + 1 (0 = no vote).
    mapping(address => mapping(uint64 => uint8)) public lpCategoryVote;

    /// @notice Total vote weight per category per epoch.
    mapping(uint64 => mapping(uint8 => uint256)) public epochCategoryVotes;

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyCore() {
        if (msg.sender != core) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (core == address(0)) revert ProtocolIsPaused();
        if (ICore(core).paused()) revert ProtocolIsPaused();
        _;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /// @dev Returns the base token address from Core.
    function _baseToken() internal view returns (IERC20) {
        return ICore(core).baseToken();
    }
}
