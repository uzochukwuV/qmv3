import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseUnits } from "viem";

describe("Simple test", async function () {
  const { viem, networkHelpers } = await network.create({ network: 'hardhat' });

  async function deployThree() {
    const [admin, oracle, lp, bettor] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const token = await viem.deployContract("MockUSDC");

    const core = await viem.deployContract("Core", [
      token.address, oracle.account.address, parseUnits("100000", 6),
    ]);
    const vault = await viem.deployContract("LiquidityVault");

    await vault.write.setCore([core.address]);
    await core.write.setLiquidityVault([vault.address]);

    return { admin, oracle, lp, bettor, publicClient, token, core, vault };
  }

  it("deploy three contracts - should call openMarket", async function () {
    const ctx = await networkHelpers.loadFixture(deployThree);
    const now = BigInt(await networkHelpers.time.latest());
    
    console.log("Before initEpoch - currentEpoch:", await ctx.core.read.currentEpoch());
    
    const hash = await ctx.core.write.initEpoch([now + 60n, 15000n]);
    console.log("initEpoch hash:", hash);
    await ctx.publicClient.waitForTransactionReceipt({ hash });
    
    const epoch = await ctx.core.read.currentEpoch();
    console.log("After initEpoch - currentEpoch:", epoch);
    assert.equal(epoch, 0n);
  });
});
