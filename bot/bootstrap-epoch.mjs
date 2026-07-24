import { spawn } from 'node:child_process'

const child = spawn(process.execPath, ['bot/market-sync.mjs', '--limit=1', '--days=14', '--minStartBufferSeconds=0'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
})

child.on('exit', (code) => process.exit(code ?? 1))

