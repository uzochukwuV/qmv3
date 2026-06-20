// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/ITypes.sol";
import "./interfaces/IInterContract.sol";

/// @title SlipStorage
/// @notice Abstract base for BetSlips — owns all slip token ownership state.
///
/// State ownership:
///   BetSlips (this):  slipOwner, slipApproved, slipOperatorApprovals,
///                      betSlips (data), slip counters
///   Core:             markets, epochs, outcomeBalances, fee params
abstract contract SlipStorage is ReentrancyGuard, IQuadraticMarketEvents, IQuadraticMarketErrors {
    using SafeERC20 for IERC20;

    // ─── Cross-contract reference ──────────────────────────────────────────────

    address public core;

    // ─── Slip ID counter ─────────────────────────────────────────────────────

    uint64 public nextSlipId;

    // ─── Slip token ownership ─────────────────────────────────────────────────

    /// @notice Current owner of a slip (receives payout / void-refund). Transferable.
    mapping(uint64 => address) public slipOwner;

    /// @notice Single-address per-slip approval (cleared on transfer).
    mapping(uint64 => address) public slipApproved;

    /// @notice Operator approval — owner grants an address rights over ALL their slips.
    mapping(address => mapping(address => bool)) public slipOperatorApprovals;

    // ─── Slip data (mirrored from Core's betSlips for direct access) ──────────

    /// @notice Slip data: slipId → BetSlip struct.
    mapping(uint64 => BetSlip) public betSlips;

    // ─── Epoch locked-payout tracking ─────────────────────────────────────────

    mapping(uint64 => uint256) public slipEpochLockedPayouts;

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyCore() {
        if (msg.sender != core) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (ICore(core).paused()) revert ProtocolIsPaused();
        _;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /// @dev Returns the base token address from Core.
    function _baseToken() internal view returns (IERC20) {
        return ICore(core).baseToken();
    }

    /// @dev Revert if msg.sender is not the slip owner, single approved address,
    ///      or an operator approved by the current owner.
    function _requireSlipAuth(uint64 slipId) internal view {
        address owner = slipOwner[slipId];
        if (owner == address(0)) revert InvalidMarketStatus();
        if (msg.sender == owner)                      return;
        if (msg.sender == slipApproved[slipId])       return;
        if (slipOperatorApprovals[owner][msg.sender]) return;
        revert Unauthorized();
    }
}
