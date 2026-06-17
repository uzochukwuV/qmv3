# Hardhat Project Guide

This is a Hardhat 3 project using TypeScript, viem, and `@nomicfoundation/hardhat-toolbox-viem`.

## Tooling

- Hardhat: `^3.9.0`
- Toolbox: `@nomicfoundation/hardhat-toolbox-viem`
- TypeScript: `~6.0.3`
- Solidity compiler: `0.8.28`
- OpenZeppelin Contracts: `^5.6.1`
- Base-token assumptions in the contracts target USDC-style 6-decimal ERC20 accounting.

## Commands

```shell
npm install
npx hardhat compile
npx hardhat test
npx hardhat test nodejs
npx hardhat test solidity
```

## Configuration Notes

`hardhat.config.ts` enables:

- `viaIR: true`
- optimizer enabled with `runs: 1`
- `metadata.bytecodeHash: "none"`
- simulated L1 network: `hardhatMainnet`
- simulated OP network: `hardhatOp`
- Sepolia HTTP network using `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY`

The low optimizer run count and metadata stripping are intentional bytecode-size controls for the large protocol surface.

## Hardhat 3 Patterns To Follow

- Use the `hardhat` import and `network.create()` in TypeScript tests and scripts.
- Prefer viem clients and contract helpers exposed by the viem toolbox.
- Use Node's native test runner style for TypeScript integration tests.
- For Solidity unit tests, keep tests under `contracts/` or `test/` with `*.t.sol`/`*.sol` as appropriate.
- After changing contracts, compile before typechecking or running TypeScript tests so generated artifacts and types are current.

## Repo-Specific Testing Priorities

The root lifecycle test covers one happy path from LP deposit through bettor claim and LP withdrawal. Add focused tests for:

- constructor defaults and admin/operator permissions
- epoch initialization edge cases, NAV, and withdrawal failure paths
- category voting failure paths and winner changes
- market group and market creation invalid signatures
- odds update signature validation, expiry, and deviation limits
- `buyAtOdds()` fee, volume-cap, and epoch-exposure reverts
- slip placement, same-match discounts, cross-match bonus, transfer, cancel, claim, and void refund
- result proposal, challenge window, admin override, finalization, and permissionless voiding
