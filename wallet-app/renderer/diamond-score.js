'use strict';
// HACD 5 维评分 —— Diamond_Analyzer v0.1.1 的 JS 移植（与预言机 hacds_oracle.py 逐行对齐）。
// 用途：本地算「预期 hacds」（Σ score × 10⁸），无需调预言机。
// 正确性：与预言机同输入必同输出；见 selftest 交叉验证。
//
// 依赖：无（纯算术/字符串/字典）。visual_gene 可由 life_gene 本地派生。

(function (root) {
  // ---- 常量表（拷贝自预言机 RULE_SCORES）----
  const RULE_SCORES = {
    "Square|01": 30, "Ellipse|02": 30, "Heart|03": 50, "Triangle|04": 20,
    "Teardrop|05": 30, "Circle|06": 30, "Rhombus|07": 20, "Hexagon|08": 20,
    "Pure": 250, "Sum four color": 200, "All 16 color": 200,
    "Sum five color": 100, "All 15 color": 100,
    "Sum six color": 50, "All 14 color": 30,
    "Left three pure": 20, "Left mix pure": 20, "Right three pure": 20,
    "Right mix pure": 20, "Color Symmetry": 20, "Half divide": 20, "Double mix": 20,
    "Sum seven color": 20, "darkColor": 20, "lightColor": 20,
    "Center color": 3, "Edge color": 3,
    "six repeat": 200, "Penta repeat": 50, "ABCABC": 20,
    "Two letters": 10, "Quadro repeat": 10, "AABCCD": 10, "ABBCDD": 10,
    "Symmetric letter": 10, "Three letters": 3, "Triple repeat": 2,
    "Tail seven": 200, "Tail six": 100, "Tail five": 50, "Repetition": 50,
    "Single num": 30, "Serial num": 25, "Tail four": 20, "Number Symmetry": 10,
    "Red cyan|A": 7, "Cyan|B": 6, "Secret|E": 1, "Pink|H": 8, "Red|I": 8,
    "Pink cyan|K": 8, "Yellow secret|M": 2, "Yellow Cyan|N": 6, "Green|S": 6,
    "Blue|T": 8, "Blue purple|U": 3, "Light pink|V": 8, "Dark blue|W": 3,
    "Grey|X": 5, "Red purple|Y": 3, "Gold|Z": 10,
    "darkColor|color": 20, "lightColor|color": 20,
  };
  // CLEAN_SCORES = 键去掉 "|" 后的部分
  const CLEAN_SCORES = {};
  for (const k of Object.keys(RULE_SCORES)) CLEAN_SCORES[k.split('|')[0]] = RULE_SCORES[k];

  const SHAPES_BY_HEX = {
    "01": "Square", "02": "Ellipse", "03": "Heart", "04": "Triangle",
    "05": "Teardrop", "06": "Circle", "07": "Rhombus", "08": "Hexagon",
  };
  const COLOR_BY_LETTER = {
    "A": "Red cyan", "B": "Cyan", "E": "Secret", "H": "Pink",
    "I": "Red", "K": "Pink cyan", "M": "Yellow secret", "N": "Yellow Cyan",
    "S": "Green", "T": "Blue", "U": "Blue purple", "V": "Light pink",
    "W": "Dark blue", "X": "Grey", "Y": "Red purple", "Z": "Gold",
  };
  const DIAMOND_NAME_VALID_CHARS = "WTYUIAHXVMEKBSZN";  // x16rs 字母表
  const COMMON = "Common diamond";

  // ---- 基因派生 ----
  function visualGeneHex(name, lifeGeneBytes) {
    if (name.length !== 6 || lifeGeneBytes.length !== 32)
      throw new Error("name must be 6 chars, life_gene 32 bytes");
    const gene = new Array(20).fill('0');
    for (let i = 0; i < 6; i++) {
      const idx = DIAMOND_NAME_VALID_CHARS.indexOf(name[i]);
      if (idx < 0) throw new Error("invalid diamond name char: " + name[i]);
      gene[i + 2] = idx.toString(16);
    }
    let o = 8;
    for (let i = 20; i < 31; i++) { gene[o] = (lifeGeneBytes[i] % 16).toString(16); o++; }
    const last = lifeGeneBytes[31].toString(16).padStart(2, '0');
    gene[0] = last[0]; gene[1] = last[1];
    return gene.join('');
  }

  // ---- 工具 ----
  const distinctChars = (s) => new Set(s).size;
  function maxRun(s) {
    let best = 1, cur = 1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] === s[i - 1]) { cur++; if (cur > best) best = cur; } else cur = 1;
    }
    return best;
  }
  function symmetry(s) {
    const mid = Math.floor(s.length / 2);
    if (!mid) return false;
    const front = s.slice(0, mid);
    const back = s.slice(-mid).split('').reverse().join('');
    return front === back;
  }
  function shunzi(num, cha) {
    for (let i = 0; i < num.length - 1; i++) {
      if (parseInt(num[i + 1]) - parseInt(num[i]) !== cha) return false;
    }
    return true;
  }
  function darkOrLight(style) {
    const dark = "01234", light = "56789abcdef";
    style = style.toLowerCase();
    let hasDark = false, hasLight = false;
    for (const ch of style) {
      if (dark.includes(ch)) hasDark = true;
      if (light.includes(ch)) hasLight = true;
      if (hasDark && hasLight) return "2";
    }
    if (hasDark) return "1";
    if (hasLight) return "0";
    return "2";
  }
  // 取最高分；等分并列时先出现者胜（对应 DA 的严格大于循环）
  function maxScoreFeature(feats) {
    if (!feats.length) return COMMON;
    let best = feats[0], bestScore = RULE_SCORES[best] || 0;
    for (let i = 1; i < feats.length; i++) {
      const sc = RULE_SCORES[feats[i]] || 0;
      if (sc > bestScore) { best = feats[i]; bestScore = sc; }  // 严格大于 → 先到者保留
    }
    return best;
  }

  // ---- 五维 ----
  function getShapes(vg) { return SHAPES_BY_HEX[vg.slice(0, 2)] || COMMON; }

  function getStyles(vg) {
    const style = vg.slice(2, 18);
    const t13 = style[12], t14 = style[13], t15 = style[14], t16 = style[15];
    const feats = [];
    if (t13 === t14 && t14 === t15 && t15 === t16) feats.push("Pure");
    else if (t14 === t15 && t15 === t13 && t14 !== t16) feats.push("Left three pure");
    else if (t13 === t15 && t15 === t16 && t14 !== t13) feats.push("Left mix pure");
    else if (t13 === t14 && t14 === t16 && t15 !== t13) feats.push("Right three pure");
    else if (t14 === t16 && t16 === t15 && t14 !== t13) feats.push("Right mix pure");
    else if (t16 === t15 && t13 === t14) feats.push("Color Symmetry");
    else if (t16 === t14 && t13 === t15) feats.push("Half divide");
    else if ((t15 + t13) === (t14 + t16)) feats.push("Double mix");   // 字符串拼接（与预言机一致；不能用 Number，'a'-'f' 会变 NaN）
    else if (t13 === t14 && t15 !== t16) feats.push("Center color");
    else if (t15 === t16 && t14 !== t13) feats.push("Edge color");
    const dc = distinctChars(style);
    if (dc === 4) feats.push("Sum four color");
    else if (dc === 5) feats.push("Sum five color");
    else if (dc === 6) feats.push("Sum six color");
    else if (dc === 7) feats.push("Sum seven color");
    else if (dc === 14) feats.push("All 14 color");
    else if (dc === 15) feats.push("All 15 color");
    else if (dc === 16) feats.push("All 16 color");
    const dl = darkOrLight(style);
    if (dl === "1") feats.push("darkColor");
    else if (dl === "0") feats.push("lightColor");
    return maxScoreFeature(feats);
  }

  function getColor(vg, name) {
    const style = vg.slice(2, 19);
    const feats = [];
    const key = COLOR_BY_LETTER[name[0]];
    if (key) feats.push(key);
    const dl = darkOrLight(style);
    if (dl === "1") feats.push("darkColor|color");
    if (dl === "0") feats.push("lightColor|color");
    const best = maxScoreFeature(feats);
    if (best === COMMON) return COMMON;
    return best.split('|')[0];
  }

  function getNameliteral(name) {
    const feats = [];
    const run = maxRun(name);
    if (run >= 3) {
      if (run === 6) feats.push("six repeat");
      else if (run === 5) feats.push("Penta repeat");
      else if (run === 4) feats.push("Quadro repeat");
      else if (run === 3) feats.push("Triple repeat");
    }
    const dc = distinctChars(name);
    if (dc === 2) feats.push("Two letters");
    else if (dc === 3) feats.push("Three letters");
    if (name.slice(0, 3) === name.slice(3, 6)) feats.push("ABCABC");
    if (symmetry(name)) feats.push("Symmetric letter");
    if (name[0] === name[1] && name[3] === name[4]) feats.push("AABCCD");
    if (name[1] === name[2] && name[4] === name[5]) feats.push("ABBCDD");
    return maxScoreFeature(feats);
  }

  function getNumberliteral(numberStr) {
    const feats = [];
    const n = parseInt(numberStr, 10);
    if (n < 10) feats.push("Single num");
    if (distinctChars(numberStr) === 1) feats.push("Repetition");
    if (shunzi(numberStr, 1) || shunzi(numberStr, -1)) feats.push("Serial num");
    if (symmetry(numberStr)) feats.push("Number Symmetry");
    const run = maxRun(numberStr);
    if (run >= 4) {
      if (run === 7) feats.push("Tail seven");
      else if (run === 6) feats.push("Tail six");
      else if (run === 5) feats.push("Tail five");
      else if (run === 4) feats.push("Tail four");
    }
    return maxScoreFeature(feats);
  }

  const cleanScore = (metricEn) => CLEAN_SCORES[metricEn] || 0;

  function analyse(name, number, visualGene) {
    const numberStr = String(number);
    const shapes = getShapes(visualGene);
    const stylesOrColor = (shapes === COMMON) ? getStyles(visualGene) : getColor(visualGene, name);
    const nameliteral = getNameliteral(name);
    const numberliteral = getNumberliteral(numberStr);
    let score = cleanScore(shapes) + cleanScore(stylesOrColor)
              + cleanScore(nameliteral) + cleanScore(numberliteral);
    score = Math.max(1, score);  // DA 下限：0 分抬 1
    return { shapes, styles_or_color: stylesOrColor, nameliteral, numberliteral, score };
  }

  root.DiamondScore = {
    RULE_SCORES, CLEAN_SCORES, SHAPES_BY_HEX, COLOR_BY_LETTER, COMMON,
    visualGeneHex, analyse,
    getShapes, getStyles, getColor, getNameliteral, getNumberliteral,
  };
})(typeof window !== 'undefined' ? window : globalThis);
