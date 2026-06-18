import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, encodePacked, getAddress, keccak256, parseAbiParameters, parseUnits, toBytes } from "viem";

const MAX_OUTCOMES = 8;

function odds(value: string) {
  return parseUnits(value, 6);
}

function emptyOdds() {
  return Array<bigint>(MAX_OUTCOMES).fill(0n) as [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
}

async function signPacked(
  oracle: Awaited<ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getWalletClients"]>>[number],
  types: Parameters<typeof encodePacked>[0],
  values: Parameters<typeof encodePacked>[1],
) {
  const digest = keccak256(encodePacked(types, values));
  return oracle.signMessage({ message: { raw: digest } });
}

async function signCreateMarket(
  market: any,
  oracle: Awaited<ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getWalletClients"]>>[number],
  publicClient: Awaited<ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getPublicClient"]>>,
  params: {
    groupId: bigint;
    title: string;
    description: string;
    startTime: bigint;
    numOutcomes: number;
    marketType: number;
    category: number;
    oddsAnchor: ReturnType<typeof emptyOdds>;
    maxDeviationBps: bigint;
    volumeCap: ReturnType<typeof emptyOdds>;
    sigDeadline: bigint;
  },
) {
  const nonce = await market.read.marketCreationNonce();
  const digest = keccak256(encodeAbiParameters(
    parseAbiParameters("string,uint256,address,uint64,uint256,uint64,bytes32,bytes32,uint256,uint8,uint8,uint8,uint256[8],uint256,uint256[8],uint256"),
    [
      "QM:createMarket:v2",
      BigInt(await publicClient.getChainId()),
      getAddress(market.address),
      await market.read.currentEpoch(),
      nonce,
      params.groupId,
      keccak256(toBytes(params.title)),
      keccak256(toBytes(params.description)),
      params.startTime,
      params.numOutcomes,
      params.marketType,
      params.category,
      params.oddsAnchor,
      params.maxDeviationBps,
      params.volumeCap,
      params.sigDeadline,
    ],
  ));
  return oracle.signMessage({ message: { raw: digest } });
}

describe("QuadraticSlipMarketplace", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployFixture() {
    const [admin, oracle, lp, seller, buyer] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const token = await viem.deployContract("MockUSDC");
    const market = await viem.deployContract("QuadraticMarket", [
      token.address,
      oracle.account.address,
      parseUnits("100000", 6),
    ]);
    const marketplace = await viem.deployContract("QuadraticSlipMarketplace", [
      market.address,
    ]);

    const lpDeposit = parseUnits("1000", 6);
    const sellerBalance = parseUnits("100", 6);
    const buyerBalance = parseUnits("500", 6);

    await token.write.mint([lp.account.address, lpDeposit]);
    await token.write.mint([seller.account.address, sellerBalance]);
    await token.write.mint([buyer.account.address, buyerBalance]);

    await token.write.approve([market.address, lpDeposit], { account: lp.account });
    await token.write.approve([market.address, sellerBalance], { account: seller.account });
    await token.write.approve([marketplace.address, buyerBalance], { account: buyer.account });

    return {
      admin,
      oracle,
      lp,
      seller,
      buyer,
      publicClient,
      token,
      market,
      marketplace,
      lpDeposit,
      sellerBalance,
      buyerBalance,
    };
  }

  it("lets a buyer bid for a pending slip and claim after the final leg wins", async function () {
    const {
      oracle,
      lp,
      seller,
      buyer,
      publicClient,
      token,
      market,
      marketplace,
      lpDeposit,
      sellerBalance,
      buyerBalance,
    } = await networkHelpers.loadFixture(deployFixture);

    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;
    const sigDeadline = now + 3_600n;
    const challengeWindow = await market.read.challengeWindowSeconds();

    await market.write.initEpoch([epochStart, 15_000n]);
    await market.write.addLiquidity([lpDeposit], { account: lp.account });

    await market.write.createMarketGroup([
      "Arsenal vs Chelsea",
      marketStart,
      parseUnits("1500", 6),
    ]);

    const oddsAnchor = emptyOdds();
    oddsAnchor[0] = odds("2");
    oddsAnchor[1] = odds("2");

    const volumeCap = emptyOdds();
    volumeCap[0] = parseUnits("500", 6);
    volumeCap[1] = parseUnits("500", 6);

    for (let i = 0; i < 3; i++) {
      const marketParams = {
        groupId: 1n,
        title: `Leg ${i + 1}`,
        description: "Binary leg",
        startTime: marketStart,
        numOutcomes: 2,
        marketType: i,
        category: 0,
        oddsAnchor,
        maxDeviationBps: 1_000n,
        volumeCap,
        sigDeadline,
      };
      const createSig = await signCreateMarket(market, oracle, publicClient, marketParams);
      await market.write.createMarket([
        {
          ...marketParams,
          sigDeadline,
          oracleSig: createSig,
        },
      ]);
    }

    await networkHelpers.time.increaseTo(Number(epochStart));
    await market.write.bulkOpenMarkets([[1n, 2n, 3n]]);

    const legs = [
      { marketId: 1n, outcomeId: 0, minOdds: odds("1.9") },
      { marketId: 2n, outcomeId: 0, minOdds: odds("1.9") },
      { marketId: 3n, outcomeId: 0, minOdds: odds("1.9") },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
    ] as const;

    const stake = parseUnits("10", 6);
    await market.write.placeSlip([
      {
        legs,
        numLegs: 3,
        totalStake: stake,
        minCombinedOdds: odds("5"),
      },
    ], { account: seller.account });

    const slipId = 1n;
    assert.equal(await market.read.slipOwner([slipId]), getAddress(seller.account.address));

    await networkHelpers.time.increaseTo(Number(marketStart));

    for (const marketId of [1n, 2n]) {
      const resultDeadline = BigInt(await networkHelpers.time.latest()) + 3_600n;
      const resultSig = await signPacked(
        oracle,
        ["string", "uint256", "address", "uint64", "uint8", "uint256"],
        [
          "QM:proposeResult",
          await publicClient.getChainId(),
          getAddress(market.address),
          marketId,
          0,
          resultDeadline,
        ],
      );
      await market.write.proposeResult([marketId, 0, resultDeadline, resultSig]);
      await networkHelpers.time.increase(Number(challengeWindow));
      await market.write.finalizeResult([marketId]);
    }

    const [pending, wonBeforeSale] = await market.read.slipResult([slipId]);
    assert.equal(pending, true);
    assert.equal(wonBeforeSale, false);

    await market.write.setSlipOperator([marketplace.address, true], {
      account: seller.account,
    });

    const bidAmount = parseUnits("30", 6);
    const bidExpiry = BigInt(await networkHelpers.time.latest()) + 3_600n;
    await marketplace.write.placeBid([slipId, bidAmount, bidExpiry], {
      account: buyer.account,
    });

    await marketplace.write.acceptBid([1n], { account: seller.account });

    assert.equal(await market.read.slipOwner([slipId]), getAddress(buyer.account.address));
    assert.equal(await token.read.balanceOf([seller.account.address]), sellerBalance - stake + bidAmount);
    assert.equal(await token.read.balanceOf([buyer.account.address]), buyerBalance - bidAmount);

    const finalDeadline = BigInt(await networkHelpers.time.latest()) + 3_600n;
    const finalSig = await signPacked(
      oracle,
      ["string", "uint256", "address", "uint64", "uint8", "uint256"],
      [
        "QM:proposeResult",
        await publicClient.getChainId(),
        getAddress(market.address),
        3n,
        0,
        finalDeadline,
      ],
    );
    await market.write.proposeResult([3n, 0, finalDeadline, finalSig]);
    await networkHelpers.time.increase(Number(challengeWindow));
    await market.write.finalizeResult([3n]);

    await market.write.claimSlipPayout([slipId], { account: buyer.account });

    assert.equal(await market.read.slipOwner([slipId]), "0x0000000000000000000000000000000000000000");
    assert.equal(await token.read.balanceOf([buyer.account.address]) > buyerBalance - bidAmount, true);
  });
});
