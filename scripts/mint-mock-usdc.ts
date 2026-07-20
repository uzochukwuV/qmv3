import { network } from "hardhat";
import { parseUnits } from "viem";

const DEPLOY_NETWORK = process.env.DEPLOY_NETWORK || "arbitrumSepolia";
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const RECIPIENTS = (process.env.RECIPIENTS || "").split(",").map((s) => s.trim()).filter(Boolean);
const AMOUNT_USDC = parseUnits(process.env.AMOUNT_USDC || "1000000", 6);

if (!TOKEN_ADDRESS) {
  throw new Error("TOKEN_ADDRESS is required");
}

async function main() {
  const { viem } = await network.create(DEPLOY_NETWORK);
  const [deployer] = await viem.getWalletClients();
  const token = await viem.getContractAt("MockUSDC", TOKEN_ADDRESS);
  const publicClient = await viem.getPublicClient();

  const minted = [];
  for (const recipient of RECIPIENTS) {
    const hash = await token.write.mint([recipient, AMOUNT_USDC], { account: deployer.account });
    await publicClient.waitForTransactionReceipt({ hash });
    minted.push(recipient);
  }

  console.log(JSON.stringify({
    network: DEPLOY_NETWORK,
    token: TOKEN_ADDRESS,
    amount: AMOUNT_USDC.toString(),
    minted,
  }, null, 2));
}

await main();
