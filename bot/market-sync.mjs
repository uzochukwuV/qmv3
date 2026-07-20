import fs from 'node:fs';
import path from 'node:path';
import { getContract, createPublicClient, createWalletClient, http, keccak256, parseUnits, stringToHex } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import TxoddsApiClient, { buildOddsProofPayload, deriveCanonicalFootballOdds, oddsArray, proofIdForFixture } from './txodds-client.mjs';

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
  if (!value) throw new Error(name + ' is required');
  return value;
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
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
  return oddsArray();
}

function groupTitle(fixture) {
  return fixture.homeTeam + ' vs ' + fixture.awayTeam;
}

function buildMarketSpec(fixture, snapshot, marketType, settlementRule, settlementLine, title, description, oddsValues) {
  const anchor = emptyOdds();
  const volumeCap = emptyOdds();
  const cap = parseUnits(process.env.MARKET_CAP_USDC || '2000000', 6);
  for (let i = 0; i < oddsValues.length; i++) {
    anchor[i] = oddsValues[i];
    volumeCap[i] = cap;
  }
  return {
    fixture,
    snapshot,
    title,
    description,
    params: {
      groupId: 0n,
      title,
      description,
      startTime: BigInt(fixture.startTime),
      numOutcomes: oddsValues[2] > 0n ? 3 : 2,
      marketType,
      category: 0,
      oddsAnchor: anchor,
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
    },
    odds: anchor,
  };
}

async function ensureEpochInitialized(ctx, anchorStartTime) {
  const currentEpoch = await ctx.core.read.currentEpoch();
  const epoch = await ctx.core.read.epochs([currentEpoch]);
  if (epoch.initialized) return currentEpoch;

  const now = BigInt(Math.floor(Date.now() / 1000));
  const start = anchorStartTime > now + 3600n ? anchorStartTime : now + 3600n;
  const tx = await ctx.core.write.initEpoch([start, 15000n]);
  await ctx.publicClient.waitForTransactionReceipt({ hash: tx });
  return currentEpoch;
}
async function ensureFixtureBook(ctx, fixture, snapshot, state) {
  const existing = state.fixtures[String(fixture.fixtureId)];
  const canonical = deriveCanonicalFootballOdds(snapshot);

  if (existing) {
    return {
      fixtureId: fixture.fixtureId,
      groupId: BigInt(existing.groupId),
      marketIds: existing.marketIds.map((id) => BigInt(id)),
      created: false,
      canonical,
      snapshot,
    };
  }

  const groupId = await ctx.core.read.nextGroupId();
  let groupTx;
  try {
    groupTx = await ctx.core.write.createMarketGroup([groupTitle(fixture), BigInt(fixture.startTime), parseUnits('2000000', 6)]);
    await ctx.publicClient.waitForTransactionReceipt({ hash: groupTx });
  } catch (error) {
    const errorName = error?.cause?.data?.errorName || error?.data?.errorName || '';
    if (errorName !== 'EpochNotInitialized') throw error;
    await ensureEpochInitialized(ctx, BigInt(fixture.startTime));
    groupTx = await ctx.core.write.createMarketGroup([groupTitle(fixture), BigInt(fixture.startTime), parseUnits('2000000', 6)]);
    await ctx.publicClient.waitForTransactionReceipt({ hash: groupTx });
  }

  const marketBase = await ctx.core.read.nextMarketId();
  const specs = [
    buildMarketSpec(fixture, snapshot, 0, 1, 0, 'Full-Time Result', 'Home / Draw / Away', canonical.ftr),
    buildMarketSpec(fixture, snapshot, 1, 3, 25, 'Over / Under 2.5', 'Over 2.5 / Under 2.5', canonical.ou),
    buildMarketSpec(fixture, snapshot, 2, 2, 0, 'Both Teams To Score', 'Yes / No', canonical.btts),
  ];

  const marketIds = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    spec.params.groupId = groupId;
    const tx = await ctx.core.write.createMarket([spec.params]);
    await ctx.publicClient.waitForTransactionReceipt({ hash: tx });
    marketIds.push(marketBase + BigInt(i));
  }

  const bWad = parseUnits('100', 18);
  const initialStateProbabilitiesWad = [bWad, bWad, bWad, bWad, bWad, bWad, bWad, bWad, bWad];
  const seedTx = await ctx.core.write.seedGroupPricing([groupId, bWad, initialStateProbabilitiesWad]);
  await ctx.publicClient.waitForTransactionReceipt({ hash: seedTx });

  state.fixtures[String(fixture.fixtureId)] = {
    fixtureId: fixture.fixtureId,
    groupId: groupId.toString(),
    marketIds: marketIds.map((id) => id.toString()),
    title: groupTitle(fixture),
    startTime: fixture.startTime,
    oddsPostedAt: null,
  };

  return {
    fixtureId: fixture.fixtureId,
    groupId,
    marketIds,
    created: true,
    canonical,
    snapshot,
  };
}

