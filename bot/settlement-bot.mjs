import fs from 'node:fs';
import path from 'node:path';
import { arbitrumSepolia } from 'viem/chains';
import { createPublicClient, createWalletClient, encodePacked, hexToBytes, http, keccak256, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import TxoddsApiClient from './txodds-client.mjs';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function must(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseGroupMap(config) {
  if (Array.isArray(config)) {
    return config.map((entry) => ({
      groupId: Number(entry.groupId),
      fixtureId: Number(entry.fixtureId),
      title: entry.title || '',
      marketIds: Array.isArray(entry.marketIds) ? entry.marketIds.map((id) => Number(id)) : [],
      proofs: Array.isArray(entry.proofs) ? entry.proofs : [],
    }));
  }

  if (config && typeof config === 'object' && config.fixtures && typeof config.fixtures === 'object') {
    return Object.values(config.fixtures).map((entry) => ({
      groupId: Number(entry.groupId),
      fixtureId: Number(entry.fixtureId),
      title: entry.title || '',
      marketIds: Array.isArray(entry.marketIds) ? entry.marketIds.map((id) => Number(id)) : [],
      proofs: Array.isArray(entry.proofs) ? entry.proofs : [],
    }));
  }

  const entries = config?.groups;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('group map must be an array, { groups: [...] }, or a market-sync state file');
  }

  return entries.map((entry) => ({
    groupId: Number(entry.groupId),
    fixtureId: Number(entry.fixtureId),
    title: entry.title || '',
    marketIds: Array.isArray(entry.marketIds) ? entry.marketIds.map((id) => Number(id)) : [],
    proofs: Array.isArray(entry.proofs) ? entry.proofs : [],
  }));
}

function buildProposalHash({ chainId, coreAddress, groupId, homeScore, awayScore, sigDeadline }) {
  return keccak256(
    encodePacked(
      ['string', 'uint256', 'address', 'uint64', 'uint16', 'uint16', 'uint256'],
      ['QM:proposeGroupResult', BigInt(chainId), coreAddress, BigInt(groupId), BigInt(homeScore), BigInt(awayScore), BigInt(sigDeadline)]
    )
  );
}

const CORE_ABI = parseAbi([
  'function proposeGroupResult(uint64 groupId,uint16 homeScore,uint16 awayScore,uint256 sigDeadline,bytes sig) external',
  'function finalizeGroupResult(uint64 groupId) external',
  'function groupDisputes(uint64) view returns (uint64 groupId,uint16 homeScore,uint16 awayScore,address proposer,uint256 createdAt,uint256 challengeDeadline,uint8 status,bool exists)',
]);

async function main() {
  const argv = Object.fromEntries(process.argv.slice(2).map((arg) => {
    if (!arg.startsWith('--')) return [arg, true];
    const [k, v] = arg.slice(2).split('=');
    return [k, v ?? true];
  }));

  const mode = String(argv.mode || process.env.BOT_MODE || 'sync');
  const configPath = path.resolve(process.cwd(), String(argv.config || process.env.BOT_CONFIG || 'bot/market-sync.json'));

  loadEnvFile(path.resolve(process.cwd(), '.env'));
  loadEnvFile(path.resolve(process.cwd(), 'frontend/.env'));

  const rpcUrl = must('ARBITRUM_SEPOLIA_RPC_URL', process.env.ARBITRUM_SEPOLIA_RPC_URL);
  const privateKey = must('ARBITRUM_SEPOLIA_PRIVATE_KEY', process.env.ARBITRUM_SEPOLIA_PRIVATE_KEY);
  const coreAddress = must('VITE_CORE_ADDRESS', process.env.VITE_CORE_ADDRESS || process.env.CORE_ADDRESS);
  const txoddsApiKey = process.env.TXODDS_API_KEY || process.env.TXODDS_API_TOKEN || null;
  const txoddsNetwork = process.env.TXODDS_NETWORK || 'mainnet';
  const signatureSeconds = Number(process.env.TXORACLE_SIG_SECONDS || '600');

  const map = parseGroupMap(loadJson(configPath));
  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
  if (!txoddsApiKey) throw new Error('TXODDS_API_KEY or TXODDS_API_TOKEN is required');
  const txodds = new TxoddsApiClient({ apiKey: txoddsApiKey, network: txoddsNetwork });

  await txodds.authenticate();

  const results = [];

  for (const item of map) {
    const finalResult = await txodds.getFinalResult(item.fixtureId);
    if (!finalResult) {
      results.push({ groupId: item.groupId, fixtureId: item.fixtureId, status: 'pending', title: item.title });
      continue;
    }

    const sigDeadline = Math.floor(Date.now() / 1000) + signatureSeconds;
    const msgHash = buildProposalHash({
      chainId: arbitrumSepolia.id,
      coreAddress,
      groupId: item.groupId,
      homeScore: finalResult.homeScore,
      awayScore: finalResult.awayScore,
      sigDeadline,
    });
    const sig = await walletClient.signMessage({ account, message: { raw: hexToBytes(msgHash) } });

    if (mode === 'propose' || mode === 'sync') {
      const txHash = await walletClient.writeContract({
        address: coreAddress,
        abi: CORE_ABI,
        functionName: 'proposeGroupResult',
        args: [BigInt(item.groupId), finalResult.homeScore, finalResult.awayScore, BigInt(sigDeadline), sig],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    }

    if (mode === 'finalize' || mode === 'sync') {
      const dispute = await publicClient.readContract({
        address: coreAddress,
        abi: CORE_ABI,
        functionName: 'groupDisputes',
        args: [BigInt(item.groupId)],
      });
      const challengeDeadline = Number(dispute[5] || 0n);
      const isPending = Boolean(dispute[7]);
      if (isPending && Math.floor(Date.now() / 1000) >= challengeDeadline) {
        const txHash = await walletClient.writeContract({
          address: coreAddress,
          abi: CORE_ABI,
          functionName: 'finalizeGroupResult',
          args: [BigInt(item.groupId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }
    }

    results.push({
      groupId: item.groupId,
      fixtureId: item.fixtureId,
      status: 'settled',
      homeScore: finalResult.homeScore,
      awayScore: finalResult.awayScore,
      title: item.title,
    });
  }

  console.log(JSON.stringify({ mode, coreAddress, results }, null, 2));
}

await main();
