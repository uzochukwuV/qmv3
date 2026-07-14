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

describe('QuadraticSlipMarketplace', async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployFixture() {
    const [admin, oracle, lp, bettor1, bettor2, bettor3, bettor4, bettor5] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const token = await viem.deployContract('MockUSDC');

    const core = await viem.deployContract('Core', [
      token.address, oracle.account.address, parseUnits('100000', 6),
    ]);
    const vault = await viem.deployContract('LiquidityVault');
    const slips = await viem.deployContract('BetSlips');
    const pricingEngine = await viem.deployContract('StateSpacePricing9');

    await vault.write.setCore([core.address]);
    await slips.write.setCore([core.address]);
    await core.write.setLiquidityVault([vault.address]);
    await core.write.setPricingEngine([pricingEngine.address]);
    await core.write.setBetSlips([slips.address]);

    const lpDeposit = parseUnits('1000', 6);
    const bettorStartingBalance = parseUnits('500', 6);
    const bettors = [bettor1, bettor2, bettor3, bettor4, bettor5];

    await token.write.mint([lp.account.address, lpDeposit]);
    await token.write.approve([vault.address, lpDeposit], { account: lp.account });

    for (const bettor of bettors) {
      await token.write.mint([bettor.account.address, bettorStartingBalance]);
      await token.write.approve([slips.address, bettorStartingBalance], { account: bettor.account });
    }

    return { admin, oracle, lp, bettors, publicClient, token, core, vault, slips, lpDeposit, bettorStartingBalance };
  }

  async function createMarket(ctx: any, overrides: any = {}) {
    const now = BigInt(await networkHelpers.time.latest());
    const oddsAnchor = emptyOdds();
    oddsAnchor[0] = overrides.odds0 ?? odds('2');
    oddsAnchor[1] = overrides.odds1 ?? odds('2');
    oddsAnchor[2] = odds('2.5');
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
  }

  async function seedCanonicalFootballGroup(ctx: any, title: string, marketStart: bigint) {
    const groupId = await ctx.core.read.nextGroupId();
    const groupHash = await ctx.core.write.createMarketGroup([title, marketStart, parseUnits('1500', 6)]);
    await ctx.publicClient.waitForTransactionReceipt({ hash: groupHash });

    const bWad = parseUnits('100', 18);
    const initialStateProbabilitiesWad = [
      bWad, bWad, bWad,
      bWad, bWad, bWad,
      bWad, bWad, bWad,
    ];

    const ftrOdds = (() => { const x = emptyOdds(); x[0] = odds('2'); x[1] = odds('3.5'); x[2] = odds('4'); return x; })();
    const ouOdds = (() => { const x = emptyOdds(); x[0] = odds('1.9'); x[1] = odds('1.9'); return x; })();
    const bttsOdds = (() => { const x = emptyOdds(); x[0] = odds('2.25'); x[1] = odds('1.8'); return x; })();

    await createMarket(ctx, {
      groupId,
      title: 'Full-Time Result',
      description: 'Home / Draw / Away',
      startTime: marketStart,
      numOutcomes: 3,
      marketType: 0,
      category: 0,
      oddsAnchor: ftrOdds,
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
      oddsAnchor: ouOdds,
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
      oddsAnchor: bttsOdds,
      maxDeviationBps: 1000n,
      volumeCap: (() => { const x = emptyOdds(); x[0] = parseUnits('500', 6); x[1] = parseUnits('500', 6); return x; })(),
      settlementRule: 2,
      yesOutcomeId: 0,
      noOutcomeId: 1,
    });

    await ctx.core.write.seedGroupPricing([groupId, bWad, initialStateProbabilitiesWad]);
    return { groupId, ftrOdds, ouOdds, bttsOdds };
  }
  function slipLeg(marketId: bigint, outcomeId: number, minOdds: bigint) {
    return { marketId, outcomeId, minOdds };
  }

  function emptySlipLeg() {
    return { marketId: 0n, outcomeId: 0, minOdds: 0n };
  }

  it('runs a 3-market group through five slip claims with LP deposit before the epoch', async function () {
    const { oracle, lp, bettors, publicClient, token, core, vault, slips, lpDeposit, bettorStartingBalance } =
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

    const { groupId } = await seedCanonicalFootballGroup({ core, oracle, publicClient, networkHelpers }, 'Arsenal vs Chelsea', marketStart);

    await networkHelpers.time.increaseTo(Number(epochStart));
    await core.write.openMarket([1n]);
    await core.write.openMarket([2n]);
    await core.write.openMarket([3n]);

    const winningLegs = [
      slipLeg(1n, 0, 1n),
      slipLeg(2n, 0, 1n),
      slipLeg(3n, 0, 1n),
    ];
    const legs = [
      winningLegs[0],
      winningLegs[1],
      winningLegs[2],
      emptySlipLeg(), emptySlipLeg(), emptySlipLeg(), emptySlipLeg(), emptySlipLeg(),
    ];

    const slipIds: bigint[] = [];
    const payouts: bigint[] = [];

    for (const bettor of bettors) {
      const hash = await slips.write.placeSlip([{
        legs,
        numLegs: 3,
        totalStake: parseUnits('10', 6),
        minCombinedOdds: 1n,
      }], { account: bettor.account });
      await publicClient.waitForTransactionReceipt({ hash });
      const slipId = await slips.read.nextSlipId();
      slipIds.push(slipId);
      payouts.push(await slips.read.getSlipPotentialPayout([slipId]));
      assert.equal(getAddress(await slips.read.getSlipOwner([slipId])), getAddress(bettor.account.address));
    }

    await networkHelpers.time.increaseTo(Number(marketStart));
    const resultDeadline = BigInt(await networkHelpers.time.latest()) + 3600n;
    const resultSig = await signPacked(
      oracle,
      ['string', 'uint256', 'address', 'uint64', 'uint16', 'uint16', 'uint256'],
      ['QM:proposeGroupResult', await publicClient.getChainId(), getAddress(core.address), groupId, 3, 1, resultDeadline],
    );

    await core.write.proposeGroupResult([groupId, 3, 1, resultDeadline, resultSig]);
    await networkHelpers.time.increase(challengeWindow);
    await core.write.finalizeGroupResult([groupId]);

    for (let i = 0; i < bettors.length; i++) {
      const bettor = bettors[i];
      const slipId = slipIds[i];
      const payout = payouts[i];
      await slips.write.claimSlipPayout([slipId], { account: bettor.account });
      assert.equal(
        await token.read.balanceOf([bettor.account.address]),
        bettorStartingBalance - parseUnits('10', 6) + payout,
      );
      assert.equal(await slips.read.getSlipOwner([slipId]), '0x0000000000000000000000000000000000000000');
    }

    assert.equal(await core.read.totalLockedPayouts(), 0n);

    await core.write.advanceEpoch();
    await vault.write.requestWithdraw([await vault.read.lpShares([lp.account.address])], { account: lp.account });
    await networkHelpers.time.increase(withdrawalCooldown);
    await vault.write.processWithdrawal({ account: lp.account });

    assert.equal(await vault.read.totalLpShares(), 0n);
  });
});


