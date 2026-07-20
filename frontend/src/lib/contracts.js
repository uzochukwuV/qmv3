import { Contract, JsonRpcProvider } from '../../node_modules/ethers/lib.esm/index.js'
import coreAbi from './core-abi.json'
import betSlipsAbi from './betslips-abi.json'

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

export const CORE_ABI = coreAbi
export const LIQUIDITY_VAULT_ABI = [
  'function lpNav() view returns (uint256)',
  'function totalLpShares() view returns (uint256)',
  'function getLPStats(address) view returns (uint256 shares,uint256 totalShares,uint256 nav,uint256 positionValue,uint256 freeLiquidity,uint256 pendingWithdrawalShares,uint256 withdrawalAvailableAt,uint64 withdrawalEpochId,bool withdrawalPending,bool withdrawalEpochSettled)',
]

export const BET_SLIPS_ABI = betSlipsAbi
