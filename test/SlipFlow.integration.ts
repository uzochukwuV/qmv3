import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { network } from 'hardhat';
import { encodeAbiParameters, encodePacked, getAddress, keccak256, parseAbiParameters, parseUnits, toBytes } from 'viem';

let viem: any;
let networkHelpers: any;

function odds(value: string) {
  return parseUnits(value, 6);
}

function emptyOdds(): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
  return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
}

function jsonReplacer(_key: string, value: any) {
  return typeof value === 'bigint' ? value.toString() : value;
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

async function logLpStats(vault: any, lpAddress: string, label: string) {
  const stats = await vault.read.getLPStats([lpAddress]);
  console.log(JSON.stringify({ label, lpAddress, stats }, jsonReplacer, 2));
  return stats;
}

async function logSlipQuote(slips: any, params: any, label: string) {
  const quote = await slips.read.quoteSlip([params]);
  console.log(JSON.stringify({ label, quote }, jsonReplacer, 2));
  return quote;
}

async function logSlipStatus(slips: any, slipId: bigint, label: string) {
  const status = await slips.read.getSlipStatusView([slipId]);
  console.log(JSON.stringify({ label, slipId: slipId.toString(), status }, jsonReplacer, 2));
  return status;
}

function leg(marketId: bigint, outcomeId: number, minOdds: bigint) {
  return { marketId, outcomeId, minOdds };
}

function buildSlip(legs: Array<{ marketId: bigint; outcomeId: number; minOdds: bigint }>, stake: bigint) {
  const padded = [...legs];
  while (padded.length < 8) {
    padded.push({ marketId: 0n, outcomeId: 0, minOdds: 0n });
  }
  return {
    legs: padded,
    numLegs: legs.length,
    totalStake: stake,
    minCombinedOdds: 1n,
  };
}

async function deployFixture(viemCtx: any) {
  const [admin, oracle, lp, bettor1, bettor2, bettor3, bettor4, bettor5] = await viemCtx.getWalletClients();
  const publicClient = await viemCtx.getPublicClient();
  const token = await viemCtx.deployContract('MockUSDC');

  const core = await viemCtx.deployContract('Core', [
    token.address, oracle.account.address, parseUnits('100000', 6),
  ]);
  const vault = await viemCtx.deployContract('LiquidityVault');
  const slips = await viemCtx.deployContract('BetSlips');
  const pricingEngine = await viemCtx.deployContract('StateSpacePricing9');

  await vault.write.setCore([core.address]);
  await slips.write.setCore([core.address]);
  await core.write.setLiquidityVault([vault.address]);
  await core.write.setPricingEngine([pricingEngine.address]);
  await core.write.setBetSlips([slips.address]);

  const lpDeposit = parseUnits('1000', 6);
  const bettorBalance = parseUnits('500', 6);
  const bettors = [bettor1, bettor2, bettor3, bettor4, bettor5];

  await token.write.mint([lp.account.address, lpDeposit]);
  await token.write.approve([vault.address, lpDeposit], { account: lp.account });

  for (const bettor of bettors) {
    await token.write.mint([bettor.account.address, bettorBalance]);
    await token.write.approve([slips.address, bettorBalance], { account: bettor.account });
  }

  return { admin, oracle, lp, bettors, publicClient, token, core, vault, slips, lpDeposit, bettorBalance };
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

  const bWad = parseUnits('100', 18);
  const initialStateProbabilitiesWad = [bWad, bWad, bWad, bWad, bWad, bWad, bWad, bWad, bWad];

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
    cap0: parseUnits('10000', 6),
    cap1: parseUnits('10000', 6),
    cap2: parseUnits('10000', 6),
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
  return { groupId };
}

describe('Slip flow integration', async function () {
  ({ viem, networkHelpers } = await network.create());

  it('runs five slips through LP opt-in, settlement, claim, and status logging', async function () {
    const { oracle, lp, bettors, publicClient, token, core, vault, slips, lpDeposit, bettorBalance } =
      await networkHelpers.loadFixture(async function deployFixtureLocal() {
        return deployFixture(viem);
      });

    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;

    await core.write.initEpoch([epochStart, 15000n]);
    await vault.write.addLiquidity([lpDeposit], { account: lp.account });
    await vault.write.voteCategory([0], { account: lp.account });
    await logLpStats(vault, lp.account.address, 'lp-after-optin');

    const { groupId } = await seedCanonicalFootballGroup({ core, oracle, publicClient, networkHelpers }, 'Spain vs Argentina', marketStart);

    await networkHelpers.time.increaseTo(Number(epochStart));
    await core.write.openEpochForTrading();

    const slipSpecs = [
      buildSlip([leg(1n, 0, 1n), leg(2n, 0, 1n), leg(3n, 0, 1n)], parseUnits('10', 6)),
      buildSlip([leg(1n, 0, 1n), leg(2n, 0, 1n)], parseUnits('12', 6)),
      buildSlip([leg(1n, 1, 1n)], parseUnits('8', 6)),
      buildSlip([leg(1n, 1, 1n), leg(2n, 1, 1n), leg(3n, 1, 1n)], parseUnits('15', 6)),
      buildSlip([leg(1n, 0, 1n), leg(3n, 0, 1n)], parseUnits('20', 6)),
    ];
    const labels = ['win-3leg', 'win-2leg', 'lose-1leg', 'lose-3leg', 'win-2leg-b'];
    const slipIds: bigint[] = [];
    const payouts: bigint[] = [];
    const summary: any[] = [];

    for (let i = 0; i < bettors.length; i++) {
      const quote = await logSlipQuote(slips, slipSpecs[i], `quote-${labels[i]}`);
      const txHash = await slips.write.placeSlip([slipSpecs[i]], { account: bettors[i].account });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      const slipId = await slips.read.nextSlipId();
      slipIds.push(slipId);
      payouts.push(await slips.read.getSlipPotentialPayout([slipId]));
      assert.equal(getAddress(await slips.read.getSlipOwner([slipId])), getAddress(bettors[i].account.address));
      summary.push({ label: labels[i], slipId: slipId.toString(), quote });
      await logSlipStatus(slips, slipId, `placed-${labels[i]}`);
    }

    await networkHelpers.time.increaseTo(Number(marketStart));
    const proofHash = keccak256(
      toBytes(`txodds:${await publicClient.getChainId()}:${getAddress(core.address)}:${groupId}:3:1:${Date.now()}`),
    );

    await core.write.settleGroupWithProof([groupId, 3, 1, proofHash, 'txodds:test']);
    let wonCount = 0;
    let lostCount = 0;

    for (let i = 0; i < bettors.length; i++) {
      const bettor = bettors[i];
      const slipId = slipIds[i];
      const payout = payouts[i];
      const status = await logSlipStatus(slips, slipId, `settled-${labels[i]}`);

      if (status.won) {
        wonCount += 1;
        await slips.write.claimSlipPayout([slipId], { account: bettor.account });
        const balance = await token.read.balanceOf([bettor.account.address]);
        assert.equal(balance, bettorBalance - slipSpecs[i].totalStake + payout);
        assert.equal(await slips.read.getSlipOwner([slipId]), '0x0000000000000000000000000000000000000000');
      } else if (status.hasLost) {
        lostCount += 1;
        await slips.write.settleLostSlip([slipId]);
        assert.equal(await slips.read.getSlipOwner([slipId]), '0x0000000000000000000000000000000000000000');
      }

      summary[i].stake = slipSpecs[i].totalStake.toString();
      summary[i].payout = payout.toString();
      summary[i].status = status;
    }

    assert.equal(await core.read.totalLockedPayouts(), 0n);
    console.log(JSON.stringify({ label: 'slip-summary', wonCount, lostCount, totalSlips: summary.length, summary }, jsonReplacer, 2));

    await logLpStats(vault, lp.account.address, 'lp-after-settlement');
  });
});

