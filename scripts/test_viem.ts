import { encodeFunctionData, parseUnits } from "viem";

function odds(value: string) { return parseUnits(value, 6); }

const placeSlipAbi = [
  {
    name: "placeSlip",
    type: "function",
    inputs: [{
      name: "p",
      type: "tuple",
      components: [
        { name: "legs", type: "tuple[8]", components: [
          { name: "marketId", type: "uint64" },
          { name: "outcomeId", type: "uint8" },
          { name: "minOdds", type: "uint256" },
        ]},
        { name: "numLegs", type: "uint8" },
        { name: "totalStake", type: "uint256" },
        { name: "minCombinedOdds", type: "uint256" },
      ]
    }],
    outputs: [{ type: "uint64" }],
    stateMutability: "nonpayable",
  }
];

const legs = [
  { marketId: 1n, outcomeId: 0, minOdds: odds("1.9") },
  { marketId: 0n, outcomeId: 0, minOdds: 0n },
  { marketId: 0n, outcomeId: 0, minOdds: 0n },
  { marketId: 0n, outcomeId: 0, minOdds: 0n },
  { marketId: 0n, outcomeId: 0, minOdds: 0n },
  { marketId: 0n, outcomeId: 0, minOdds: 0n },
  { marketId: 0n, outcomeId: 0, minOdds: 0n },
  { marketId: 0n, outcomeId: 0, minOdds: 0n },
];

const params = { legs, numLegs: 1, totalStake: parseUnits("10", 6), minCombinedOdds: odds("1") };

try {
  const data = encodeFunctionData({ abi: placeSlipAbi, functionName: "placeSlip", args: [params] });
  console.log("SUCCESS! Length:", data.length);
} catch (e: any) {
  console.log("ERROR:", e.message);
}
