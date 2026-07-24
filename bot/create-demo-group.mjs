import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, getContract, http, parseUnits } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

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

function must(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const idx = body.indexOf('=');
    if (idx === -1) {
      out[body] = true;
    } else {
      out[body.slice(0, idx)] = body.slice(idx + 1);
    }
  }
  return out;
}

function emptyOdds() {
  return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
}

function odd(value) {
  return parseUnits(value, 6);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createMarketParams({
  groupId,
  title,
  description,
  startTime,
  marketType,
  settlementRule,
  settlementLine,
  oddsAnchor,
  volumeCap,
}) {
  return {
    groupId,
    title,
    description,
    startTime,
    numOutcomes: marketType === 0 ? 3 : 2,
    marketType,
    category: 0,
    oddsAnchor,
    maxDeviationBps: 1000n,
    volumeCap,
    settlementRule,
    settlementLine,
    homeOutcomeId: 0,
    drawOutcomeId: 1,
    awayOutcomeId: 2,
    yesOutcomeId: 0,
    noOutcomeId: 1,
    overOutcomeId: 0,
    underOutcomeId: 1,
    sigDeadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    oracleSig: '0x',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  loadEnvFile(path.resolve(process.cwd(), '.env'));
  loadEnvFile(path.resolve(process.cwd(), 'frontend/.env'));

  const rpcUrl = must('ARBITRUM_SEPOLIA_RPC_URL', process.env.ARBITRUM_SEPOLIA_RPC_URL);
  const privateKey = must('ARBITRUM_SEPOLIA_PRIVATE_KEY', process.env.ARBITRUM_SEPOLIA_PRIVATE_KEY);
  const coreAddress = must('VITE_CORE_ADDRESS', process.env.VITE_CORE_ADDRESS || process.env.CORE_ADDRESS);
  const statePath = path.resolve(process.cwd(), String(args.state || process.env.BOT_DEMO_STATE || 'bot/demo-groups.json'));

  const title = String(args.title || 'Manchester United vs Chelsea');
  const home = String(args.home || 'Manchester United');
  const away = String(args.away || 'Chelsea');
  const startOffsetMinutes = Number(args.startOffsetMinutes || 180);
  const groupExposure = parseUnits(String(args.groupExposure || '2000000'), 6);
  const settleDelayHours = Number(args.settleDelayHours || 4);

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpcUrl) });
  const coreAbi = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'artifacts/contracts/Core.sol/Core.json'), 'utf8')).abi;
  const core = getContract({
    address: coreAddress,
    abi: coreAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  const currentEpoch = await core.read.currentEpoch();
  const epoch = await core.read.epochs([currentEpoch]);
  if (!epoch.initialized) {
    const epochStart = BigInt(Math.floor(Date.now() / 1000) + 60);
    try {
      const initTx = await core.write.initEpoch([epochStart, 15000n]);
      await publicClient.waitForTransactionReceipt({ hash: initTx });
    } catch (error) {
      const errorName = error?.cause?.data?.errorName || error?.data?.errorName || '';
      if (errorName !== 'EpochAlreadyInitialized') throw error;
    }
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const startTime = now + BigInt(startOffsetMinutes * 60);
  const groupId = await core.read.nextGroupId();
  const groupTx = await core.write.createMarketGroup([title, startTime, groupExposure]);
  await publicClient.waitForTransactionReceipt({ hash: groupTx });

  const bWad = parseUnits('100', 18);
  const initialStateProbabilitiesWad = Array.from({ length: 9 }, () => bWad);

  const ftrOdds = [odd('3.05'), odd('4.83'), odd('2.15')];
  const ouOdds = [odd('3.01'), odd('2.86')];
  const bttsOdds = [odd('2.84'), odd('3.27')];

  const ftrAnchor = emptyOdds();
  ftrAnchor[0] = ftrOdds[0];
  ftrAnchor[1] = ftrOdds[1];
  ftrAnchor[2] = ftrOdds[2];
  const ouAnchor = emptyOdds();
  ouAnchor[0] = ouOdds[0];
  ouAnchor[1] = ouOdds[1];
  const bttsAnchor = emptyOdds();
  bttsAnchor[0] = bttsOdds[0];
  bttsAnchor[1] = bttsOdds[1];

  const cap = groupExposure;
  const ftrCap = emptyOdds();
  const ouCap = emptyOdds();
  const bttsCap = emptyOdds();
  for (let i = 0; i < 8; i += 1) {
    ftrCap[i] = cap;
    ouCap[i] = cap;
    bttsCap[i] = cap;
  }

  const marketSpecs = [
    {
      title: 'Full-Time Result',
      description: `${home} / Draw / ${away}`,
      marketType: 0,
      settlementRule: 1,
      settlementLine: 0,
      oddsAnchor: ftrAnchor,
      volumeCap: ftrCap,
    },
    {
      title: 'Over / Under 2.5',
      description: 'Over 2.5 / Under 2.5',
      marketType: 1,
      settlementRule: 3,
      settlementLine: 25,
      oddsAnchor: ouAnchor,
      volumeCap: ouCap,
    },
    {
      title: 'Both Teams To Score',
      description: 'Yes / No',
      marketType: 2,
      settlementRule: 2,
      settlementLine: 0,
      oddsAnchor: bttsAnchor,
      volumeCap: bttsCap,
    },
  ];

  const marketIds = [];
  for (const spec of marketSpecs) {
    const txHash = await core.write.createMarket([
      createMarketParams({
        groupId,
        title: spec.title,
        description: spec.description,
        startTime,
        marketType: spec.marketType,
        settlementRule: spec.settlementRule,
        settlementLine: spec.settlementLine,
        oddsAnchor: spec.oddsAnchor,
        volumeCap: spec.volumeCap,
      }),
    ]);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    marketIds.push(await core.read.nextMarketId() - 1n);
  }

  const seedTx = await core.write.seedGroupPricing([groupId, bWad, initialStateProbabilitiesWad]);
  await publicClient.waitForTransactionReceipt({ hash: seedTx });

  const schedule = readJson(statePath, { groups: [] });
  const settleAt = Number(startTime) + settleDelayHours * 3600;
  schedule.groups = Array.isArray(schedule.groups) ? schedule.groups : [];
  schedule.groups.push({
    groupId: groupId.toString(),
    title,
    home,
    away,
    state: 'open',
    startTime: Number(startTime),
    betCloseAt: Number(startTime),
    settleAt,
    marketIds: marketIds.map((id) => id.toString()),
    markets: [
      { marketId: marketIds[0].toString(), title: 'Full-Time Result', state: 'open', betCloseAt: Number(startTime), settleAt },
      { marketId: marketIds[1].toString(), title: 'Over / Under 2.5', state: 'open', betCloseAt: Number(startTime), settleAt },
      { marketId: marketIds[2].toString(), title: 'Both Teams To Score', state: 'open', betCloseAt: Number(startTime), settleAt },
    ],
  });
  writeJson(statePath, schedule);

  console.log(JSON.stringify({
    ok: true,
    coreAddress,
    groupId: groupId.toString(),
    title,
    startTime: Number(startTime),
    settleAt,
    marketIds: marketIds.map((id) => id.toString()),
    schedulePath: statePath,
  }, null, 2));
}

await main();


