'use strict';
// 评分测试向量自检：本地评分模块必须在全部向量上给出与文件一致的 score。
// 用法：node 评分自检.js [向量文件] [diamond-score.js]
// 评分是确定性纯函数（输入 name + number + visual_gene），可作为回归基线。
const fs = require('fs');
const path = require('path');

const vec = process.argv[2] || 'hacds_exchange/fuzz_vectors.txt';
const mod = process.argv[3] || 'wallet-app/renderer/diamond-score.js';

require(path.resolve(mod));
const DS = globalThis.DiamondScore;
if (!DS || typeof DS.analyse !== 'function') {
  console.error('✗ diamond-score.js 未导出 analyse');
  process.exit(1);
}

const lines = fs.readFileSync(vec, 'utf8')
  .split('\n')
  .map(l => l.replace(/\r$/, ''))
  .filter(l => l.trim() && !l.trim().startsWith('#'));

let ok = 0, bad = 0;
for (const l of lines) {
  const p = l.trim().split(/\s+/);
  if (p.length !== 4) continue;          // 4 列：name vg number score
  const [name, vg, num, score] = p;
  let got = null;
  try { got = DS.analyse(name, Number(num), vg).score; } catch (e) { got = 'ERR ' + e.message; }
  if (got === Number(score)) ok++;
  else { if (bad < 5) console.log('  MISMATCH %s vg=%s num=%s file=%s local=%s', name, vg, num, score, got); bad++; }
}
console.log('%d/%d vectors match', ok, ok + bad);
process.exit(bad ? 1 : 0);
