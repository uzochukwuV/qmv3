import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, encodePacked, getAddress, keccak256, parseAbiParameters, parseUnits, toBytes } from "viem";

function odds(value: string) {
  return parseUnits(value, 6);
}

function emptyOdds(): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
  return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
}

async function signPacked(oracle: any, types: any, values: any) {
  const digest = keccak256(encodePacked(types, values));
  return oracle.signMessage({ message: { raw: digest } });
}

async function signCreateMarket(core: any, oracle: any, publicClient: any, params: any) {
  const nonce = await core.read.marketCreationNonce();
  const digest = keccak256(encodeAbiParameters(
    parseAbiParameters('string,uint256,address,uint64,uint256,uint64,bytes32,bytes32,uint256,uint8,uint8,uint8,uint256[8],uint256,uint256[8],uint8,uint16,uint8,uint8,uint8,uint8,uint8,uint8,uint8,uint256'),
    [
      'QM:createMarket:v2',
      BigInt(await publicClient.getChainId()),
      getAddress(core.address),
      await core.read.currentEpoch(),
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
      params.settlementRule,
      params.settlementLine,
      params.homeOutcomeId,
      params.drawOutcomeId,
      params.awayOutcomeId,
      params.yesOutcomeId,
      params.noOutcomeId,
      params.overOutcomeId,
      params.underOutcomeId,
      params.sigDeadline,
    ],
  ));
  return oracle.signMessage({ message: { raw: digest } });
}

