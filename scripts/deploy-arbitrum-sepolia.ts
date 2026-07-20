import { network } from "hardhat";
import { parseUnits } from "viem";

const DEPLOY_NETWORK = process.env.DEPLOY_NETWORK || "arbitrumSepolia";
const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS;
const LP_MINTS = (process.env.LP_MINTS || "").split(",").map((s) => s.trim()).filter(Boolean);
const BETTOR_MINTS = (process.env.BETTOR_MINTS || "").split(",").map((s) => s.trim()).filter(Boolean);
const DEPLOYER_MINT_USDC = process.env.DEPLOYER_MINT_USDC !== "0";
const DEPLOYER_MINT_AMOUNT = parseUnits(process.env.DEPLOYER_MINT_AMOUNT || "10000000", 6);
const RECIPIENT_MINT_AMOUNT = parseUnits(process.env.RECIPIENT_MINT_AMOUNT || "1000000", 6);
const LP_DEPOSIT_USDC = parseUnits(process.env.LP_DEPOSIT_USDC || "1000000", 6);
const GROUP_EXPOSURE_USDC = parseUnits(process.env.GROUP_EXPOSURE_USDC || "2000000", 6);

async function main() {
  const { viem } = await network.create(DEPLOY_NETWORK);
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();
  const oracleAddress = ORACLE_ADDRESS || deployer.account.address;

  const mockUsdc = await viem.deployContract("MockUSDC");
  const core = await viem.deployContract("Core", [mockUsdc.address, oracleAddress, GROUP_EXPOSURE_USDC]);
  const vault = await viem.deployContract("LiquidityVault");
  const betSlips = await viem.deployContract("BetSlips");
  const pricingEngine = await viem.deployContract("StateSpacePricing9");

  await vault.write.setCore([core.address]);
  await betSlips.write.setCore([core.address]);
  await core.write.setLiquidityVault([vault.address]);
  await core.write.setPricingEngine([pricingEngine.address]);
  await core.write.setBetSlips([betSlips.address]);

  if (DEPLOYER_MINT_USDC) {
    await mockUsdc.write.mint([deployer.account.address, DEPLOYER_MINT_AMOUNT]);
  }

  for (const recipient of LP_MINTS) {
    await mockUsdc.write.mint([recipient, RECIPIENT_MINT_AMOUNT]);
  }

  for (const recipient of BETTOR_MINTS) {
    await mockUsdc.write.mint([recipient, RECIPIENT_MINT_AMOUNT]);
  }

  console.log(JSON.stringify({
    network: DEPLOY_NETWORK,
    chainId: await publicClient.getChainId(),
    deployer: deployer.account.address,
    oracle: oracleAddress,
    token: mockUsdc.address,
    core: core.address,
    liquidityVault: vault.address,
    betSlips: betSlips.address,
    pricingEngine: pricingEngine.address,
    minted: {
      deployer: DEPLOYER_MINT_USDC ? DEPLOYER_MINT_AMOUNT.toString() : "0",
      lpRecipients: LP_MINTS.length,
      bettorRecipients: BETTOR_MINTS.length,
      lpMintAmount: RECIPIENT_MINT_AMOUNT.toString(),
      bettorMintAmount: RECIPIENT_MINT_AMOUNT.toString(),
      targetLpDeposit: LP_DEPOSIT_USDC.toString(),
    },
  }, null, 2));
}

await main();
