import assert from "node:assert/strict";
import { network } from "hardhat";
import {
  createWalletClient,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  http,
  keccak256,
  parseAbiParameters,
  parseUnits,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ODDS_PRECISION = 1_000_000n;
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const USER_COUNT = Number(process.env.USER_COUNT ?? "20");
const STAKE_USDC = process.env.STAKE_USDC ?? "10";
const LP_DEPOSIT_USDC = process.env.LP_DEPOSIT_USDC ?? "1000000";
const GROUP_EXPOSURE_USDC = process.env.GROUP_EXPOSURE_USDC ?? "2000000";
const MARKET_CAP_USDC = process.env.MARKET_CAP_USDC ?? "2000000";
const CHALLENGE_WINDOW_SECONDS = Number(process.env.CHALLENGE_WINDOW_SECONDS ?? "300");
const WITHDRAWAL_COOLDOWN_SECONDS = Number(process.env.WITHDRAWAL_COOLDOWN_SECONDS ?? "86400");
const RUN_WITHDRAWAL = (process.env.RUN_WITHDRAWAL ?? "1") !== "0";

function odds(value: string) {
  return parseUnits(value, 6);
}

function emptyOdds(): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
  return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
}

function jsonBigInts(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
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

async function seedCanonicalFootballGroup(ctx: any, title: string, marketStart: bigint) {
  const groupId = await ctx.core.read.nextGroupId();
  const groupHash = await ctx.core.write.createMarketGroup([title, marketStart, parseUnits('2000000', 6)]);
  await ctx.publicClient.waitForTransactionReceipt({ hash: groupHash });

  const firstMarketId = await ctx.core.read.nextMarketId();
  const bWad = parseUnits('100', 18);
  const initialStateProbabilitiesWad = [
    bWad, bWad, bWad,
    bWad, bWad, bWad,
    bWad, bWad, bWad,
  ];

  const ftrOdds = (() => { const x = emptyOdds(); x[0] = odds('2'); x[1] = odds('3.5'); x[2] = odds('4'); return x; })();
  const ouOdds = (() => { const x = emptyOdds(); x[0] = odds('1.9'); x[1] = odds('1.9'); return x; })();
  const bttsOdds = (() => { const x = emptyOdds(); x[0] = odds('2.25'); x[1] = odds('1.8'); return x; })();

  const cap = parseUnits(MARKET_CAP_USDC, 6);
  const marketCap = (() => {
    const x = emptyOdds();
    x[0] = cap;
    x[1] = cap;
    x[2] = cap;
    return x;
  })();

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
    volumeCap: marketCap,
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
    volumeCap: marketCap,
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
    volumeCap: marketCap,
    settlementRule: 2,
    yesOutcomeId: 0,
    noOutcomeId: 1,
  });

  await ctx.core.write.seedGroupPricing([groupId, bWad, initialStateProbabilitiesWad]);

  return {
    groupId,
    marketIds: [firstMarketId, firstMarketId + 1n, firstMarketId + 2n] as const,
  };
}

async function createMarket(ctx: any, overrides: any = {}) {
  const now = BigInt(await ctx.networkHelpers.time.latest());
  const oddsAnchor = emptyOdds();
  oddsAnchor[0] = overrides.odds0 ?? odds('2');
  oddsAnchor[1] = overrides.odds1 ?? odds('2');
  oddsAnchor[2] = odds('2.5');
  const cap = parseUnits(MARKET_CAP_USDC, 6);
  const volumeCap = emptyOdds();
  volumeCap[0] = cap;
  volumeCap[1] = cap;
  volumeCap[2] = cap;

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
  const hash = await ctx.core.write.createMarket([{ ...params, oracleSig }]);
  await ctx.publicClient.waitForTransactionReceipt({ hash });
}

