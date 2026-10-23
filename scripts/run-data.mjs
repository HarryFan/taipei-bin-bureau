// 依序執行資料管線；自動找可用的 Python（Windows 常是 py 或 python，不是 python3）
import { spawnSync } from 'node:child_process'

const STEPS = ['data/scripts/build_bins.py', 'data/scripts/build_grid.py', 'data/scripts/simulate_fill.py']
// --mock：先重新產生模擬資料再建置
if (process.argv.includes('--mock')) STEPS.unshift('data/scripts/generate_mock.py')
const CANDIDATES = [['python3'], ['python'], ['py', '-3']]

const python = CANDIDATES.find(([cmd, ...args]) => {
  const r = spawnSync(cmd, [...args, '-c', 'import sys; assert sys.version_info >= (3, 9)'], { stdio: 'ignore' })
  return r.status === 0
})
if (!python) {
  console.error('找不到 Python 3.9 以上。Windows 請從 python.org 安裝並勾選 Add to PATH。')
  process.exit(1)
}
for (const step of STEPS) {
  const [cmd, ...args] = python
  const r = spawnSync(cmd, [...args, step], { stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
