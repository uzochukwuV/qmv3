import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import {
  encodeAbiParameters,
  encodePacked,
  getAddress,
  keccak256,
  parseAbiParameters,
  parseUnits,
  toBytes,
} from "viem";

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

type WalletClient = Awaited<
  ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getWalletClients"]>
>[number];
type PublicClient = Awaited<
  ReturnType<Awaited<ReturnType<typeof network.create>>["viem"]["getPublicClient"]>
>;

async function signPacked(
  oracle: WalletClient,
  types: Parameters<typeof encodePacked>[0],
  values: Parameters<typeof encodePacked>[1],
) {
  const digest = keccak256(encodePacked(types, values));
  return oracle.signMessage({ message: { raw: digest } });
}

async function signCreateMarket(
  market: any,
  oracle: WalletClient,
  publicClient: PublicClient,
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
  const digest = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string,uint256,address,uint64,uint256,uint64,bytes32,bytes32,uint256,uint8,uint8,uint8,uint256[8],uint256,uint256[8],uint256",
      ),
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
    ),
  );
  return oracle.signMessage({ message: { raw: digest } });
}

describe("QuadraticMarket regressions", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployFixture() {
    const [admin, oracle, lp, bettor] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const token = await viem.deployContract("MockUSDC");
    const market = await viem.deployContract("QuadraticMarket", [
      token.address,
      oracle.account.address,
      parseUnits("100000", 6),
    ]);

    const lpDeposit = parseUnits("1000", 6);
    const bettorBalance = parseUnits("1000", 6);
    await token.write.mint([lp.account.address, lpDeposit]);
    await token.write.mint([bettor.account.address, bettorBalance]);
    await token.write.approve([market.address, lpDeposit], { account: lp.account });
    await token.write.approve([market.address, bettorBalance], { account: bettor.account });

    return { admin, oracle, lp, bettor, publicClient, token, market, lpDeposit };
  }

  async function createSignedMarket(
    ctx: Awaited<ReturnType<typeof deployFixture>>,
    overrides: Partial<{
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
    }> = {},
  ) {
    const now = BigInt(await networkHelpers.time.latest());
    const oddsAnchor = overrides.oddsAnchor ?? emptyOdds();
    oddsAnchor[0] ||= odds("2");
    oddsAnchor[1] ||= odds("2");

    const volumeCap = overrides.volumeCap ?? emptyOdds();
    volumeCap[0] ||= parseUnits("500", 6);
    volumeCap[1] ||= parseUnits("500", 6);

    const params = {
      groupId: overrides.groupId ?? 0n,
      title: overrides.title ?? "Binary market",
      description: overrides.description ?? "Yes / No",
      startTime: overrides.startTime ?? now + 600n,
      numOutcomes: overrides.numOutcomes ?? 2,
      marketType: overrides.marketType ?? 0,
      category: overrides.category ?? 0,
      oddsAnchor,
      maxDeviationBps: overrides.maxDeviationBps ?? 1_000n,
      volumeCap,
      sigDeadline: overrides.sigDeadline ?? now + 3_600n,
    };
    const oracleSig = await signCreateMarket(ctx.market, ctx.oracle, ctx.publicClient, params);
    await ctx.market.write.createMarket([{ ...params, oracleSig }]);
    return params;
  }

  it("rejects createMarket signatures replayed with altered risk params", async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    await ctx.market.write.initEpoch([now + 60n, 15_000n]);
    await ctx.market.write.addLiquidity([ctx.lpDeposit], { account: ctx.lp.account });

    const oddsAnchor = emptyOdds();
    oddsAnchor[0] = odds("2");
    oddsAnchor[1] = odds("2");
    const volumeCap = emptyOdds();
    volumeCap[0] = parseUnits("100", 6);
    volumeCap[1] = parseUnits("100", 6);

    const params = {
      groupId: 0n,
      title: "Signed market",
      description: "Original risk params",
      startTime: now + 600n,
      numOutcomes: 2,
      marketType: 0,
      category: 0,
      oddsAnchor,
      maxDeviationBps: 1_000n,
      volumeCap,
      sigDeadline: now + 3_600n,
    };
    const oracleSig = await signCreateMarket(ctx.market, ctx.oracle, ctx.publicClient, params);

    await assert.rejects(
      ctx.market.write.createMarket([
        { ...params, maxDeviationBps: 9_000n, oracleSig },
      ]),
      /InvalidOracleSignature/,
    );

    await ctx.market.write.createMarket([{ ...params, oracleSig }]);
    await assert.rejects(
      ctx.market.write.createMarket([{ ...params, title: "Replay", oracleSig }]),
      /InvalidOracleSignature/,
    );
  });

  it("blocks empty epoch advancement before the epoch end time", async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    await ctx.market.write.initEpoch([now + 60n, 15_000n]);

    await assert.rejects(ctx.market.write.advanceEpoch(), /EpochNotSettled/);
  });

  it("blocks LP withdrawal processing while a new initialized epoch is unsettled", async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    await ctx.market.write.initEpoch([now + 30n, 15_000n]);
    await ctx.market.write.addLiquidity([ctx.lpDeposit], { account: ctx.lp.account });

    await networkHelpers.time.increaseTo(Number(now + 90_000n));
    await ctx.market.write.advanceEpoch();
    const shares = await ctx.market.read.lpShares([ctx.lp.account.address]);
    await ctx.market.write.requestWithdraw([shares], { account: ctx.lp.account });

    const nextStart = BigInt(await networkHelpers.time.latest()) + 60n;
    await ctx.market.write.initEpoch([nextStart, 15_000n]);
    const cooldown = await ctx.market.read.withdrawalCooldownSeconds();
    await networkHelpers.time.increase(Number(cooldown));

    await assert.rejects(
      ctx.market.write.processWithdrawal({ account: ctx.lp.account }),
      /EpochNotSettled/,
    );
  });

  it("applies per-outcome volume caps to slip placement", async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;
    await ctx.market.write.initEpoch([epochStart, 15_000n]);
    await ctx.market.write.addLiquidity([ctx.lpDeposit], { account: ctx.lp.account });

    const volumeCap = emptyOdds();
    volumeCap[0] = parseUnits("10", 6);
    volumeCap[1] = parseUnits("10", 6);
    await createSignedMarket(ctx, { startTime: marketStart, volumeCap });

    await networkHelpers.time.increaseTo(Number(epochStart));
    await ctx.market.write.openMarket([1n]);

    const legs = [
      { marketId: 1n, outcomeId: 0, minOdds: odds("1.9") },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
    ] as const;

    await assert.rejects(
      ctx.market.write.placeSlip([
        { legs, numLegs: 1, totalStake: parseUnits("10", 6), minCombinedOdds: odds("1") },
      ], { account: ctx.bettor.account }),
      /VolumeCapExceeded/,
    );
  });

  it("enforces market-group exposure caps on direct bets", async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;
    await ctx.market.write.initEpoch([epochStart, 15_000n]);
    await ctx.market.write.addLiquidity([ctx.lpDeposit], { account: ctx.lp.account });
    await ctx.market.write.createMarketGroup([
      "Low-cap event",
      marketStart,
      parseUnits("15", 6),
    ]);
    await createSignedMarket(ctx, { groupId: 1n, startTime: marketStart });

    await networkHelpers.time.increaseTo(Number(epochStart));
    await ctx.market.write.openMarket([1n]);

    await assert.rejects(
      ctx.market.write.buyAtOdds([1n, 0, parseUnits("10", 6), odds("1.9")], {
        account: ctx.bettor.account,
      }),
      /VolumeCapExceeded/,
    );
  });

  it("settles losing slips and releases locked payout capacity", async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;
    await ctx.market.write.initEpoch([epochStart, 15_000n]);
    await ctx.market.write.addLiquidity([ctx.lpDeposit], { account: ctx.lp.account });
    await createSignedMarket(ctx, { startTime: marketStart });

    await networkHelpers.time.increaseTo(Number(epochStart));
    await ctx.market.write.openMarket([1n]);

    const legs = [
      { marketId: 1n, outcomeId: 0, minOdds: odds("1.9") },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
      { marketId: 0n, outcomeId: 0, minOdds: 0n },
    ] as const;
    await ctx.market.write.placeSlip([
      { legs, numLegs: 1, totalStake: parseUnits("10", 6), minCombinedOdds: odds("1") },
    ], { account: ctx.bettor.account });

    const lockedBefore = await ctx.market.read.totalLockedPayouts();
    assert.equal(lockedBefore > 0n, true);

    await networkHelpers.time.increaseTo(Number(marketStart));
    const resultDeadline = BigInt(await networkHelpers.time.latest()) + 3_600n;
    const resultSig = await signPacked(
      ctx.oracle,
      ["string", "uint256", "address", "uint64", "uint8", "uint256"],
      [
        "QM:proposeResult",
        await ctx.publicClient.getChainId(),
        getAddress(ctx.market.address),
        1n,
        1,
        resultDeadline,
      ],
    );
    await ctx.market.write.proposeResult([1n, 1, resultDeadline, resultSig]);
    await networkHelpers.time.increase(Number(await ctx.market.read.challengeWindowSeconds()));
    await ctx.market.write.finalizeResult([1n]);

    await ctx.market.write.settleLostSlip([1n]);
    assert.equal(await ctx.market.read.totalLockedPayouts(), 0n);
  });
});
