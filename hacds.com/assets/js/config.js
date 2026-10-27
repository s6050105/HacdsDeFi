/* ==========================================================================
   hacds.com — 全局配置
   服务端不能改 CORS，所以统一走 Cloudflare Worker 反向代理。
   ========================================================================== */
window.HACDS_CONFIG = {
  // 反向代理（部署 Worker 后填入实际地址；本地开发时改为直连）
  // Worker 会转发到真实的 node / indexer 后端，并补上 CORS + HTTPS。
  apiBase: 'https://api.hacds.com',

  // 本地直连时的回退（仅用于开发调试；生产环境不用）
  localNode: 'http://127.0.0.1:8082',
  useLocal: location.hostname === 'localhost' || location.hostname === '127.0.0.1',

  // 合约地址：#3000 部署后替换
  // 当前链上是 #2000（VKNw...），#3000 未部署。
  // 官网按 #3000 规格构建，部署后改这一行即可。
  contract: 'T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH',

  // hacds 资产（#3000 定稿）
  asset: {
    serial: 3000,
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