async function main() {
  const { viem, networkHelpers } = await network.create('localhost');
  const publicClient = await viem.getPublicClient();
  const [admin, oracle, lp] = await viem.getWalletClients();
  const transport = http(RPC_URL);

  const token = await viem.deployContract('MockUSDC');
  const core = await viem.deployContract('Core', [token.address, oracle.account.address, parseUnits('1000000', 6)]);
  const vault = await viem.deployContract('LiquidityVault');
  const slips = await viem.deployContract('BetSlips');
  const pricingEngine = await viem.deployContract('StateSpacePricing9');

  await vault.write.setCore([core.address]);
  await slips.write.setCore([core.address]);
  await core.write.setLiquidityVault([vault.address]);
  await core.write.setPricingEngine([pricingEngine.address]);
  await core.write.setBetSlips([slips.address]);

  const bettors = Array.from({ length: USER_COUNT }, (_, i) => {
    const pk = keccak256(encodePacked(['string', 'uint256'], ['qmv4-load-user', BigInt(i + 1)]));
    const account = privateKeyToAccount(pk);
    return {
      account,
      wallet: createWalletClient({ account, transport }),
    };
  });

  const lpDeposit = parseUnits(LP_DEPOSIT_USDC, 6);
  const stake = parseUnits(STAKE_USDC, 6);
  const bettorSeed = parseUnits('1000', 6);
  const gasSeed = 10n ** 20n;

  await token.write.mint([lp.account.address, lpDeposit]);
  await token.write.approve([vault.address, lpDeposit], { account: lp.account });
  await networkHelpers.setBalance(lp.account.address, gasSeed);

  for (const bettor of bettors) {
    await networkHelpers.setBalance(bettor.account.address, gasSeed);
    await token.write.mint([bettor.account.address, bettorSeed]);
    await token.write.approve([slips.address, bettorSeed], { account: bettor.account });
  }

  const now = BigInt(await networkHelpers.time.latest());
  const epochStart = now + 60n;
  const marketStart = epochStart + 600n;

  await core.write.initEpoch([epochStart, 15000n]);
  await vault.write.addLiquidity([lpDeposit], { account: lp.account });
  await vault.write.voteCategory([0], { account: lp.account });
  const lpStatsAfterDeposit = await vault.read.getLPStats([lp.account.address]);

  const { groupId, marketIds } = await seedCanonicalFootballGroup(
    { core, oracle, publicClient, networkHelpers },
    'Arsenal vs Chelsea',
    marketStart,
  );

  const seededGroup = await core.read.marketGroups([groupId]);
  assert.equal(seededGroup[6], 3);

  await networkHelpers.time.increaseTo(Number(epochStart));
  for (const marketId of marketIds) {
    await core.write.openMarket([marketId]);
  }

  const placedSlipIds: bigint[] = [];
  const potentialPayouts: bigint[] = [];
  const legs = [
    { marketId: marketIds[0], outcomeId: 0, minOdds: odds('1') },
    { marketId: marketIds[1], outcomeId: 0, minOdds: odds('1') },
    { marketId: marketIds[2], outcomeId: 0, minOdds: odds('1') },
    { marketId: 0n, outcomeId: 0, minOdds: 0n },
    { marketId: 0n, outcomeId: 0, minOdds: 0n },
    { marketId: 0n, outcomeId: 0, minOdds: 0n },
    { marketId: 0n, outcomeId: 0, minOdds: 0n },
    { marketId: 0n, outcomeId: 0, minOdds: 0n },
  ];
  const slipParams = {
    legs,
    numLegs: 3,
    totalStake: stake,
    minCombinedOdds: 1n,
  } as const;
  const quote = await slips.read.quoteSlip([slipParams]);
  assert.equal(quote.totalStake, stake);
  assert.equal(quote.numLegs, 3);

  const placementStarted = Date.now();
  for (const bettor of bettors) {
    const hash = await slips.write.placeSlip([slipParams], { account: bettor.account });
    await publicClient.waitForTransactionReceipt({ hash });

    const slipId = await slips.read.nextSlipId();
    placedSlipIds.push(slipId);
    potentialPayouts.push(await slips.read.getSlipPotentialPayout([slipId]));
  }
  const placementMs = Date.now() - placementStarted;
  const firstSlipActive = await slips.read.getSlipStatusView([placedSlipIds[0]]);
  const lpStatsAfterBets = await vault.read.getLPStats([lp.account.address]);
  assert.equal(firstSlipActive.pending, true);
  assert.equal(firstSlipActive.claimable, false);

  await networkHelpers.time.increaseTo(Number(marketStart));
  const resultDeadline = BigInt(await networkHelpers.time.latest()) + 3600n;
  const resultSig = await signPacked(
    oracle,
    ['string', 'uint256', 'address', 'uint64', 'uint16', 'uint16', 'uint256'],
    ['QM:proposeGroupResult', await publicClient.getChainId(), getAddress(core.address), groupId, 3, 1, resultDeadline],
  );

  await core.write.proposeGroupResult([groupId, 3, 1, resultDeadline, resultSig]);
  await networkHelpers.time.increase(CHALLENGE_WINDOW_SECONDS);
  await core.write.finalizeGroupResult([groupId]);
  const firstSlipSettled = await slips.read.getSlipStatusView([placedSlipIds[0]]);
  assert.equal(firstSlipSettled.won, true);
  assert.equal(firstSlipSettled.claimable, true);

  const claimStarted = Date.now();
  let totalClaimed = 0n;
  for (let i = 0; i < bettors.length; i++) {
    const bettor = bettors[i];
    const slipId = placedSlipIds[i];
    const payout = potentialPayouts[i];
    const before = await token.read.balanceOf([bettor.account.address]);
    const hash = await slips.write.claimSlipPayout([slipId], { account: bettor.account });
    await publicClient.waitForTransactionReceipt({ hash });
    const after = await token.read.balanceOf([bettor.account.address]);
    assert.equal(after, before + payout);
    totalClaimed += payout;
  }
  const claimMs = Date.now() - claimStarted;
  const firstSlipClaimed = await slips.read.getSlipStatusView([placedSlipIds[0]]);
  assert.equal(firstSlipClaimed.status, 2);
  assert.equal(firstSlipClaimed.claimable, false);

  let withdrawalResult = null;
  let lpStatsWithdrawalQueued = null;
  if (RUN_WITHDRAWAL) {
    await core.write.advanceEpoch();
    await vault.write.requestWithdraw([await vault.read.lpShares([lp.account.address])], { account: lp.account });
    lpStatsWithdrawalQueued = await vault.read.getLPStats([lp.account.address]);
    assert.equal(lpStatsWithdrawalQueued.withdrawalPending, true);
    assert.equal(lpStatsWithdrawalQueued.withdrawalEpochSettled, true);
    await networkHelpers.time.increase(WITHDRAWAL_COOLDOWN_SECONDS);
    const before = await token.read.balanceOf([lp.account.address]);
    const hash = await vault.write.processWithdrawal({ account: lp.account });
    await publicClient.waitForTransactionReceipt({ hash });
    const after = await token.read.balanceOf([lp.account.address]);
    withdrawalResult = { before, after };
  }

  const totalStake = stake * BigInt(USER_COUNT);
  const totalPotentialPayout = potentialPayouts.reduce((acc, v) => acc + v, 0n);
  const lpStatsFinal = await vault.read.getLPStats([lp.account.address]);

  console.log(JSON.stringify({
    network: 'localhost',
    userCount: USER_COUNT,
    stakePerUser: stake.toString(),
    totalStake: totalStake.toString(),
    totalPotentialPayout: totalPotentialPayout.toString(),
    totalClaimed: totalClaimed.toString(),
    placementMs,
    claimMs,
    withdrawalDone: withdrawalResult !== null,
    withdrawalBefore: withdrawalResult ? withdrawalResult.before.toString() : null,
    withdrawalAfter: withdrawalResult ? withdrawalResult.after.toString() : null,
    groupId: groupId.toString(),
    marketIds: marketIds.map((id) => id.toString()),
    helpers: jsonBigInts({
      quote,
      firstSlip: {
        active: firstSlipActive,
        settled: firstSlipSettled,
        claimed: firstSlipClaimed,
      },
      lp: {
        afterDeposit: lpStatsAfterDeposit,
        afterBets: lpStatsAfterBets,
        withdrawalQueued: lpStatsWithdrawalQueued,
        final: lpStatsFinal,
      },
    }),
  }, null, 2));
}

await main();
