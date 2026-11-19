/* ==========================================================================
   hacds.com — 全局配置
   服务端不能改 CORS，所以统一走 Cloudflare Worker 反向代理。
   ========================================================================== */
window.HACDS_CONFIG = {
  // 反向代理（部署 Worker 后填入实际地址；本地开发时改为直连）
  // Worker 会转发到真实的 node / indexer 后端，并补上 CORS + HTTPS。
  apiBase: 'https://api.hacds.com',

  // 索引器（借款人台账 / 续租批次）。工具页的「续租」直接打它。
  indexer: 'https://indexer.hacds.com',

  // 本地直连时的回退（仅用于开发调试；生产环境不用）
  localNode: 'http://127.0.0.1:8082',
  localIndexer: 'http://127.0.0.1:8124',
  useLocal: location.hostname === 'localhost' || location.hostname === '127.0.0.1',

  // 合约地址：主网已部署（2026-11-18，nonce 5）。
  // ⚠ 改这里时同步改 index.html 里的静态回退值（#statContract / #statSerial），
  //   否则 JS 未执行时首页会露出旧值。
  contract: 'bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h',

  // 金库分红合约 B（nonce 4）。index.html 的 app.js 里另有 VAULT_ADDR 常量。
  vault: 'duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4',

  // hacds 资产（serial 4000，主网已发行；股权 HACDS-SHARE serial 4001）
  asset: {
    serial: 4000,
    // decimal=0：1 个最小单位 = 1 个 hacds
    decimal: 0,
    supply: '5963298700000000',              // atoms
    // decimal=0 下显示值与 atoms 相同（不做 ÷1e8）
    supplyHuman: '5,963,298,700,000,000',
  },

  // 发行量推导参数（验证器用）
  issuance: {
    hacdTotal: 16777216,   // HACD 总发行量
    scoreScale: 100000000, // 1 分 = 1e8 atoms
  },

  // 外链
  links: {
    moneynex: 'https://chromewebstore.google.com/detail/moneynex/aokodfkpgklodahhlcnneehpbojjaabf',
    moneynexGithub: 'https://github.com/hacashcom/MoneyNex',
    explorer: 'https://explorer.hacash.org',
    github: 'https://github.com/s6050105/HacdsDeFi',
    whitepaper: '/whitepaper/',
  },

  // 轮询间隔（毫秒）
  pollInterval: 15000,
};
