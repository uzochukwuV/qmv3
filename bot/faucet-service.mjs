import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createPublicClient, createWalletClient, getContract, http as viemHttp, isAddress, parseUnits } from 'viem'
import { arbitrumSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const TOKEN_ABI = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
]

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const key = t.slice(0, i).trim()
    let value = t.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}

function must(name, value) {
  if (!value) throw new Error(`${name} is required`)
  return value
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return fallback }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n')
}

function sendJson(res, code, body) {
  const payload = Buffer.from(JSON.stringify(body, null, 2))
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-admin-key',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      resolve(raw ? JSON.parse(raw) : {})
    })
    req.on('error', reject)
  })
}

function amountForPurpose(purpose, decimals) {
  return parseUnits(purpose === 'lp' ? (process.env.FAUCET_LP_AMOUNT_USDC || '100000') : (process.env.FAUCET_BETTING_AMOUNT_USDC || '5000'), decimals)
}

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd: process.cwd(), env: process.env, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`)))
  })
}

async function main() {
  loadEnv(path.resolve(process.cwd(), '.env'))
  loadEnv(path.resolve(process.cwd(), 'frontend/.env'))

  const port = Number(process.env.FAUCET_PORT || 8787)
  const rpcUrl = must('ARBITRUM_SEPOLIA_RPC_URL', process.env.ARBITRUM_SEPOLIA_RPC_URL)
  const privateKey = must('ARBITRUM_SEPOLIA_PRIVATE_KEY', process.env.ARBITRUM_SEPOLIA_PRIVATE_KEY)
  const tokenAddress = must('FAUCET_TOKEN_ADDRESS', process.env.FAUCET_TOKEN_ADDRESS || process.env.VITE_MOCK_TOKEN_ADDRESS)
  const tokenDecimals = Number(process.env.FAUCET_TOKEN_DECIMALS || process.env.VITE_MOCK_TOKEN_DECIMALS || 6)
  const tokenSymbol = process.env.FAUCET_TOKEN_SYMBOL || process.env.VITE_MOCK_TOKEN_SYMBOL || 'USDC'
  const statePath = path.resolve(process.cwd(), process.env.FAUCET_STATE || 'bot/faucet-state.json')
  const adminKey = process.env.FAUCET_ADMIN_KEY || ''
  const cooldownSeconds = Math.max(1, Number(process.env.FAUCET_COOLDOWN_HOURS || 24) * 3600)

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`)
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: viemHttp(rpcUrl) })
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: viemHttp(rpcUrl) })
  const token = getContract({ address: tokenAddress, abi: TOKEN_ABI, client: { public: publicClient, wallet: walletClient } })
  const state = readJson(statePath, { claims: {} })

  async function handleStatus(req, res, url) {
    const address = String(url.searchParams.get('address') || '').trim()
    if (!isAddress(address)) return sendJson(res, 400, { ok: false, error: 'Invalid address' })
    const record = state.claims[address.toLowerCase()] || null
    const balance = await token.read.balanceOf([address]).catch(() => 0n)
    const now = Math.floor(Date.now() / 1000)
    sendJson(res, 200, {
      ok: true,
      address,
      tokenSymbol,
      tokenDecimals,
      balance: balance.toString(),
      balanceFormatted: Number(balance) / 10 ** tokenDecimals,
      cooldownSeconds,
      canClaim: !record || Number(record.nextEligibleAt || 0) <= now,
      lastClaimAt: record?.lastClaimAt || null,
      nextEligibleAt: record?.nextEligibleAt || null,
      lastPurpose: record?.purpose || null,
      lastTxHash: record?.txHash || null,
      amounts: { betting: Number(process.env.FAUCET_BETTING_AMOUNT_USDC || 5000), lp: Number(process.env.FAUCET_LP_AMOUNT_USDC || 100000) },
    })
  }

  async function handleClaim(req, res) {
    try {
      const body = await readBody(req)
      const address = String(body.address || '').trim()
      const purpose = String(body.purpose || 'betting').toLowerCase() === 'lp' ? 'lp' : 'betting'
      if (!isAddress(address)) return sendJson(res, 400, { ok: false, error: 'Invalid address' })
      const key = address.toLowerCase()
      const now = Math.floor(Date.now() / 1000)
      const record = state.claims[key]
      if (record && Number(record.nextEligibleAt || 0) > now) {
        return sendJson(res, 429, { ok: false, error: 'Cooldown active', nextEligibleAt: record.nextEligibleAt, lastClaimAt: record.lastClaimAt, tokenSymbol })
      }
      const amount = amountForPurpose(purpose, tokenDecimals)
      const txHash = await token.write.mint([address, amount])
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      state.claims[key] = { purpose, amount: amount.toString(), txHash, lastClaimAt: now, nextEligibleAt: now + cooldownSeconds }
      writeJson(statePath, state)
      sendJson(res, 200, { ok: true, address, purpose, amount: amount.toString(), amountFormatted: Number(amount) / 10 ** tokenDecimals, tokenSymbol, txHash, lastClaimAt: now, nextEligibleAt: now + cooldownSeconds })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error?.shortMessage || error?.message || 'Faucet claim failed' })
    }
  }

  async function requireAdmin(req, res) {
    if (!adminKey) return true
    if (String(req.headers['x-admin-key'] || '') === adminKey) return true
    sendJson(res, 401, { ok: false, error: 'Unauthorized' })
    return false
  }

  async function handleSyncMarkets(req, res) {
    if (!(await requireAdmin(req, res))) return
    try { await runScript(path.resolve(process.cwd(), 'bot/market-sync.mjs')); sendJson(res, 200, { ok: true, message: 'market sync complete' }) }
    catch (error) { sendJson(res, 500, { ok: false, error: error?.message || 'market sync failed' }) }
  }

  async function handleBootstrap(req, res) {
    if (!(await requireAdmin(req, res))) return
    try { await runScript(path.resolve(process.cwd(), 'bot/bootstrap-epoch.mjs')); sendJson(res, 200, { ok: true, message: 'bootstrap complete' }) }
    catch (error) { sendJson(res, 500, { ok: false, error: error?.message || 'bootstrap failed' }) }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
    if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true })
    if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, tokenSymbol, port })
    if (req.method === 'GET' && url.pathname === '/api/faucet/status') return handleStatus(req, res, url)
    if (req.method === 'POST' && url.pathname === '/api/faucet/claim') return handleClaim(req, res)
    if (req.method === 'POST' && url.pathname === '/api/admin/sync-markets') return handleSyncMarkets(req, res)
    if (req.method === 'POST' && url.pathname === '/api/admin/bootstrap-epoch') return handleBootstrap(req, res)
    return sendJson(res, 404, { ok: false, error: 'Not found' })
  })

  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ ok: true, service: 'faucet', port, tokenAddress, tokenSymbol, cooldownSeconds }, null, 2)))
}

await main()

