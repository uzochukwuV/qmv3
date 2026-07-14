import { Contract, JsonRpcProvider } from '../../node_modules/ethers/lib.esm/index.js'

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}

export const CONTRACT_CHAIN_ID = Number(
  env.VITE_CONTRACT_CHAIN_ID || env.VITE_MAGIC_CHAIN_ID || 11155111
)
export const CONTRACT_RPC_URL =
  env.VITE_CONTRACT_RPC_URL || env.VITE_MAGIC_RPC_URL || 'https://rpc.sepolia.org'

export const CONTRACT_ADDRESSES = {
  core: env.VITE_CORE_ADDRESS || '',
  liquidityVault: env.VITE_LIQUIDITY_VAULT_ADDRESS || '',
  betSlips: env.VITE_BETSLIPS_ADDRESS || '',
}

export const ODDS_PRECISION = 1_000_000n

export function hasContractAddresses() {
  return Boolean(CONTRACT_ADDRESSES.core)
}

export function getReadProvider() {
  return new JsonRpcProvider(CONTRACT_RPC_URL, CONTRACT_CHAIN_ID)
}

export function getCoreContract(provider = getReadProvider()) {
  return CONTRACT_ADDRESSES.core ? new Contract(CONTRACT_ADDRESSES.core, CORE_ABI, provider) : null
}

export function getLiquidityVaultContract(provider = getReadProvider()) {
  return CONTRACT_ADDRESSES.liquidityVault
    ? new Contract(CONTRACT_ADDRESSES.liquidityVault, LIQUIDITY_VAULT_ABI, provider)
    : null
}

export function getBetSlipsContract(provider = getReadProvider()) {
  return CONTRACT_ADDRESSES.betSlips ? new Contract(CONTRACT_ADDRESSES.betSlips, BET_SLIPS_ABI, provider) : null
}

export const CORE_ABI = [
  'function nextGroupId() view returns (uint64)',
  'function currentEpoch() view returns (uint64)',
  'function marketGroups(uint64) view returns (uint64,address,string,uint256,uint256,uint256,uint8,uint64[8],bool,bool,uint256,int256[9],uint16,uint16,bool)',
  'function markets(uint64) view returns (uint64,address,uint256,uint8,uint8,uint256[8],uint256[8],uint256,uint256[8],uint256[8],uint256[8],uint256,uint256,uint256,uint8,string,string,uint8,uint64,bool,uint8,uint8,uint16,uint8,uint8,uint8,uint8,uint8,uint8,uint8,uint64,bool,uint256,uint256)',
  'function getGroupNumMarkets(uint64) view returns (uint16)',
  'function getGroupMarketId(uint64,uint8) view returns (uint64)',
]

export const LIQUIDITY_VAULT_ABI = [
  'function lpNav() view returns (uint256)',
  'function totalLpShares() view returns (uint256)',
  'function getLPStats(address) view returns (uint256 shares,uint256 totalShares,uint256 nav,uint256 positionValue,uint256 freeLiquidity,uint256 pendingWithdrawalShares,uint256 withdrawalAvailableAt,uint64 withdrawalEpochId,bool withdrawalPending,bool withdrawalEpochSettled)',
]

export const BET_SLIPS_ABI = [
  'function getSlipStatusView(uint64) view returns (tuple(uint64 slipId,address owner,uint64 epochId,uint8 numLegs,uint256 totalStake,uint256 potentialPayout,uint256 epochLockedPayouts,uint8 status,bool active,bool won,bool claimable))',
  'function getSlip(uint64) view returns (tuple(uint64 slipId,address creator,uint64 epochId,uint8 numLegs,uint256 totalStake,uint256 potentialPayout,uint256 epochLockedPayouts,uint8 status,bool active,bool won,bool claimable))',
  'function quoteSlip((address owner,uint256 stake,uint64[] marketIds,uint8[] outcomeIds,uint256[] odds,uint64 epochId)) view returns (tuple(uint256 totalOdds,uint256 potentialPayout,uint256 discountedPayout,uint256 discountBps,uint256 crossMatchBonusBps,bool isValid))',
]