async function postOdds(ctx, fixtureBook) {
  const markets = [
    { marketId: fixtureBook.marketIds[0], marketKey: 'ftr', odds: fixtureBook.canonical.ftr },
    { marketId: fixtureBook.marketIds[1], marketKey: 'ou25', odds: fixtureBook.canonical.ou },
    { marketId: fixtureBook.marketIds[2], marketKey: 'btts', odds: fixtureBook.canonical.btts },
  ];

  const posted = [];
  for (const market of markets) {
    const proofPayload = buildOddsProofPayload(fixtureBook.snapshot, market.marketKey, market.odds);
    const proofHash = keccak256(stringToHex(JSON.stringify(proofPayload)));
    const proofId = proofIdForFixture(fixtureBook.snapshot, market.marketKey);
    const tx = await ctx.core.write.postOddsWithProof([market.marketId, market.odds, proofHash, proofId]);
    await ctx.publicClient.waitForTransactionReceipt({ hash: tx });
    posted.push({ marketId: market.marketId.toString(), marketKey: market.marketKey, proofHash, proofId });
  }
  return posted;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(path.resolve(process.cwd(), '.env'));
  loadEnvFile(path.resolve(process.cwd(), 'frontend/.env'));

  const rpcUrl = must('ARBITRUM_SEPOLIA_RPC_URL', process.env.ARBITRUM_SEPOLIA_RPC_URL);
  const privateKey = must('ARBITRUM_SEPOLIA_PRIVATE_KEY', process.env.ARBITRUM_SEPOLIA_PRIVATE_KEY);
  const coreAddress = must('VITE_CORE_ADDRESS', process.env.VITE_CORE_ADDRESS || process.env.CORE_ADDRESS);
  const txoddsApiKey = process.env.TXODDS_API_KEY || process.env.TXODDS_API_TOKEN || null;
  const txoddsApiToken = process.env.TXODDS_API_TOKEN || process.env.TXODDS_API_KEY || null;
  const txoddsNetwork = process.env.TXODDS_NETWORK || 'mainnet';
  const limit = Number(args.limit || process.env.BOT_LIMIT || '3');
  const days = Number(args.days || process.env.BOT_DAYS || '60');
  const minStartBufferSeconds = Number(args.minStartBufferSeconds || process.env.BOT_MIN_START_BUFFER_SECONDS || '0');
  const statePath = path.resolve(process.cwd(), String(args.state || process.env.BOT_STATE || 'bot/market-sync.json'));

  if (!txoddsApiToken) {
    throw new Error('TXODDS_API_TOKEN is required for data requests. If you only have TXODDS_API_KEY, activate the token first or export the activated token as TXODDS_API_TOKEN.');
  }

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpcUrl) });
  const coreAbi = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'artifacts/contracts/Core.sol/Core.json'), 'utf8')).abi;
  const core = getContract({ address: coreAddress, abi: coreAbi, client: { public: publicClient, wallet: walletClient } });
  const txodds = new TxoddsApiClient({ apiKey: txoddsApiKey, apiToken: txoddsApiToken, network: txoddsNetwork });

  await txodds.authenticate();

  const state = readJsonIfExists(statePath, { fixtures: {} });
  const fixtures = await txodds.getUpcomingFixtures(days, { competitionId: 72 });
  const now = Math.floor(Date.now() / 1000);

  const candidates = [];
  for (const fixture of fixtures) {
    if (!fixture || !fixture.fixtureId) continue;
    const sportKey = String(fixture.sportKey || '').toLowerCase();
    if (sportKey && sportKey.indexOf('soccer') === -1 && sportKey.indexOf('football') === -1) continue;
    if (fixture.startTime <= now + minStartBufferSeconds) continue;
    const snapshot = await txodds.getOddsSnapshot(fixture.fixtureId);
    if (!snapshot || !snapshot.prices || !snapshot.prices.length) continue;
    candidates.push({ fixture, snapshot });
    if (candidates.length >= limit) break;
  }

  const summary = [];

  for (const candidate of candidates) {
    const book = await ensureFixtureBook({ core, publicClient }, candidate.fixture, candidate.snapshot, state);
    const posted = await postOdds({ core, publicClient }, book);
    state.fixtures[String(candidate.fixture.fixtureId)].oddsPostedAt = new Date().toISOString();
    state.fixtures[String(candidate.fixture.fixtureId)].proofs = posted;
    summary.push({
      fixtureId: candidate.fixture.fixtureId,
      title: groupTitle(candidate.fixture),
      groupId: book.groupId.toString(),
      marketIds: book.marketIds.map((id) => id.toString()),
      created: book.created,
      posted,
    });
    writeJson(statePath, state);
  }

  writeJson(statePath, state);
  console.log(JSON.stringify({ coreAddress, network: 'arbitrumSepolia', matched: candidates.length, summary }, null, 2));
}

await main();



