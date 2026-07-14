import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, encodePacked, getAddress, keccak256, parseAbiParameters, parseUnits, toBytes } from "viem";

const ODDS_PRECISION = 1_000_000n;

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

describe('QuadraticMarket lifecycle', async function () {
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
    const bettorStartingBalance = parseUnits('500', 6);
    await token.write.mint([lp.account.address, lpDeposit]);
    await token.write.mint([bettor.account.address, bettorStartingBalance]);
    await token.write.approve([vault.address, lpDeposit], { account: lp.account });
    await token.write.approve([core.address, bettorStartingBalance], { account: bettor.account });

    return { admin, oracle, lp, bettor, publicClient, token, core, vault, pricingEngine, lpDeposit, bettorStartingBalance };
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

  async function seedCanonicalFootballGroup(ctx: any, title: string, marketStart: bigint) {
    const groupId = await ctx.core.read.nextGroupId();
    const groupHash = await ctx.core.write.createMarketGroup([title, marketStart, parseUnits('1500', 6)]);
    await ctx.publicClient.waitForTransactionReceipt({ hash: groupHash });

    const firstMarketId = await ctx.core.read.nextMarketId();
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
      oddsAnchor: (() => { const x = emptyOdds(); x[0] = odds('2'); x[1] = odds('3.5'); x[2] = odds('4'); return x; })(),
      maxDeviationBps: 1000n,
      volumeCap: (() => { const x = emptyOdds(); x[0] = parseUnits('500', 6); x[1] = parseUnits('500', 6); x[2] = parseUnits('500', 6); return x; })(),
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
      oddsAnchor: (() => { const x = emptyOdds(); x[0] = odds('1.9'); x[1] = odds('1.9'); return x; })(),
      maxDeviationBps: 1000n,
      volumeCap: (() => { const x = emptyOdds(); x[0] = parseUnits('500', 6); x[1] = parseUnits('500', 6); return x; })(),
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
      oddsAnchor: (() => { const x = emptyOdds(); x[0] = odds('2.25'); x[1] = odds('1.8'); return x; })(),
      maxDeviationBps: 1000n,
      volumeCap: (() => { const x = emptyOdds(); x[0] = parseUnits('500', 6); x[1] = parseUnits('500', 6); return x; })(),
      settlementRule: 2,
      yesOutcomeId: 0,
      noOutcomeId: 1,
    });

    await ctx.core.write.seedGroupPricing([groupId, bWad, initialStateProbabilitiesWad]);
    return { groupId, marketIds: [firstMarketId, firstMarketId + 1n, firstMarketId + 2n] as const };
  }

  it('runs an epoch from LP deposit through group settlement and LP withdrawal', async function () {
    const { oracle, lp, bettor, publicClient, token, core, vault, lpDeposit, bettorStartingBalance } =
      await networkHelpers.loadFixture(deployFixture);

    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;
    const challengeWindow = 300;
    const withdrawalCooldown = 86400;

    await core.write.initEpoch([epochStart, 15000n]);
    await vault.write.addLiquidity([lpDeposit], { account: lp.account });
    await vault.write.voteCategory([0], { account: lp.account });
    assert.equal(await vault.read.totalLpShares(), lpDeposit);

    const { groupId, marketIds } = await seedCanonicalFootballGroup({ core, oracle, publicClient, networkHelpers }, 'Arsenal vs Chelsea', marketStart);

    await networkHelpers.time.increaseTo(Number(epochStart));
    await core.write.openMarket([marketIds[0]]);
    await core.write.openMarket([marketIds[1]]);
    await core.write.openMarket([marketIds[2]]);

    const stake = parseUnits('100', 6);
    await core.write.buyAtOdds([marketIds[0], 0, stake, odds('1.9')], { account: bettor.account });

    const expectedPayout = (stake * 9900n / 10000n) * odds('3') / ODDS_PRECISION;
    assert.equal(await core.read.outcomeBalances([bettor.account.address, marketIds[0], 0]), expectedPayout);

    await networkHelpers.time.increaseTo(Number(marketStart));
    const resultDeadline = BigInt(await networkHelpers.time.latest()) + 3600n;
    const resultSig = await signPacked(
      oracle,
      ['string', 'uint256', 'address', 'uint64', 'uint16', 'uint16', 'uint256'],
      ['QM:proposeGroupResult', await publicClient.getChainId(), getAddress(core.address), groupId, 1, 0, resultDeadline],
    );

    await core.write.proposeGroupResult([groupId, 1, 0, resultDeadline, resultSig]);
    await networkHelpers.time.increase(challengeWindow);
    await core.write.finalizeGroupResult([groupId]);
    await core.write.claimPayout([marketIds[0]], { account: bettor.account });

    assert.equal(await token.read.balanceOf([bettor.account.address]), bettorStartingBalance - stake + expectedPayout);
    assert.equal(await core.read.totalLockedPayouts(), 0n);

    await core.write.advanceEpoch();
    await vault.write.requestWithdraw([await vault.read.lpShares([lp.account.address])], { account: lp.account });
    await networkHelpers.time.increase(withdrawalCooldown);
    await vault.write.processWithdrawal({ account: lp.account });

    assert.equal(await vault.read.totalLpShares(), 0n);
    assert.equal(await token.read.balanceOf([lp.account.address]), parseUnits('803', 6));
  });


  it('keeps LP valuation fixed to the settled-epoch snapshot while the next epoch is active', async function () {
    const { oracle, lp, bettor, publicClient, token, core, vault, lpDeposit } =
      await networkHelpers.loadFixture(deployFixture);

    const now = BigInt(await networkHelpers.time.latest());
    const epoch1Start = now + 60n;
    const epoch1MarketStart = epoch1Start + 600n;
    const epoch2Start = epoch1Start + 2_000n;
    const epoch2MarketStart = epoch2Start + 600n;

    await core.write.initEpoch([epoch1Start, 15000n]);
    await vault.write.addLiquidity([lpDeposit], { account: lp.account });
    await vault.write.voteCategory([0], { account: lp.account });

    const epoch1Group = await seedCanonicalFootballGroup(
      { core, oracle, publicClient, networkHelpers },
      'Arsenal vs Chelsea',
      epoch1MarketStart,
    );

    await networkHelpers.time.increaseTo(Number(epoch1Start));
    for (const marketId of epoch1Group.marketIds) {
      await core.write.openMarket([marketId]);
    }

    const stake = parseUnits('100', 6);
    await core.write.buyAtOdds([epoch1Group.marketIds[0], 0, stake, odds('1.9')], { account: bettor.account });

    await networkHelpers.time.increaseTo(Number(epoch1MarketStart));
    const resultDeadline = BigInt(await networkHelpers.time.latest()) + 3600n;
    const resultSig = await signPacked(
      oracle,
      ['string', 'uint256', 'address', 'uint64', 'uint16', 'uint16', 'uint256'],
      ['QM:proposeGroupResult', await publicClient.getChainId(), getAddress(core.address), epoch1Group.groupId, 1, 0, resultDeadline],
    );

    await core.write.proposeGroupResult([epoch1Group.groupId, 1, 0, resultDeadline, resultSig]);
    await networkHelpers.time.increase(300);
    await core.write.finalizeGroupResult([epoch1Group.groupId]);
    await core.write.advanceEpoch();

    await core.write.initEpoch([epoch2Start, 15000n]);
    await token.write.mint([lp.account.address, lpDeposit]);
    await token.write.approve([vault.address, lpDeposit], { account: lp.account });
    await vault.write.addLiquidity([lpDeposit], { account: lp.account });

    const epoch2Group = await seedCanonicalFootballGroup(
      { core, oracle, publicClient, networkHelpers },
      'Liverpool vs Everton',
      epoch2MarketStart,
    );

    await networkHelpers.time.increaseTo(Number(epoch2Start));
    for (const marketId of epoch2Group.marketIds) {
      await core.write.openMarket([marketId]);
    }

    const frozenNav = await vault.read.lpNav();
    const frozenValue = await vault.read.lpValue([lp.account.address]);
    const frozenStats = await vault.read.getLPStats([lp.account.address]);
    const frozenShares = await vault.read.totalLpShares();

    assert.equal(frozenStats.nav, frozenNav);
    assert.equal(frozenStats.positionValue, frozenValue);

    await core.write.buyAtOdds([epoch2Group.marketIds[0], 0, stake, odds('1.9')], { account: bettor.account });

    const liveFreeLiquidity = await core.read.freeLiquidity();
    const liveNav = (liveFreeLiquidity * 1_000_000n) / frozenShares;
    const navDuringEpoch2 = await vault.read.lpNav();
    const valueDuringEpoch2 = await vault.read.lpValue([lp.account.address]);
    const statsDuringEpoch2 = await vault.read.getLPStats([lp.account.address]);

    assert.equal(navDuringEpoch2, frozenNav);
    assert.equal(valueDuringEpoch2, frozenValue);
    assert.equal(statsDuringEpoch2.nav, frozenNav);
    assert.equal(statsDuringEpoch2.positionValue, frozenValue);
    assert.equal(statsDuringEpoch2.shares, await vault.read.lpShares([lp.account.address]));
    assert.notEqual(navDuringEpoch2, liveNav);
    assert.equal(statsDuringEpoch2.withdrawalPending, false);
  });

});
