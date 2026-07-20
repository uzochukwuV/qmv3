export default class TxoddsApiClient {
  constructor({ apiKey = null, apiToken = null, network = 'mainnet' }) {
    this.apiKey = apiKey;
    this.apiToken = apiToken;
    this.network = network;
    this.baseUrl = network === 'devnet' ? 'https://txline-dev.txodds.com/api/' : 'https://txline.txodds.com/api/';
    this.authUrl = network === 'devnet' ? 'https://txline-dev.txodds.com/auth/guest/start' : 'https://txline.txodds.com/auth/guest/start';
    this.jwt = null;
  }

  async authenticate() {
    const resp = await fetch(this.authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!resp.ok) throw new Error('txodds guest auth failed: ' + resp.status);
    const data = await resp.json();
    this.jwt = data.token || data.access_token || null;
    if (!this.jwt) throw new Error('txodds guest auth returned no token');
    return this.jwt;
  }

  headers() {
    if (!this.jwt) throw new Error('txodds client not authenticated');
    const headers = {
      authorization: 'Bearer ' + this.jwt,
    };
    const apiToken = this.apiToken || this.apiKey;
    if (apiToken) {
      headers['x-api-token'] = apiToken;
    }
    return headers;
  }

  async requestJson(pathname, params) {
    if (!this.jwt) {
      await this.authenticate();
    }
    const url = new URL(pathname, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const resp = await fetch(url, { headers: this.headers() });
    if (resp.status === 401) {
      await this.authenticate();
      return this.requestJson(pathname, params);
    }
    if (!resp.ok) throw new Error('txodds request failed: ' + url.pathname + ' ' + resp.status);
    return resp.json();
  }

  async getFixtures(epochDay, params = {}) {
    const day = epochDay ?? Math.floor(Date.now() / 86400000);
    const data = await this.requestJson('fixtures/snapshot', { epochDay: day, ...params });
    const items = Array.isArray(data) ? data : [data];
    return items.map((item) => ({
      fixtureId: Number(item.fixtureId ?? item.FixtureId),
      homeTeam: item.homeTeam || item.Participant1 || 'Home',
      awayTeam: item.awayTeam || item.Participant2 || 'Away',
      startTime: normalizeStartTime(item.startTime ?? item.StartTime),
      sportKey: item.sportKey || item.SportKey || 'soccer',
      leagueId: item.leagueId ?? item.LeagueId ?? null,
      leagueName: item.leagueName ?? item.LeagueName ?? null,
      gameState: item.gameState ?? item.GameState ?? null,
      participant1IsHome: item.participant1IsHome ?? item.Participant1IsHome ?? null,
      raw: item,
    }));
  }

  async getUpcomingFixtures(days = 3, params = {}) {
    const now = Math.floor(Date.now() / 1000);
    const out = [];
    const seen = new Set();
    for (let offset = 0; offset < days; offset++) {
      const day = Math.floor(Date.now() / 86400000) + offset;
      const fixtures = await this.getFixtures(day, params);
      for (const fixture of fixtures) {
        if (seen.has(fixture.fixtureId)) continue;
        seen.add(fixture.fixtureId);
        if (fixture.startTime > now) out.push(fixture);
      }
    }
    return out;
  }

  async getOddsSnapshot(fixtureId) {
    const data = await this.requestJson('odds/snapshot/' + fixtureId);
    const lines = Array.isArray(data) ? data : [data];
    if (!lines.length) return null;
    const line = lines[0];
    const rawPrices = line.prices || line.Prices || [];
    const rawPriceNames = line.priceNames || line.PriceNames || [];
    return {
      fixtureId: Number(line.fixtureId ?? line.FixtureId ?? fixtureId),
      ts: Number(line.ts ?? line.Ts ?? Date.now()),
      bookmaker: line.bookmaker || line.Bookmaker || 'unknown',
      inRunning: Boolean(line.inRunning ?? line.InRunning),
      priceNames: Array.isArray(rawPriceNames) ? rawPriceNames.slice() : [],
      prices: Array.isArray(rawPrices) ? rawPrices.map((value) => Number(value)) : [],
      raw: line,
    };
  }

  async getScores(fixtureId) {
    const data = await this.requestJson('scores/snapshot/' + fixtureId);
    return Array.isArray(data) ? data : [data];
  }

  async getFinalResult(fixtureId) {
    const scores = await this.getScores(fixtureId);
    for (const score of scores) {
      if (score.action === 'game_finalised' && Number(score.statusId) === 100 && Number(score.period) === 100) {
        return {
          fixtureId,
          homeScore: Number(score.homeScore ?? 0),
          awayScore: Number(score.awayScore ?? 0),
          raw: score,
        };
      }
    }
    return null;
  }

  async activateApiToken({ txSig, walletSignature, leagues = [] }) {
    const apiToken = this.apiToken || this.apiKey;
    if (apiToken) return apiToken;
    if (!txSig) throw new Error('txodds activation requires txSig when no api token is configured');
    if (!walletSignature) throw new Error('txodds activation requires walletSignature when no api token is configured');
    if (!this.jwt) await this.authenticate();
    const resp = await fetch(new URL('token/activate', this.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + this.jwt,
      },
      body: JSON.stringify({ txSig, walletSignature, leagues }),
    });
    if (!resp.ok) throw new Error('txodds token activation failed: ' + resp.status);
    const data = await resp.json();
    this.apiToken = data.token || data.apiToken || data.access_token || null;
    if (!this.apiToken) throw new Error('txodds token activation returned no token');
    return this.apiToken;
  }
}