describe('QuadraticMarket regressions', async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployFixture() {
    const [admin, oracle, lp, bettor] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const token = await viem.deployContract('MockUSDC');

    const core = await viem.deployContract('Core', [
      token.address, oracle.account.address, parseUnits('100000', 6),
    ]);
    const vault = await viem.deployContract('LiquidityVault');
    const pricingEngine = await viem.deployContract('StateSpacePricing9');

    await vault.write.setCore([core.address]);
    await core.write.setLiquidityVault([vault.address]);
    await core.write.setPricingEngine([pricingEngine.address]);

    const lpDeposit = parseUnits('1000', 6);
    const bettorBalance = parseUnits('1000', 6);
    await token.write.mint([lp.account.address, lpDeposit]);
    await token.write.mint([bettor.account.address, bettorBalance]);
    await token.write.approve([vault.address, lpDeposit], { account: lp.account });
    await token.write.approve([core.address, bettorBalance], { account: bettor.account });

    return { admin, oracle, lp, bettor, publicClient, token, core, vault, pricingEngine, lpDeposit, bettorBalance };
  }

  async function createMarket(ctx: any, overrides: any = {}) {
    const now = BigInt(await networkHelpers.time.latest());
    const oddsAnchor = emptyOdds();
    oddsAnchor[0] = overrides.odds0 ?? odds('2');
    oddsAnchor[1] = overrides.odds1 ?? odds('2');
    oddsAnchor[2] = overrides.odds2 ?? odds('2.5');
    const volumeCap = emptyOdds();
    volumeCap[0] = overrides.cap0 ?? parseUnits('500', 6);
    volumeCap[1] = overrides.cap1 ?? parseUnits('500', 6);
    volumeCap[2] = overrides.cap2 ?? parseUnits('500', 6);

    const params = {
      groupId: overrides.groupId ?? 0n,
      title: overrides.title ?? 'Binary market',
      description: overrides.description ?? 'Yes / No',
      startTime: overrides.startTime ?? now + 600n,
      numOutcomes: overrides.numOutcomes ?? 2,
      marketType: overrides.marketType ?? 0,
      category: overrides.category ?? 0,
      oddsAnchor,
      maxDeviationBps: overrides.maxDeviationBps ?? 1000n,
      volumeCap,
      settlementRule: overrides.settlementRule ?? 1,
      settlementLine: overrides.settlementLine ?? 0,
      homeOutcomeId: overrides.homeOutcomeId ?? 0,
      drawOutcomeId: overrides.drawOutcomeId ?? 1,
      awayOutcomeId: overrides.awayOutcomeId ?? 2,
      yesOutcomeId: overrides.yesOutcomeId ?? 0,
      noOutcomeId: overrides.noOutcomeId ?? 1,
      overOutcomeId: overrides.overOutcomeId ?? 0,
      underOutcomeId: overrides.underOutcomeId ?? 1,
      sigDeadline: overrides.sigDeadline ?? now + 3600n,
    };

    const oracleSig = await signCreateMarket(ctx.core, ctx.oracle, ctx.publicClient, params);
    await ctx.core.write.createMarket([{ ...params, oracleSig }]);
    return params;
  }


  async function seedCanonicalFootballGroup(ctx: any, title: string, marketStart: bigint, capPerOutcome: bigint = parseUnits('10000', 6)) {
    const groupHash = await ctx.core.write.createMarketGroup([title, marketStart, parseUnits('1500', 6)]);
    await ctx.publicClient.waitForTransactionReceipt({ hash: groupHash });

    const groupId = 1n;
    const bWad = parseUnits('100', 18);
    const initialStateProbabilitiesWad = [
      bWad, bWad, bWad,
      bWad, bWad, bWad,
      bWad, bWad, bWad,
    ];

    await createMarket(ctx, {
      groupId,
      title: 'Full-Time Result',
      description: 'Home / Draw / Away',
      startTime: marketStart,
      numOutcomes: 3,
      marketType: 0,
      category: 0,
      odds0: odds('2'),
      odds1: odds('3.5'),
      odds2: odds('4'),
      cap0: capPerOutcome,
      cap1: capPerOutcome,
      cap2: capPerOutcome,
      settlementRule: 1,
      settlementLine: 0,
      homeOutcomeId: 0,
      drawOutcomeId: 1,
      awayOutcomeId: 2,
    });

    await createMarket(ctx, {
      groupId,
      title: 'Over / Under 2.5',
      description: 'Over 2.5 / Under 2.5',
      startTime: marketStart,
      numOutcomes: 2,
      marketType: 1,
      category: 0,
      odds0: odds('1.9'),
      odds1: odds('1.9'),
      cap0: parseUnits('10000', 6),
      cap1: parseUnits('10000', 6),
      settlementRule: 3,
      settlementLine: 25,
      overOutcomeId: 0,
      underOutcomeId: 1,
    });

    await createMarket(ctx, {
      groupId,
      title: 'Both Teams To Score',
      description: 'Yes / No',
      startTime: marketStart,
      numOutcomes: 2,
      marketType: 2,
      category: 0,
      odds0: odds('2.25'),
      odds1: odds('1.8'),
      cap0: parseUnits('10000', 6),
      cap1: parseUnits('10000', 6),
      settlementRule: 2,
      yesOutcomeId: 0,
      noOutcomeId: 1,
    });

    await ctx.core.write.seedGroupPricing([groupId, bWad, initialStateProbabilitiesWad]);
    return groupId;
  }

  it('rejects createMarket signatures replayed with altered risk params', async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    await ctx.core.write.initEpoch([now + 60n, 15000n]);
    await ctx.vault.write.addLiquidity([ctx.lpDeposit], { account: ctx.lp.account });

    const params = {
      groupId: 0n,
      title: 'Signed market',
      description: 'Original risk params',
      startTime: now + 600n,
      numOutcomes: 2,
      marketType: 0,
      category: 0,
      oddsAnchor: (() => { const x = emptyOdds(); x[0] = odds('2'); x[1] = odds('2'); return x; })(),
      maxDeviationBps: 1000n,
      volumeCap: (() => { const x = emptyOdds(); x[0] = parseUnits('100', 6); x[1] = parseUnits('100', 6); return x; })(),
      settlementRule: 1,
      settlementLine: 0,
      homeOutcomeId: 0,
      drawOutcomeId: 1,
      awayOutcomeId: 2,
      yesOutcomeId: 0,
      noOutcomeId: 1,
      overOutcomeId: 0,
      underOutcomeId: 1,
      sigDeadline: now + 3600n,
    };

    const oracleSig = await signCreateMarket(ctx.core, ctx.oracle, ctx.publicClient, params);

    await assert.rejects(
      ctx.core.write.createMarket([{ ...params, maxDeviationBps: 9000n, oracleSig }]),
      /InvalidOracleSignature/,
    );
    await ctx.core.write.createMarket([{ ...params, oracleSig }]);
    await assert.rejects(
      ctx.core.write.createMarket([{ ...params, title: 'Replay', oracleSig }]),
      /InvalidOracleSignature/,
    );
  });

  it('blocks empty epoch advancement before the epoch end time', async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    await ctx.core.write.initEpoch([now + 60n, 15000n]);
    await assert.rejects(ctx.core.write.advanceEpoch(), /EpochNotSettled/);
  });

  it('applies per-outcome volume caps to buyAtOdds', async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;

    await ctx.core.write.initEpoch([epochStart, 15000n]);
    await ctx.vault.write.addLiquidity([ctx.lpDeposit], { account: ctx.lp.account });
    await seedCanonicalFootballGroup(ctx, 'Cap test', marketStart, parseUnits('5', 6));

    await networkHelpers.time.increaseTo(Number(epochStart));
    await ctx.core.write.openMarket([1n]);
    await ctx.core.write.openMarket([2n]);
    await ctx.core.write.openMarket([3n]);

    await assert.rejects(
      ctx.core.write.buyAtOdds([1n, 0, parseUnits('10', 6), odds('1.9')], { account: ctx.bettor.account }),
      /VolumeCapExceeded/,
    );
  });

  it('settles a market from a group score and releases locked capacity', async function () {
    const ctx = await networkHelpers.loadFixture(deployFixture);
    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;

    await ctx.core.write.initEpoch([epochStart, 15000n]);
    await ctx.vault.write.addLiquidity([ctx.lpDeposit], { account: ctx.lp.account });
    await seedCanonicalFootballGroup(ctx, 'Settlement test', marketStart);

    await networkHelpers.time.increaseTo(Number(epochStart));
    await ctx.core.write.openMarket([1n]);
    await ctx.core.write.openMarket([2n]);
    await ctx.core.write.openMarket([3n]);

    const stake = parseUnits('10', 6);
    await ctx.core.write.buyAtOdds([1n, 0, stake, odds('1.9')], { account: ctx.bettor.account });
    const lockedBefore = await ctx.core.read.totalLockedPayouts();
    assert.equal(lockedBefore > 0n, true);

    await networkHelpers.time.increaseTo(Number(marketStart));
    const scoreDeadline = BigInt(await networkHelpers.time.latest()) + 3600n;
    const scoreSig = await signPacked(
      ctx.oracle,
      ['string', 'uint256', 'address', 'uint64', 'uint16', 'uint16', 'uint256'],
      ['QM:proposeGroupResult', await ctx.publicClient.getChainId(), getAddress(ctx.core.address), 1n, 0, 1, scoreDeadline],
    );

    await ctx.core.write.proposeGroupResult([1n, 0, 1, scoreDeadline, scoreSig]);
    await networkHelpers.time.increase(300);
    await ctx.core.write.finalizeGroupResult([1n]);


    const lockedAfter = await ctx.core.read.totalLockedPayouts();
    assert.ok(lockedAfter <= lockedBefore, 'Locked payouts should be released after settlement');
  });
});
