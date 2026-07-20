const fs = require('fs')
const path = require('path')

const root = process.cwd()
const artifactPath = path.join(root, 'artifacts/contracts/Core.sol/Core.json')
const outputPath = path.join(root, 'frontend/src/lib/core-abi.json')

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
if (!Array.isArray(artifact.abi)) throw new Error('Artifact ABI missing')
fs.writeFileSync(outputPath, JSON.stringify(artifact.abi, null, 2) + '\n')
console.log(`exported ${artifact.abi.length} ABI entries to ${outputPath}`)
