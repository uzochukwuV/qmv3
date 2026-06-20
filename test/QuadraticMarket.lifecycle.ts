import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { encodeAbiParameters, encodePacked, getAddress, keccak256, parseAbiParameters, parseUnits, toBytes } from "viem";

const ODDS_PRECISION = 1000000n;

function odds(value: string) { return parseUnits(value, 6); }

async function signPacked(oracle: any, types: any, values: any) {
  const digest = keccak256(encodePacked(types, values));
  return oracle.signMessage({ message: { raw: digest } });
}

async function signCreateMarket(core: any, oracle: any, publicClient: any, params: any) {
  const nonce = await core.read.marketCreationNonce();
  const digest = keccak256(encodeAbiParameters(
    parseAbiParameters("string,uint256,address,uint64,uint256,uint64,bytes32,bytes32,uint256,uint8,uint8,uint8,uint256[8],uint256,uint256[8],uint256"),
    [
      "QM:createMarket:v2",
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
      params.sigDeadline,
    ],
  ));
  return oracle.signMessage({ message: { raw: digest } });
}

describe("QuadraticMarket lifecycle", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployFixture() {
    const [admin, oracle, lp, bettor] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const token = await viem.deployContract("MockUSDC");

    const core = await viem.deployContract("Core", [
      token.address, oracle.account.address, parseUnits("100000", 6),
    ]);

    const vault = await viem.deployContract("LiquidityVault");

    const slips = await viem.deployContract("BetSlips");

    await vault.write.setCore([core.address]);
    await slips.write.setCore([core.address]);
    await core.write.setLiquidityVault([vault.address]);
    await core.write.setBetSlips([slips.address]);

    const lpDeposit = parseUnits("1000", 6);
    const bettorStartingBalance = parseUnits("500", 6);
    await token.write.mint([lp.account.address, lpDeposit]);
    await token.write.mint([bettor.account.address, bettorStartingBalance]);
    await token.write.approve([vault.address, lpDeposit], { account: lp.account });
    await token.write.approve([core.address, bettorStartingBalance], { account: bettor.account });

    return { admin, oracle, lp, bettor, publicClient, token, core, vault, slips, lpDeposit, bettorStartingBalance };
  }

  it("runs an epoch from LP deposit through bet settlement and LP withdrawal", async function () {
    const { oracle, lp, bettor, publicClient, token, core, vault, lpDeposit, bettorStartingBalance } =
      await networkHelpers.loadFixture(deployFixture);

    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;
    const challengeWindow = 300n;
    const withdrawalCooldown = 86400n;

    await core.write.initEpoch([epochStart, 15000n]);
    await vault.write.addLiquidity([lpDeposit], { account: lp.account });
    await vault.write.voteCategory([0], { account: lp.account });
    assert.equal(await vault.read.totalLpShares(), lpDeposit);

    const groupHash = await core.write.createMarketGroup([
      "Arsenal vs Chelsea", marketStart, parseUnits("1500", 6),
    ]);
    await publicClient.waitForTransactionReceipt({ hash: groupHash });

    const oddsAnchor: [bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint] = [
      odds("2"), odds("3.5"), odds("4"), 0n, 0n, 0n, 0n, 0n,
    ];
    const volumeCap: [bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint] = [
      parseUnits("500", 6), parseUnits("500", 6), parseUnits("500", 6), 0n, 0n, 0n, 0n, 0n,
    ];

    const marketParams = {
      groupId: 1n,
      title: "Full-Time Result",
      description: "Home / Draw / Away",
      startTime: marketStart,
      numOutcomes: 3,
      marketType: 0,
      category: 0,
      oddsAnchor,
      maxDeviationBps: 1000n,
      volumeCap,
      sigDeadline: now + 3600n,
    };
    const createMarketSig = await signCreateMarket(core, oracle, publicClient, marketParams);
    await core.write.createMarket([{ ...marketParams, oracleSig: createMarketSig }]);

    await networkHelpers.time.increaseTo(Number(epochStart));
    await core.write.openMarket([1n]);

    const stake = parseUnits("100", 6);
    await core.write.buyAtOdds([1n, 0, stake, odds("1.9")], { account: bettor.account });

    const expectedPayout = (stake * 9900n / 10000n) * odds("2") / ODDS_PRECISION;
    assert.equal(await core.read.outcomeBalances([bettor.account.address, 1n, 0]), expectedPayout);
    assert.equal(await core.read.epochRemainingCapacity([0n]), parseUnits("1500", 6) - expectedPayout);

    await networkHelpers.time.increaseTo(Number(marketStart));
    const resultDeadline = BigInt(await networkHelpers.time.latest()) + 3600n;
    const resultSig = await signPacked(oracle,
      ["string", "uint256", "address", "uint64", "uint8", "uint256"],
      ["QM:proposeResult", await publicClient.getChainId(), getAddress(core.address), 1n, 0, resultDeadline]);

    await core.write.proposeResult([1n, 0, resultDeadline, resultSig]);
    await networkHelpers.time.increase(Number(challengeWindow));
    await core.write.finalizeResult([1n]);
    await core.write.claimPayout([1n], { account: bettor.account });

    assert.equal(await token.read.balanceOf([bettor.account.address]), bettorStartingBalance - stake + expectedPayout);
    assert.equal(await core.read.totalLockedPayouts(), 0n);

    await core.write.advanceEpoch();
    await vault.write.requestWithdraw([await vault.read.lpShares([lp.account.address])], { account: lp.account });
    await networkHelpers.time.increase(Number(withdrawalCooldown));
    await vault.write.processWithdrawal({ account: lp.account });

    assert.equal(await vault.read.totalLpShares(), 0n);
    assert.equal(await token.read.balanceOf([lp.account.address]), parseUnits("902", 6));
  });
});
