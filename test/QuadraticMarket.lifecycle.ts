import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodePacked, getAddress, keccak256, parseUnits } from "viem";

const ODDS_PRECISION = 1_000_000n;
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

describe("QuadraticMarket lifecycle", async function () {
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
    const bettorStartingBalance = parseUnits("500", 6);

    await token.write.mint([lp.account.address, lpDeposit]);
    await token.write.mint([bettor.account.address, bettorStartingBalance]);

    await token.write.approve([market.address, lpDeposit], {
      account: lp.account,
    });
    await token.write.approve([market.address, bettorStartingBalance], {
      account: bettor.account,
    });

    return {
      admin,
      oracle,
      lp,
      bettor,
      publicClient,
      token,
      market,
      lpDeposit,
      bettorStartingBalance,
    };
  }

  it("runs an epoch from LP deposit through bet settlement and LP withdrawal", async function () {
    const {
      oracle,
      lp,
      bettor,
      publicClient,
      token,
      market,
      lpDeposit,
      bettorStartingBalance,
    } = await networkHelpers.loadFixture(deployFixture);

    const now = BigInt(await networkHelpers.time.latest());
    const epochStart = now + 60n;
    const marketStart = epochStart + 600n;
    const sigDeadline = now + 3_600n;
    const challengeWindow = await market.read.challengeWindowSeconds();
    const withdrawalCooldown = await market.read.withdrawalCooldownSeconds();

    await market.write.initEpoch([epochStart, 15_000n]);
    await market.write.addLiquidity([lpDeposit], { account: lp.account });
    await market.write.voteCategory([0], { account: lp.account });

    assert.equal(await market.read.totalLpShares(), lpDeposit);
    assert.equal((await market.read.epochWinningCategory([0n]))[0], 0);

    const groupHash = await market.write.createMarketGroup([
      "Arsenal vs Chelsea",
      marketStart,
      parseUnits("1500", 6),
    ]);
    await publicClient.waitForTransactionReceipt({ hash: groupHash });

    const oddsAnchor = emptyOdds();
    oddsAnchor[0] = odds("2");
    oddsAnchor[1] = odds("3.5");
    oddsAnchor[2] = odds("4");

    const volumeCap = emptyOdds();
    volumeCap[0] = parseUnits("500", 6);
    volumeCap[1] = parseUnits("500", 6);
    volumeCap[2] = parseUnits("500", 6);

    const createMarketSig = await signPacked(
      oracle,
      [
        "string",
        "uint256",
        "address",
        "uint64",
        "uint64",
        "uint8",
        "uint256[8]",
        "uint256",
      ],
      [
        "QM:createMarket",
        await publicClient.getChainId(),
        getAddress(market.address),
        0n,
        1n,
        3,
        oddsAnchor,
        sigDeadline,
      ],
    );

    await market.write.createMarket([
      {
        groupId: 1n,
        title: "Full-Time Result",
        description: "Home / Draw / Away",
        startTime: marketStart,
        numOutcomes: 3,
        marketType: 0,
        category: 0,
        oddsAnchor,
        maxDeviationBps: 1_000n,
        volumeCap,
        sigDeadline,
        oracleSig: createMarketSig,
      },
    ]);

    await networkHelpers.time.increaseTo(Number(epochStart));
    await market.write.openMarket([1n]);

    const stake = parseUnits("100", 6);
    await market.write.buyAtOdds([1n, 0, stake, odds("1.9")], {
      account: bettor.account,
    });

    const expectedPayout = (stake * 9_900n / 10_000n) * odds("2") / ODDS_PRECISION;
    assert.equal(await market.read.outcomeBalances([bettor.account.address, 1n, 0]), expectedPayout);
    assert.equal((await market.read.epochRemainingCapacity([0n])), parseUnits("1500", 6) - expectedPayout);

    await networkHelpers.time.increaseTo(Number(marketStart));

    const resultDeadline = BigInt(await networkHelpers.time.latest()) + 3_600n;
    const resultSig = await signPacked(
      oracle,
      ["string", "uint256", "address", "uint64", "uint8", "uint256"],
      [
        "QM:proposeResult",
        await publicClient.getChainId(),
        getAddress(market.address),
        1n,
        0,
        resultDeadline,
      ],
    );

    await market.write.proposeResult([1n, 0, resultDeadline, resultSig]);
    await networkHelpers.time.increase(Number(challengeWindow));
    await market.write.finalizeResult([1n]);

    await market.write.claimPayout([1n], { account: bettor.account });

    assert.equal(
      await token.read.balanceOf([bettor.account.address]),
      bettorStartingBalance - stake + expectedPayout,
    );
    assert.equal(await market.read.totalLockedPayouts(), 0n);

    await market.write.advanceEpoch();
    await market.write.requestWithdraw([await market.read.lpShares([lp.account.address])], {
      account: lp.account,
    });
    await networkHelpers.time.increase(Number(withdrawalCooldown));
    await market.write.processWithdrawal({ account: lp.account });

    assert.equal(await market.read.totalLpShares(), 0n);
    assert.equal(await token.read.balanceOf([lp.account.address]), parseUnits("902", 6));
  });
});
