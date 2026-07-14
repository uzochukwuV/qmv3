import { Magic } from 'magic-sdk'
import { BrowserProvider } from '../../node_modules/ethers/lib.esm/index.js'

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
const DEFAULT_CHAIN_ID = 11155111
const DEFAULT_RPC_URL = 'https://rpc.sepolia.org'

export const MAGIC_API_KEY =
  env.VITE_MAGIC_API_KEY ||
  env.VITE_MAGIC_PUBLISHABLE_KEY ||
  ''

export const MAGIC_CHAIN_ID = Number(env.VITE_MAGIC_CHAIN_ID || DEFAULT_CHAIN_ID)
export const MAGIC_RPC_URL = env.VITE_MAGIC_RPC_URL || DEFAULT_RPC_URL

let magicInstance = null

export function hasMagicConfig() {
  return Boolean(MAGIC_API_KEY)
}

export function getMagicNetwork() {
  return {
    chainId: MAGIC_CHAIN_ID,
    rpcUrl: MAGIC_RPC_URL,
  }
}

export function getMagicClient() {
  if (!hasMagicConfig()) {
    return null
  }

  if (!magicInstance) {
    magicInstance = new Magic(MAGIC_API_KEY, {
      network: getMagicNetwork(),
    })
  }

  return magicInstance
}

export function resetMagicClient() {
  magicInstance = null
}

export function getMagicEthersProvider(magic = getMagicClient()) {
  if (!magic) {
    return null
  }

  return new BrowserProvider(magic.rpcProvider)
}

export function getMagicEthereumAddress(userInfo) {
  return (
    userInfo?.metadata?.wallets?.ethereum?.publicAddress ||
    userInfo?.metadata?.publicAddress ||
    null
  )
}

export function isMagicReady() {
  return hasMagicConfig()
}