export function normalizePrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0n;
  if (num < 100) return BigInt(Math.round(num * 10000));
  return BigInt(Math.round(num));
}

export function oddsArray() {
  return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
}

export function deriveCanonicalFootballOdds(snapshot) {
  const prices = stablePricesToDecimalOdds(snapshot?.prices || []);
  const ftr = deriveFtrOdds(prices);
  const base = averageBigInt(ftr.filter((v) => v > 0n));
  const ouOver = clampBigInt((base * 9n) / 10n, 1_200_000n, 8_000_000n);
  const ouUnder = clampBigInt((ouOver * 95n) / 100n, 1_200_000n, 8_000_000n);
  const bttsYes = clampBigInt((base * 85n) / 100n, 1_200_000n, 8_000_000n);
  const bttsNo = clampBigInt((bttsYes * 115n) / 100n, 1_200_000n, 8_000_000n);
  return {
    ftr,
    ou: [ouOver, ouUnder, 0n, 0n, 0n, 0n, 0n, 0n],
    btts: [bttsYes, bttsNo, 0n, 0n, 0n, 0n, 0n, 0n],
  };
}

export function proofIdForFixture(snapshot, marketKey) {
  return 'txodds:' + snapshot.fixtureId + ':' + snapshot.ts + ':' + snapshot.bookmaker + ':' + marketKey;
}

export function buildOddsProofPayload(snapshot, marketKey, odds) {
  return {
    fixtureId: snapshot.fixtureId,
    ts: snapshot.ts,
    bookmaker: snapshot.bookmaker,
    inRunning: snapshot.inRunning,
    marketKey,
    priceNames: snapshot.priceNames,
    stablePrices: snapshot.prices,
    odds: odds.map((v) => v.toString()),
  };
}

export function deriveFtrOdds(prices) {
  if (prices.length >= 3) return [prices[0], prices[1], prices[2], 0n, 0n, 0n, 0n, 0n];
  if (prices.length === 2) return [prices[0], 30_000n, prices[1], 0n, 0n, 0n, 0n, 0n];
  if (prices.length === 1) return [prices[0], 30_000n, 30_000n, 0n, 0n, 0n, 0n, 0n];
  return [20_000n, 35_000n, 30_000n, 0n, 0n, 0n, 0n, 0n];
}

export function stablePricesToDecimalOdds(prices) {
  const values = prices
    .map((value) => BigInt(Math.max(0, Math.trunc(Number(value)))))
    .filter((value) => value > 0n);

  if (!values.length) {
    return [20_000_000n, 35_000_000n, 30_000_000n, 0n, 0n, 0n, 0n, 0n];
  }

  const total = values.reduce((acc, value) => acc + value, 0n);
  return values.map((probabilityBps) => {
    const odds = (total * 1_000_000n) / probabilityBps;
    return odds < 1_010_000n ? 1_010_000n : odds;
  });
}

function averageBigInt(values) {
  if (!values.length) return 20_000n;
  let total = 0n;
  for (const value of values) total += value;
  return total / BigInt(values.length);
}

function clampBigInt(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeStartTime(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw;
}


