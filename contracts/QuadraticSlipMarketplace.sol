// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IQuadraticSlipTransfer {
    function baseToken() external view returns (IERC20);
    function slipOwner(uint64 slipId) external view returns (address);
    function transferSlip(uint64 slipId, address to) external;
}

/// @title QuadraticSlipMarketplace
/// @notice Escrowed peer-to-peer bid marketplace for QuadraticMarket bet slips.
///
/// Flow:
///   1. Slip owner calls QuadraticMarket.setSlipOperator(address(this), true).
///   2. Buyer calls placeBid(), escrowing base-token funds in this contract.
///   3. Current slip owner accepts a bid before the slip is finalized/claimed.
///   4. Marketplace transfers the slip to the buyer and pays the seller.
///
/// The marketplace never prices against the protocol and never buys slips itself.
/// It only matches a seller-approved P2P transfer against an escrowed bid.
contract QuadraticSlipMarketplace is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Bid {
        uint64 slipId;
        address bidder;
        uint256 amount;
        uint256 expiresAt;
        bool active;
    }

    IQuadraticSlipTransfer public immutable market;
    IERC20 public immutable baseToken;
    uint64 public nextBidId = 1;

    mapping(uint64 => Bid) public bids;

    event BidPlaced(
        uint64 indexed bidId,
        uint64 indexed slipId,
        address indexed bidder,
        uint256 amount,
        uint256 expiresAt
    );
    event BidAccepted(uint64 indexed bidId, uint64 indexed slipId, address indexed seller, address bidder, uint256 amount);
    event BidCancelled(uint64 indexed bidId, uint64 indexed slipId, address indexed bidder);

    error InvalidAmount();
    error InvalidExpiry();
    error InvalidBid();
    error BidExpired();
    error Unauthorized();
    error CannotBidOnOwnSlip();

    constructor(address _market) {
        if (_market == address(0)) revert InvalidBid();
        market = IQuadraticSlipTransfer(_market);
        baseToken = market.baseToken();
    }

    /// @notice Place an escrowed bid for an active slip.
    /// @param slipId Slip to bid on.
    /// @param amount Base-token amount offered to the current slip owner.
    /// @param expiresAt Unix timestamp after which the bid can no longer be accepted.
    function placeBid(uint64 slipId, uint256 amount, uint256 expiresAt)
        external
        nonReentrant
        returns (uint64 bidId)
    {
        if (amount == 0) revert InvalidAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        address owner = market.slipOwner(slipId);
        if (owner == address(0)) revert InvalidBid();
        if (owner == msg.sender) revert CannotBidOnOwnSlip();

        bidId = nextBidId;
        unchecked { ++nextBidId; }

        bids[bidId] = Bid({
            slipId: slipId,
            bidder: msg.sender,
            amount: amount,
            expiresAt: expiresAt,
            active: true
        });

        baseToken.safeTransferFrom(msg.sender, address(this), amount);
        emit BidPlaced(bidId, slipId, msg.sender, amount, expiresAt);
    }

    /// @notice Current slip owner accepts an escrowed bid.
    /// @dev Seller must have approved this marketplace as a slip operator in QuadraticMarket.
    function acceptBid(uint64 bidId) external nonReentrant {
        Bid memory bid = bids[bidId];
        if (!bid.active) revert InvalidBid();
        if (block.timestamp > bid.expiresAt) revert BidExpired();
        if (market.slipOwner(bid.slipId) != msg.sender) revert Unauthorized();

        delete bids[bidId];

        market.transferSlip(bid.slipId, bid.bidder);
        baseToken.safeTransfer(msg.sender, bid.amount);

        emit BidAccepted(bidId, bid.slipId, msg.sender, bid.bidder, bid.amount);
    }

    /// @notice Bidder cancels an active bid and receives escrow back.
    function cancelBid(uint64 bidId) external nonReentrant {
        Bid memory bid = bids[bidId];
        if (!bid.active) revert InvalidBid();
        if (bid.bidder != msg.sender) revert Unauthorized();

        delete bids[bidId];

        baseToken.safeTransfer(msg.sender, bid.amount);
        emit BidCancelled(bidId, bid.slipId, msg.sender);
    }
}
