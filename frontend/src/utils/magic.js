import { formatEther, getAddress, isAddress } from '../../node_modules/ethers/lib.esm/index.js'

export function formatAddress(address, keep = 4) {
  if (!address || !isAddress(address)) return ''

  const checksummed = getAddress(address)
  return `${checksummed.slice(0, 2 + keep)}…${checksummed.slice(-keep)}`
}

export function formatEthBalance(balanceWei) {
  if (balanceWei == null) return '0.00'

  try {
    return Number.parseFloat(formatEther(balanceWei)).toFixed(4)
  } catch {
    return '0.00'
  }
}

export function normalizeMagicWalletAddress(userInfo) {
  return (
    userInfo?.metadata?.wallets?.ethereum?.publicAddress ||
    userInfo?.metadata?.publicAddress ||
    null
  )
}
