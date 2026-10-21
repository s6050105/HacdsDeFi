const { contextBridge, ipcRenderer } = require('electron');

// 只暴露白名单能力，渲染进程拿不到 Node / fs / 私钥。
contextBridge.exposeInMainWorld('api', {
  // 账户（外部 key 文件）
  pickKey: () => ipcRenderer.invoke('key:pick'),
  keyAddr: (path) => ipcRenderer.invoke('key:addr', path),

  // 钱包（加密 keystore）
  walletCreate: (req) => ipcRenderer.invoke('wallet:create', req),
  walletImport: (req) => ipcRenderer.invoke('wallet:import', req),
  walletOpen: (req) => ipcRenderer.invoke('wallet:open', req),
  walletPickFile: () => ipcRenderer.invoke('wallet:pickFile'),
  walletList: () => ipcRenderer.invoke('wallet:list'),
  walletLock: () => ipcRenderer.invoke('wallet:lock'),
  walletStatus: () => ipcRenderer.invoke('wallet:status'),
  walletRename: (req) => ipcRenderer.invoke('wallet:rename', req),
  walletDelete: (req) => ipcRenderer.invoke('wallet:delete', req),
  walletBalances: (req) => ipcRenderer.invoke('wallet:balances', req),
  walletExportKey: () => ipcRenderer.invoke('wallet:exportKey'),

  // 交易
  buildTx: (req) => ipcRenderer.invoke('tx:build', req),
  buildUnsigned: (req) => ipcRenderer.invoke('tx:buildUnsigned', req),
  signRaw: (req) => ipcRenderer.invoke('tx:signRaw', req),
  redeem: (req) => ipcRenderer.invoke('tx:redeem', req),
  redeemHacd: (req) => ipcRenderer.invoke('tx:redeemHacd', req),
  redeemBatch: (req) => ipcRenderer.invoke('tx:redeemBatch', req),
  hacdTransfer: (req) => ipcRenderer.invoke('tx:hacdTransfer', req),
  combo: (req) => ipcRenderer.invoke('tx:combo', req),
  broadcast: (req) => ipcRenderer.invoke('tx:broadcast', req),
  checkTx: (req) => ipcRenderer.invoke('tx:check', req),
  translateTx: (req) => ipcRenderer.invoke('tx:translate', req),

  // 资产 / 协议 / 管理员
  assetOverview: (req) => ipcRenderer.invoke('asset:overview', req),
  hacdDetails: (req) => ipcRenderer.invoke('hacd:details', req),
  protocolOverview: (req) => ipcRenderer.invoke('protocol:overview', req),
  adminProbe: (req) => ipcRenderer.invoke('admin:probe', req),
  // 清算模块（D51）
  liqSync: (req) => ipcRenderer.invoke('liq:sync', req),
  liqSnapshot: (req) => ipcRenderer.invoke('liq:snapshot', req),
  liqWatch: (req) => ipcRenderer.invoke('liq:watch', req),
  liqTreasury: (req) => ipcRenderer.invoke('liq:treasury', req),
  liqProbe: (req) => ipcRenderer.invoke('liq:probe', req),
  onLiqProgress: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('liq:progress', h); return () => ipcRenderer.removeListener('liq:progress', h); },
  contractCall: (req) => ipcRenderer.invoke('contract:call', req),

  // 通用
  httpGet: (req) => ipcRenderer.invoke('http:get', req),
  loadCfg: () => ipcRenderer.invoke('cfg:load'),
  saveCfg: (cfg) => ipcRenderer.invoke('cfg:save', cfg),
});
