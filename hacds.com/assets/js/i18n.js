/* ==========================================================================
   hacds.com — i18n
   zh / en / tr 三语。data-i18n="key" 自动替换；data-i18n-attr 处理属性。
   ========================================================================== */
(function () {
  'use strict';

  const I18N = {
    zh: {
      // 顶栏
      'nav.about': '简介',
      'nav.verify': '验证',
      'nav.features': '功能',
      'nav.docs': '文档',
      'nav.app': '进入应用',

      // 横幅
      'banner.mainnet': '<b>主网运行中</b> — 合约通过 Hacash 主网 HVM 部署，所有操作链上可验证。',
      'banner.testnet': '<b>新版合约待部署</b> — #3000 合约依赖 HVM 升级，当前展示的是合约规格，实际调用需等待部署完成。',

      // Hero
      'hero.badge': 'Hacash 主网 · 首个 DeFi 合约',
      'hero.title1': '把 HACD 的流动性',
      'hero.title2': '真正释放出来',
      'hero.sub': 'hacds 把钻石的评分变成可自由流通的链上资产。存入 HACD，铸造对应分数的 hacds，随时赎回。全程链上，无托管，可验证。',
      'hero.cta1': '进入应用',
      'hero.cta2': '查看白皮书',

      // 统计
      'stat.supply': '总供给',
      'stat.supply.sub': '按全网钻石均值铸造',
      'stat.contract': '合约地址',
      'stat.contract.sub': '不可升级 · 无自毁',
      'stat.serial': '资产 serial',
      'stat.serial.sub': '标准链上资产',
      'stat.decimal': '精度',
      'stat.decimal.sub': '0 位（1 atom = 1 hacds）',

      // 简介
      'about.eyebrow': '什么是 hacds',
      'about.title': '把钻石的评分，变成可以流通的资产',
      'about.desc': '每颗 HACD 都有一套 5 维评分。hacds 把这套评分映射成同质化代币——1 分换 1 个 hacds。存入钻石拿资产，取出资产换回钻石，中间还能做市、借贷。',
      'about.spec': '资产规格',
      'about.formula': '发行量怎么来的',
      'about.formula.desc': '总量不是拍脑袋定的，是从全网 HACD 的评分均值算出来的。任何人都能自己复算：',

      // 功能
      'feat.eyebrow': '核心功能',
      'feat.title': '一份合约，四件事',
      'feat.desc': '兑换做市、流动性提供、抵押借贷、协议金库，全部在同一个合约里，原子组合，无需跨合约调用。',

      'feat.swap.t': 'AMM 兑换',
      'feat.swap.d': '恒定乘积做市，0.5% 手续费。hacds 与 HAC 之间随时兑换，价格由池子决定，链上透明。',
      'feat.lp.t': '流动性挖矿',
      'feat.lp.d': '提供 hacds/HAC 双边流动性，按份额分取 80% 的交易手续费。随时撤出，附带滑点保护。',
      'feat.loan.t': '抵押借贷',
      'feat.loan.d': '存入 HACD 铸造的 hacds 可直接作为抵押品借出 HAC。50% LTV，160% 清算线，留出 20% 价格缓冲。',
      'feat.hacd.t': 'HACD 赎回',
      'feat.hacd.d': '随时把 hacds 换回 HACD。高分钻石加收溢价，防止有人挑走池子里的好货，保护全体持有人。',

      // 验证
      'verify.eyebrow': '可验证性',
      'verify.title': '每一笔都能自己算',
      'verify.desc': '这是本协议和上一版最大的区别：不要求你相信任何人，所有数字都可以独立复算。',
      'verify.run': '运行验证',
      'verify.running': '计算中…',
      'verify.result': '验证结果',
      'verify.sample': '样本颗数',
      'verify.avg': '平均评分',
      'verify.calc': '算出总量',
      'verify.onchain': '链上总量',
      'verify.match': '一致',
      'verify.mismatch': '不一致',
      'verify.fail': '无法连接节点，请稍后重试',
      'verify.contract': '合约源码',

      // 历史
      'history.eyebrow': '为什么重建',
      'history.title': '上一版失败了，这一版改了设计',
      'history.desc': '2024 年的铭文方案做完了，也上所了，但停牌了。我们不回避这段历史，因为它是这一版设计的直接原因。',

      'hist.v1.t': '把币刻在钻石上',
      'hist.v1.d': '持有 10000 个 hacds 意味着持有一批特定 HACD。转账要连钻石一起转，总额被钻石数量锁死，拆不开也拆不细。拆不开的东西当不了货币。',
      'hist.v2.t': '价格没有锚',
      'hist.v2.d': '发行比例靠社区投票，每类钻石值多少个 hacds 随时可能被改。交易所拿不到可复现的换算依据，做市商给不出稳定报价。',
      'hist.v3.t': '交易押在第三方',
      'hist.v3.d': '交易所是第三方插件，流通靠两家小所。所一停，链上再没有别的地方能交易——这是停牌的直接原因。',

      'hist.fix.t': '这一版只做了一件事：把币从钻石上拿下来',
      'hist.fix.d': 'hacds 变成标准链上资产，能自由拆分和转账。金融逻辑从插件搬进合约，流通靠链上 AMM，上所以后只是可选项，不再是活下去的前提。',

      // 上手
      'start.eyebrow': '开始使用',
      'start.title': '三步接入',
      'start.desc': '需要 Chrome 或 Firefox 浏览器，并安装 MoneyNex 插件钱包。',
      'start.s1.t': '安装钱包',
      'start.s1.d': '从 Chrome 商店或 GitHub 安装 MoneyNex。创建或导入钱包，保管好助记词。',
      'start.s2.t': '连接网站',
      'start.s2.d': '点击「连接钱包」，在插件里确认授权。网站只能看到你的地址，无法动用你的资产。',
      'start.s3.t': '开始操作',
      'start.s3.d': '每笔交易都在插件里确认签名后才广播。网站只负责构建交易体，私钥从不离开你的钱包。',
      'start.download': '下载 MoneyNex',

      // 风险
      'risk.title': '风险提示',
      'risk.1': '智能合约风险：合约不可升级，一旦发现漏洞无法修补。请只投入你可以承受损失的资金。',
      'risk.2': '价格风险：hacds 价格由 AMM 池子决定，可能剧烈波动。抵押借贷存在清算风险。',
      'risk.3': '评分风险：HACD 评分由链下计算、链上重算验证。评分算法若存在偏差，会影响发行量。',
      'risk.4': '流动性风险：池子较浅时，大额兑换会产生显著滑点，甚至无法成交。',

      // 页脚
      'footer.tagline': 'Hacash 主网上的去中心化资产协议',
      'footer.product': '产品',
      'footer.resource': '资源',
      'footer.legal': '法律',
      'footer.terms': '使用条款',
      'footer.privacy': '隐私政策',
      'footer.disclaimer': '免责声明：本网站仅提供技术信息与工具，不构成任何投资建议。加密货币投资具有高风险，请自行判断并承担后果。',

      // ---- App ----
      'nav.back': '返回首页',
      'app.connect': '连接钱包',
      'app.welcome': '连接你的钱包',
      'app.connectHint': '使用 MoneyNex 浏览器插件钱包。网站只负责构建交易，签名与广播都在你的钱包里完成。',
      'app.needWallet': '还没有安装？去 Chrome 商店安装 MoneyNex。',
      'app.account': '账户',
      'app.contractHacd': '合约池 HACD',
      'app.refresh': '刷新',
      'app.poolPrice': '池价',
      'app.poolHac': '池 HAC',
      'app.poolDs': '池 hacds',
      'app.lpTotal': 'LP 总量',
      'app.utilization': '利用率',
      'app.backing': '储备覆盖',
      'app.backingTip': '合约内部积分 ÷ 真实链上余额。≤100% 正常；>100% 说明有人凭空多了索取权，应告警。',
      'app.backingNa': '不可用',
      'app.tabSwap': '兑换',
      'app.tabLiquidity': '流动性',
      'app.tabLoan': '借贷',
      'app.tabHacd': 'HACD',
      'app.swap': '兑换',
      'app.from': '从',
      'app.to': '到',
      'app.minOut': '最少得到',
      'app.optional': '可选',
      'app.slippage': '滑点',
      'app.doSwap': '确认兑换',
      'app.swapInfo': '交易详情',
      'app.rate': '当前汇率',
      'app.fee': '手续费',
      'app.priceImpact': '价格影响',
      'app.minReceived': '预计最少得到',
      'app.swapNote': '兑换价格由 AMM 池子决定，大额交易会产生滑点。签名前请确认钱包显示的金额。',
      'app.addLiquidity': '添加流动性',
      'app.hacAmount': 'HAC 数量',
      'app.dsAmount': 'hacds 数量',
      'app.minShare': '最少份额',
      'app.myLiquidity': '我的流动性',
      'app.myShares': '我的份额',
      'app.pendingHac': '待领 HAC',
      'app.pendingDs': '待领 hacds',
      'app.harvest': '领取奖励',
      'app.removeLiquidity': '撤出流动性',
      'app.shareBurn': '撤出份额',
      'app.minHacOut': '最少 HAC',
      'app.minDsOut': '最少 hacds',
      'app.borrow': '借款',
      'app.repay': '还款',
      'app.myCollateral': '我的抵押',
      'app.myDebt': '我的债务',
      'app.myHealth': '健康度',
      'app.maxBorrow': '可借上限',
      'app.borrowAmount': '借款金额（HAC）',
      'app.repayAmount': '还款金额（HAC）',
      'app.collateral': '抵押品',
      'app.collAmount': '追加抵押（hacds）',
      'app.addCollateral': '追加抵押',
      'app.loanNote': '借款需要 HACD 铸造的 hacds 作为抵押。抵押率 50%，清算线 160%——价格下跌 20% 才会触发清算。',
      'app.hacdRedeem': 'HACD 赎回',
      'app.loadPool': '加载合约池',
      'app.hacdNote': '把 hacds 换回 HACD。高分钻石会加收溢价，防止从池子里挑走好货。',
      'app.redeemName': '钻石名',
      'app.redeemBtn': '赎回',
      'app.hacdMint': '存入 HACD',
      'app.mintNote': '把 HACD 存入合约，按评分铸造 hacds。1 分 = 1 亿个单位。',
      'app.decimalNote': 'hacds 的 decimal 为 0，1 个最小单位就是 1 个 hacds。分数按 1 分 = 1 亿定标，所以 1 分钻石会铸出 1 亿个 hacds —— 这是设计如此，不是错误。',
      'app.myHacd': '我的 HACD',
      'app.clickLoadMine': '点「加载合约池」上方按钮载入你的 HACD',
      'app.mintName': '钻石名',
      'app.mintEstimate': '预计铸出',
      'app.mintBtn': '存入铸造',
      'app.noHacd': '该地址没有 HACD',
      'app.poolHacdLabel': '合约池 HACD',
      'app.clickLoadPool': '点「加载」查看合约内的 HACD',
      'app.redeemCost': '预计消耗',
      'app.selNone': '未选择',
      'app.selCount': '已选 {n} 颗',
      'app.selAll': '全选',
      'app.selNone2': '清空',
      'app.loadMine': '载入',
      'app.selectedCount': '已选',
      'app.diamonds': '颗',
      'app.estMint': '预计铸出',
      'app.mintSplitNote': '合约限制每笔只能处理 1 颗，批量存入会自动拆成多笔交易，逐笔请求签名。',
      'app.pickFirst': '请先选择要存入的 HACD',
      'app.poolEmpty': '合约池内暂无 HACD',
      'app.minting': '存入中 {i}/{n}…',



    },

    en: {
      'nav.about': 'About',
      'nav.verify': 'Verify',
      'nav.features': 'Features',
      'nav.docs': 'Docs',
      'nav.app': 'Launch App',

      'banner.mainnet': '<b>Live on mainnet</b> — The contract is deployed on Hacash HVM. Every operation is verifiable on-chain.',
      'banner.testnet': '<b>New contract pending</b> — The #3000 contract requires an HVM upgrade. What you see is the contract spec; live calls need the deployment to complete.',

      'hero.badge': 'Hacash Mainnet · First DeFi Contract',
      'hero.title1': 'Unlock the liquidity',
      'hero.title2': 'of your HACDs',
      'hero.sub': 'hacds turns diamond scores into a freely transferable on-chain asset. Deposit a HACD, mint its score in hacds, redeem anytime. Fully on-chain, non-custodial, verifiable.',
      'hero.cta1': 'Launch App',
      'hero.cta2': 'Read Whitepaper',

      'stat.supply': 'Total Supply',
      'stat.supply.sub': 'Minted from global diamond average',
      'stat.contract': 'Contract',
      'stat.contract.sub': 'Not upgradeable · No self-destruct',
      'stat.serial': 'Asset Serial',
      'stat.serial.sub': 'Standard on-chain asset',
      'stat.decimal': 'Decimals',
      'stat.decimal.sub': '0 (1 atom = 1 hacds)',

      'about.eyebrow': 'What is hacds',
      'about.title': 'Turning diamond scores into a tradeable asset',
      'about.desc': 'Every HACD carries a 5-dimensional score. hacds maps that score to a fungible token — 1 point equals 1 hacds. Deposit diamonds for the asset, redeem the asset for diamonds, and use it for market making or lending in between.',
      'about.spec': 'Asset Spec',
      'about.formula': 'How supply is derived',
      'about.formula.desc': 'The total is not arbitrary — it comes from the average score of all HACDs on the network. Anyone can recompute it:',

      'feat.eyebrow': 'Core Features',
      'feat.title': 'One contract, four functions',
      'feat.desc': 'Swapping, liquidity provision, collateralized lending, and the protocol treasury — all in a single contract. Atomic composition, no cross-contract calls.',

      'feat.swap.t': 'AMM Swap',
      'feat.swap.d': 'Constant-product market making with 0.5% fee. Swap between hacds and HAC anytime; prices come from the pool and are transparent on-chain.',
      'feat.lp.t': 'Liquidity Mining',
      'feat.lp.d': 'Provide hacds/HAC liquidity and earn 80% of trading fees by share. Withdraw anytime with built-in slippage protection.',
      'feat.loan.t': 'Collateralized Lending',
      'feat.loan.d': 'hacds minted from deposited HACDs serve as collateral to borrow HAC. 50% LTV, 160% liquidation ratio, 20% price buffer.',
      'feat.hacd.t': 'HACD Redemption',
      'feat.hacd.d': 'Redeem hacds back to HACD anytime. Premium on high-score diamonds prevents cherry-picking and protects all holders.',

      'verify.eyebrow': 'Verifiability',
      'verify.title': 'Every number you can check yourself',
      'verify.desc': 'This is the biggest difference from the previous version: we do not ask you to trust anyone. Every figure can be independently recomputed.',
      'verify.run': 'Run Verification',
      'verify.running': 'Computing…',
      'verify.result': 'Verification Result',
      'verify.sample': 'Sample Size',
      'verify.avg': 'Average Score',
      'verify.calc': 'Computed Supply',
      'verify.onchain': 'On-chain Supply',
      'verify.match': 'Match',
      'verify.mismatch': 'Mismatch',
      'verify.fail': 'Cannot reach the node. Please retry later.',
      'verify.contract': 'Contract Source',

      'history.eyebrow': 'Why We Rebuilt',
      'history.title': 'The previous version failed. This one changed the design.',
      'history.desc': 'The 2024 inscription model shipped, got listed, and got suspended. We do not hide that history — it is the direct reason for this redesign.',

      'hist.v1.t': 'Currency inscribed on diamonds',
      'hist.v1.d': 'Holding 10,000 hacds meant holding a set of specific HACDs. Transfers moved diamonds with the token; supply was capped by diamond count and could not be split. Money that cannot be split is not money.',
      'hist.v2.t': 'No price anchor',
      'hist.v2.d': 'Issuance ratios were set by community vote and could change anytime. Exchanges had no reproducible basis, and market makers could not quote stably.',
      'hist.v3.t': 'Trading depended on third parties',
      'hist.v3.d': 'The exchange was a third-party plugin, and circulation relied on two small exchanges. When they halted, there was nowhere else to trade — the direct cause of suspension.',

      'hist.fix.t': 'This version did one thing: it took the currency off the diamonds',
      'hist.fix.d': 'hacds became a standard on-chain asset that splits and transfers freely. Financial logic moved from the plugin into the contract; circulation runs on an on-chain AMM, so listings are optional rather than existential.',

      'start.eyebrow': 'Get Started',
      'start.title': 'Three steps to connect',
      'start.desc': 'Requires Chrome or Firefox with the MoneyNex extension wallet installed.',
      'start.s1.t': 'Install the wallet',
      'start.s1.d': 'Install MoneyNex from the Chrome Store or GitHub. Create or import a wallet and back up your seed phrase.',
      'start.s2.t': 'Connect the site',
      'start.s2.d': 'Click "Connect Wallet" and approve in the extension. The site can only see your address — it cannot move your funds.',
      'start.s3.t': 'Start using',
      'start.s3.d': 'Every transaction is signed in the extension before broadcast. The site only builds transaction bodies; your private key never leaves your wallet.',
      'start.download': 'Download MoneyNex',

      'risk.title': 'Risk Disclosure',
      'risk.1': 'Smart contract risk: the contract is not upgradeable. A discovered bug cannot be patched. Only commit funds you can afford to lose.',
      'risk.2': 'Price risk: hacds price is set by the AMM pool and can be volatile. Collateralized borrowing carries liquidation risk.',
      'risk.3': 'Scoring risk: HACD scores are computed off-chain and re-verified on-chain. Errors in the scoring algorithm would affect supply.',
      'risk.4': 'Liquidity risk: when the pool is shallow, large swaps incur significant slippage or may not fill.',

      'footer.tagline': 'A decentralized asset protocol on Hacash mainnet',
      'footer.product': 'Product',
      'footer.resource': 'Resources',
      'footer.legal': 'Legal',
      'footer.terms': 'Terms',
      'footer.privacy': 'Privacy',
      'footer.disclaimer': 'Disclaimer: This site provides technical information and tools only. Nothing here is investment advice. Crypto assets carry high risk — do your own research and bear the consequences.',

      // ---- App ----
      'nav.back': 'Back',
      'app.connect': 'Connect Wallet',
      'app.welcome': 'Connect your wallet',
      'app.connectHint': 'Uses the MoneyNex browser extension. The site builds transactions only - signing and broadcasting happen inside your wallet.',
      'app.needWallet': 'Not installed yet? Get MoneyNex from the Chrome Store.',
      'app.account': 'Account',
      'app.contractHacd': 'Contract HACD',
      'app.refresh': 'Refresh',
      'app.poolPrice': 'Pool Price',
      'app.poolHac': 'Pool HAC',
      'app.poolDs': 'Pool hacds',
      'app.lpTotal': 'LP Total',
      'app.utilization': 'Utilization',
      'app.backing': 'Backing',
      'app.backingTip': 'Contract-side points / real on-chain balance. ≤100% is normal; >100% means someone gained unbacked claims.',
      'app.backingNa': 'n/a',
      'app.tabSwap': 'Swap',
      'app.tabLiquidity': 'Liquidity',
      'app.tabLoan': 'Lending',
      'app.tabHacd': 'HACD',
      'app.swap': 'Swap',
      'app.from': 'From',
      'app.to': 'To',
      'app.minOut': 'Min received',
      'app.optional': 'optional',
      'app.slippage': 'Slippage',
      'app.doSwap': 'Swap',
      'app.swapInfo': 'Details',
      'app.rate': 'Rate',
      'app.fee': 'Fee',
      'app.priceImpact': 'Price impact',
      'app.minReceived': 'Est. min received',
      'app.swapNote': 'Prices come from the AMM pool; large trades incur slippage. Confirm the amount shown in your wallet before signing.',
      'app.addLiquidity': 'Add Liquidity',
      'app.hacAmount': 'HAC amount',
      'app.dsAmount': 'hacds amount',
      'app.minShare': 'Min shares',
      'app.myLiquidity': 'My Liquidity',
      'app.myShares': 'My shares',
      'app.pendingHac': 'Pending HAC',
      'app.pendingDs': 'Pending hacds',
      'app.harvest': 'Harvest',
      'app.removeLiquidity': 'Remove Liquidity',
      'app.shareBurn': 'Shares to burn',
      'app.minHacOut': 'Min HAC',
      'app.minDsOut': 'Min hacds',
      'app.borrow': 'Borrow',
      'app.repay': 'Repay',
      'app.myCollateral': 'My collateral',
      'app.myDebt': 'My debt',
      'app.myHealth': 'Health',
      'app.maxBorrow': 'Max borrowable',
      'app.borrowAmount': 'Borrow amount (HAC)',
      'app.repayAmount': 'Repay amount (HAC)',
      'app.collateral': 'Collateral',
      'app.collAmount': 'Add collateral (hacds)',
      'app.addCollateral': 'Add Collateral',
      'app.loanNote': 'Borrowing requires hacds minted from HACDs as collateral. 50% LTV, 160% liquidation ratio - liquidation triggers only after a 20% price drop.',
      'app.hacdRedeem': 'HACD Redemption',
      'app.loadPool': 'Load Contract Pool',
      'app.hacdNote': 'Redeem hacds back to HACD. High-score diamonds carry a premium to prevent cherry-picking from the pool.',
      'app.redeemName': 'Diamond name',
      'app.redeemBtn': 'Redeem',
      'app.hacdMint': 'Deposit HACD',
      'app.mintNote': 'Deposit a HACD into the contract and mint hacds from its score. 1 point = 100,000,000 units.',
      'app.decimalNote': 'hacds has decimal 0, so 1 smallest unit is exactly 1 hacds. Scores are scaled at 1 point = 100M, so a 1-point diamond mints 100,000,000 hacds. This is by design, not an error.',
      'app.myHacd': 'My HACDs',
      'app.clickLoadMine': 'Click "Load Contract Pool" above to load your HACDs',
      'app.mintName': 'Diamond name',
      'app.mintEstimate': 'Est. mint',
      'app.mintBtn': 'Deposit & Mint',
      'app.noHacd': 'This address holds no HACD',
      'app.poolHacdLabel': 'Contract Pool',
      'app.clickLoadPool': 'Click "Load" to view HACDs in the contract',
      'app.redeemCost': 'Est. cost',
      'app.selNone': 'None selected',
      'app.selCount': '{n} selected',
      'app.selAll': 'Select all',
      'app.selNone2': 'Clear',
      'app.loadMine': 'Load',
      'app.selectedCount': 'Selected',
      'app.diamonds': 'diamonds',
      'app.estMint': 'Est. mint',
      'app.mintSplitNote': 'The contract processes only 1 HACD per transaction. Batch deposits are automatically split into multiple transactions, each requiring its own signature.',
      'app.pickFirst': 'Select the HACDs you want to deposit first',
      'app.poolEmpty': 'No HACD in the contract pool',
      'app.minting': 'Depositing {i}/{n}…',



    },

    tr: {
      'nav.about': 'Hakkinda',
      'nav.verify': 'Dogrula',
      'nav.features': 'Ozellikler',
      'nav.docs': 'Belgeler',
      'nav.app': 'Uygulamayi Ac',

      'banner.mainnet': '<b>Ana agda calisiyor</b> — Sozlesme Hacash HVM uzerinde yayinda. Her islem zincir uzerinde dogrulanabilir.',
      'banner.testnet': '<b>Yeni sozlesme bekleniyor</b> — #3000 sozlesmesi HVM yukseltmesi gerektirir. Gordugunuz sozlesme spesifikasyonudur; canli cagrilar yayin icin beklemelidir.',

      'hero.badge': 'Hacash Ana Ag · Ilk DeFi Sozlesmesi',
      'hero.title1': 'HACD likiditesini',
      'hero.title2': 'gercekten serbest birakin',
      'hero.sub': 'hacds, elmas puanlarini serbestce transfer edilebilir bir zincir varligina donusturur. HACD yatirin, puanini hacds olarak basın, dilediginiz zaman geri alin. Tamamen zincir uzerinde, saklamasiz, dogrulanabilir.',
      'hero.cta1': 'Uygulamayi Ac',
      'hero.cta2': 'Whitepaper',

      'stat.supply': 'Toplam Arz',
      'stat.supply.sub': 'Kuresel elmas ortalamasindan basildi',
      'stat.contract': 'Sozlesme',
      'stat.contract.sub': 'Yukseltilemez · Kendini imha edemez',
      'stat.serial': 'Varlik Serial',
      'stat.serial.sub': 'Standart zincir varligi',
      'stat.decimal': 'Ondalik',
      'stat.decimal.sub': '0 (1 atom = 1 hacds)',

      'about.eyebrow': 'hacds nedir',
      'about.title': 'Elmas puanlarini islem goren bir varliga donusturmek',
      'about.desc': 'Her HACD 5 boyutlu bir puana sahiptir. hacds bu puani esdeger bir tokena donusturur — 1 puan 1 hacds eder. Elmas yatirip varlik alin, varligi geri verip elmas alin; arada piyasa yapiciligi veya borclanma da yapabilirsiniz.',
      'about.spec': 'Varlik Ozellikleri',
      'about.formula': 'Arz nasil hesaplanir',
      'about.formula.desc': 'Toplam keyfi degildir — agdaki tum HACD puanlarinin ortalamasindan gelir. Herkes kendisi yeniden hesaplayabilir:',

      'feat.eyebrow': 'Temel Ozellikler',
      'feat.title': 'Tek sozlesme, dort islev',
      'feat.desc': 'Takas, likidite saglama, teminatli borclanma ve protokol hazinesi — hepsi tek sozlesmede. Atomik bilesim, sozlesmeler arasi cagri yok.',

      'feat.swap.t': 'AMM Takas',
      'feat.swap.d': 'Sabit carpim piyasa yapiciligi, %0.5 ucret. hacds ve HAC arasinda dilediginiz zaman takas yapin; fiyat havuzdan gelir ve zincir uzerinde seffaftir.',
      'feat.lp.t': 'Likidite Madenciligi',
      'feat.lp.d': 'hacds/HAC likiditesi saglayin, islem ucretlerinin %80ini payiniza gore kazanin. Kayma korumasiyla dilediginiz zaman cekin.',
      'feat.loan.t': 'Teminatli Borclanma',
      'feat.loan.d': 'Yatirilan HACDlerden basilan hacds teminat olarak kullanilip HAC borclanilabilir. %50 LTV, %160 tasfiye orani, %20 fiyat tamponu.',
      'feat.hacd.t': 'HACD Geri Alim',
      'feat.hacd.d': 'hacdsleri dilediginiz zaman HACDye cevirin. Yuksek puanli elmaslara prim uygulanir; bu, havuzdan iyi elmaslarin secilmesini onler ve tum sahipleri korur.',

      'verify.eyebrow': 'Dogrulanabilirlik',
      'verify.title': 'Her sayiyi kendiniz kontrol edebilirsiniz',
      'verify.desc': 'Onceki surumden en buyuk fark: kimseye guvenmenizi istemiyoruz. Her rakam bagimsiz olarak yeniden hesaplanabilir.',
      'verify.run': 'Dogrulamayi Calistir',
      'verify.running': 'Hesaplaniyor…',
      'verify.result': 'Dogrulama Sonucu',
      'verify.sample': 'Ornek Sayisi',
      'verify.avg': 'Ortalama Puan',
      'verify.calc': 'Hesaplanan Arz',
      'verify.onchain': 'Zincirdeki Arz',
      'verify.match': 'Eslesiyor',
      'verify.mismatch': 'Eslesmiyor',
      'verify.fail': 'Dugume ulasilamiyor. Lutfen sonra tekrar deneyin.',
      'verify.contract': 'Sozlesme Kaynagi',

      'history.eyebrow': 'Neden Yeniden Insa',
      'history.title': 'Onceki surum basarisiz oldu. Bu surum tasarimi degistirdi.',
      'history.desc': '2024 yazit modeli yayina girdi, listelendi ve durduruldu. Bu gecmisi saklamiyoruz — bu yeniden tasarimin dogrudan nedenidir.',

      'hist.v1.t': 'Elmaslara kazinmis para',
      'hist.v1.d': '10.000 hacds tutmak, belirli HACDler tutmak demekti. Transferler elmaslarla birlikte gidiyordu; arz elmas sayisiyla sinirliydi ve bolunemiyordu. Bolunemeyen sey para olamaz.',
      'hist.v2.t': 'Fiyat capasi yok',
      'hist.v2.d': 'Ihrac oranlari topluluk oylamasiyla belirleniyor ve her an degisebiliyordu. Borsalarin tekrarlanabilir bir dayanagi yoktu, piyasa yapicilar istikrarli fiyat veremiyordu.',
      'hist.v3.t': 'Ticaret ucuncu taraflara bagliydi',
      'hist.v3.d': 'Borsa ucuncu taraf bir eklentiydi ve dolasim iki kucuk borsaya bagliydi. Onlar durunca ticaret yapacak baska yer kalmadi — durdurulmanin dogrudan nedeni.',

      'hist.fix.t': 'Bu surum tek bir sey yapti: parayi elmaslardan ayirdi',
      'hist.fix.d': 'hacds, serbestce bolunup transfer edilebilen standart bir zincir varligi oldu. Finansal mantik eklentiden sozlesmeye tasindi; dolasim zincir uzerindeki AMM ile yuruyor, borsa listelemesi artik varolus sarti degil.',

      'start.eyebrow': 'Baslarken',
      'start.title': 'Baglanmak icin uc adim',
      'start.desc': 'Chrome veya Firefox ve MoneyNex eklenti cuzdani gereklidir.',
      'start.s1.t': 'Cuzdani kurun',
      'start.s1.d': 'MoneyNexi Chrome Store veya GitHubdan kurun. Cuzdan olusturun veya ice aktarin, kurtarma ifadenizi yedekleyin.',
      'start.s2.t': 'Siteye baglanin',
      'start.s2.d': '"Cuzdani Bagla"ya tiklayin ve eklentide onaylayin. Site yalnizca adresinizi gorebilir, fonlarinizi hareket ettiremez.',
      'start.s3.t': 'Kullanmaya baslayin',
      'start.s3.d': 'Her islem yayindan once eklentide imzalanir. Site yalnizca islem govdesi olusturur; ozel anahtariniz cuzdaninizdan cikmaz.',
      'start.download': 'MoneyNex Indir',

      'risk.title': 'Risk Bildirimi',
      'risk.1': 'Akilli sozlesme riski: sozlesme yukseltilemez. Bulunan bir hata yamalanamaz. Yalnizca kaybetmeyi goze alabileceginiz tutarlari yatirin.',
      'risk.2': 'Fiyat riski: hacds fiyati AMM havuzu tarafindan belirlenir ve dalgali olabilir. Teminatli borclanma tasfiye riski tasir.',
      'risk.3': 'Puanlama riski: HACD puanlari zincir disinda hesaplanip zincir uzerinde dogrulanir. Puanlama algoritmasindaki sapmalar arzi etkiler.',
      'risk.4': 'Likidite riski: havuz sig oldugunda buyuk takaslar belirgin kayma yaratir veya gerceklesmeyebilir.',

      'footer.tagline': 'Hacash ana aginda merkeziyetsiz bir varlik protokolu',
      'footer.product': 'Urun',
      'footer.resource': 'Kaynaklar',
      'footer.legal': 'Yasal',
      'footer.terms': 'Kosullar',
      'footer.privacy': 'Gizlilik',
      'footer.disclaimer': 'Yasal Uyari: Bu site yalnizca teknik bilgi ve arac sunar. Buradaki hicbir sey yatirim tavsiyesi degildir. Kripto varliklar yuksek risk tasir — kendi arastirmanizi yapin ve sonuclarina katlanin.',

      // ---- App ----
      'nav.back': 'Geri',
      'app.connect': 'Cuzdan Bagla',
      'app.welcome': 'Cuzdaninizi baglayin',
      'app.connectHint': 'MoneyNex tarayici eklentisini kullanir. Site yalnizca islem olusturur - imzalama ve yayin cuzdaninizda yapilir.',
      'app.needWallet': 'Henuz kurulu degil mi? MoneyNexi Chrome Storeden kurun.',
      'app.account': 'Hesap',
      'app.contractHacd': 'Sozlesme HACD',
      'app.refresh': 'Yenile',
      'app.poolPrice': 'Havuz Fiyati',
      'app.poolHac': 'Havuz HAC',
      'app.poolDs': 'Havuz hacds',
      'app.lpTotal': 'LP Toplam',
      'app.utilization': 'Kullanim',
      'app.backing': 'Karşılama',
      'app.backingTip': 'Kontrat içi puan / gerçek zincir bakiyesi. ≤%100 normal; >%100 karşılıksız talep var demektir.',
      'app.backingNa': 'yok',
      'app.tabSwap': 'Takas',
      'app.tabLiquidity': 'Likidite',
      'app.tabLoan': 'Borclanma',
      'app.tabHacd': 'HACD',
      'app.swap': 'Takas',
      'app.from': 'Kimden',
      'app.to': 'Kime',
      'app.minOut': 'Min alinan',
      'app.optional': 'istege bagli',
      'app.slippage': 'Kayma',
      'app.doSwap': 'Takas Yap',
      'app.swapInfo': 'Detaylar',
      'app.rate': 'Kur',
      'app.fee': 'Ucret',
      'app.priceImpact': 'Fiyat etkisi',
      'app.minReceived': 'Tahmini min alinan',
      'app.swapNote': 'Fiyatlar AMM havuzundan gelir; buyuk islemler kayma yaratir. Imzalamadan once cuzdaninizda gosterilen tutari dogrulayin.',
      'app.addLiquidity': 'Likidite Ekle',
      'app.hacAmount': 'HAC miktari',
      'app.dsAmount': 'hacds miktari',
      'app.minShare': 'Min pay',
      'app.myLiquidity': 'Likiditem',
      'app.myShares': 'Paylarim',
      'app.pendingHac': 'Bekleyen HAC',
      'app.pendingDs': 'Bekleyen hacds',
      'app.harvest': 'Odenekleri Al',
      'app.removeLiquidity': 'Likidite Cek',
      'app.shareBurn': 'Cekilecek pay',
      'app.minHacOut': 'Min HAC',
      'app.minDsOut': 'Min hacds',
      'app.borrow': 'Borclan',
      'app.repay': 'Geri Ode',
      'app.myCollateral': 'Teminatim',
      'app.myDebt': 'Borcum',
      'app.myHealth': 'Saglik',
      'app.maxBorrow': 'Maks borclanma',
      'app.borrowAmount': 'Borclanma miktari (HAC)',
      'app.repayAmount': 'Odeme miktari (HAC)',
      'app.collateral': 'Teminat',
      'app.collAmount': 'Teminat ekle (hacds)',
      'app.addCollateral': 'Teminat Ekle',
      'app.loanNote': 'Borclanma icin HACDlerden basilan hacds teminat gerekir. %50 LTV, %160 tasfiye orani - tasfiye ancak %20 fiyat dususunden sonra tetiklenir.',
      'app.hacdRedeem': 'HACD Geri Alim',
      'app.loadPool': 'Sozlesme Havuzunu Yukle',
      'app.hacdNote': 'hacdsleri HACDye geri cevirin. Yuksek puanli elmaslara prim uygulanir; bu havuzdan iyi elmas secilmesini onler.',
      'app.redeemName': 'Elmas adi',
      'app.redeemBtn': 'Geri Al',
      'app.hacdMint': 'HACD Yatir',
      'app.mintNote': 'Bir HACDyi sozlesmeye yatirin ve puanindan hacds basin. 1 puan = 100.000.000 birim.',
      'app.decimalNote': 'hacds ondaligi 0dir; yani en kucuk birim tam olarak 1 hacdstir. Puanlar 1 puan = 100 milyon olarak olceklenir, bu yuzden 1 puanlik bir elmas 100.000.000 hacds basar. Bu tasarim geregidir, hata degildir.',
      'app.myHacd': 'HACDlerim',
      'app.clickLoadMine': 'HACDlerinizi yuklemek icin yukaridaki "Sozlesme Havuzunu Yukle"ye tiklayin',
      'app.mintName': 'Elmas adi',
      'app.mintEstimate': 'Tahmini basim',
      'app.mintBtn': 'Yatir ve Bas',
      'app.noHacd': 'Bu adreste HACD yok',
      'app.poolHacdLabel': 'Sozlesme Havuzu',
      'app.clickLoadPool': 'Sozlesmedeki HACDleri gormek icin "Yukle"ye tiklayin',
      'app.redeemCost': 'Tahmini maliyet',
      'app.selNone': 'Secilmedi',
      'app.selCount': '{n} secili',
      'app.selAll': 'Tumunu sec',
      'app.selNone2': 'Temizle',
      'app.loadMine': 'Yukle',
      'app.selectedCount': 'Secili',
      'app.diamonds': 'elmas',
      'app.estMint': 'Tahmini basim',
      'app.mintSplitNote': 'Sozlesme islem basina yalnizca 1 HACD isler. Toplu yatirma otomatik olarak birden fazla isleme bolunur; her biri kendi imzasini gerektirir.',
      'app.pickFirst': 'Once yatirmak istediginiz HACDleri secin',
      'app.poolEmpty': 'Sozlesme havuzunda HACD yok',
      'app.minting': 'Yatiriliyor {i}/{n}…',



    },
  };

  const LANGS = ['zh', 'en', 'tr'];
  const STORE_KEY = 'hacds.lang';

  function detect() {
    // 默认英文：仅当用户主动切换过才沿用其选择。
    // 不再跟随浏览器语言——hacds 的用户面以英文为主，中文/土耳其语靠手动切换。
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && LANGS.includes(saved)) return saved;
    return 'en';
  }

  let current = detect();

  function t(key) {
    return (I18N[current] && I18N[current][key]) || (I18N.en[key]) || key;
  }

  /** 应用翻译到 DOM */
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      const v = t(k);
      // 允许少量内联标签（如 <b>）
      if (v.indexOf('<') >= 0) el.innerHTML = v;
      else el.textContent = v;
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const spec = el.getAttribute('data-i18n-attr'); // "placeholder:key"
      const i = spec.indexOf(':');
      if (i < 0) return;
      const attr = spec.slice(0, i), k = spec.slice(i + 1);
      el.setAttribute(attr, t(k));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    document.documentElement.lang = current === 'zh' ? 'zh-CN' : current;
  }

  function setLang(lang) {
    if (!LANGS.includes(lang)) return;
    current = lang;
    localStorage.setItem(STORE_KEY, lang);
    apply();
    document.querySelectorAll('.lang button').forEach(b => {
      b.classList.toggle('on', b.dataset.lang === lang);
    });
    window.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
  }

  function init() {
    apply();
    document.querySelectorAll('.lang button').forEach(b => {
      b.classList.toggle('on', b.dataset.lang === current);
      b.addEventListener('click', () => setLang(b.dataset.lang));
    });
  }

  window.I18N = { t, apply, setLang, init, get lang() { return current; }, langs: LANGS };
})();
