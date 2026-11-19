/* =============================================================================
   gen_pdf.js —— 把 hacds.com/whitepaper/*.md 渲染成 A4 PDF

   为什么单独写一个：官网的 docview.js 是给浏览器用的（依赖 DOM 与事件），
   这里只需要「读 md → 生成一个自包含 html → printToPDF」。用 Electron 主进程
   跑，规格与之前手工生成的那批保持一致（A4、带页边距、深色文字）。

   用法：
     node_modules/.bin/electron tools/gen_pdf.js --out <目录> <md1> [md2 ...]

   只接受显式列出的 md 文件，不做通配 —— 生成 PDF 是重活，误跑一次会覆盖
   一堆文件，宁可多打几个参数。
   ========================================================================== */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// ---- 极简 Markdown → HTML（只覆盖这几份文档实际用到的语法） ----------------
// 不引第三方库：文档语法固定，自己写反而可控，也不用往仓库里塞依赖。
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  // ⚠ 顺序很关键：先把行内代码**摘出来**（此时还没转义），再对剩余文本转义。
  //   若先 esc() 再摘代码，代码里的 & < > 会被转义两次，PDF 里就会出现
  //   "&amp;lt;address&amp;gt;" 这种实体泄漏 —— 白皮书与 RPC 文档实测踩过。
  const code = [];
  let t = s.replace(/`([^`]+)`/g, (_, c) => {
    code.push(c);
    return '\u0000' + (code.length - 1) + '\u0000';
  });

  // 现在对纯文本部分转义
  t = esc(t);

  // 加粗：允许跨行（源文档里有 "**...\n...**" 的写法，否则星号会原样输出）
  t = t.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(?<![*\w])\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 放回行内代码（单独转义一次，避免代码内容注入 HTML）
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(code[+i]) + '</code>');
  return t;
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  let listType = null;

  const closeList = () => {
    if (listType) { out.push('</' + listType + '>'); listType = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^```/.test(line)) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // 表格：以 | 开头，且下一行是分隔行
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeList();
      const head = line.split('|').slice(1, -1).map(c => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map(c => c.trim()));
        i++;
      }
          // 列数多时（RPC 的函数表有 4 列）窄列会把 who:address 折成 who:addres/s。
      // 给每列设一个最小宽度，让浏览器按内容比例分配，而不是把某一列压到极限。
      const ncol = head.length;
      const minPct = ncol <= 2 ? 30 : ncol === 3 ? 16 : ncol === 4 ? 14 : 11;
      const cols = '<colgroup>' + head.map(() =>
        '<col style="min-width:' + minPct + '%">').join('') + '</colgroup>';
      out.push('<table>' + cols + '<thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>');
      continue;
    }

    // 标题
    let m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      closeList();
      const lv = m[1].length;
      out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>');
      i++; continue;
    }

    // 分隔线
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeList(); out.push('<hr>'); i++; continue;
    }

    // 引用块
    if (/^\s*>/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + mdToHtml(buf.join('\n')) + '</blockquote>');
      continue;
    }

    // 列表
    m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (m) {
      const ordered = /\d+\./.test(m[2]);
      const want = ordered ? 'ol' : 'ul';
      if (listType !== want) { closeList(); out.push('<' + want + '>'); listType = want; }
      // 源文档里有 "1. 1. 1." 这种手写编号（作者偷懒或后续插入未改序号），
      // 若原样输出会渲染成 1. 1. 1.。交给 <ol> 自动编号，一律丢弃手写数字。
      //
      // 续行：列表项常跨多行（Markdown 用缩进续写）。只取首行会截断内容，
      // 更糟的是加粗标记若开在首行、闭在续行，就会残留字面 "**" —— 白皮书
      // 附录 B 第 3 条实测如此。这里把后续缩进行并入同一项。
      const buf = [m[3]];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i]) &&
             !/^\s*([-*+]|\d+\.)\s/.test(lines[i])) {
        buf.push(lines[i].trim()); i++;
      }
      out.push('<li>' + inline(buf.join(' ')) + '</li>');
      continue;
    }

    // 空行
    if (/^\s*$/.test(line)) { closeList(); i++; continue; }

    // 普通段落（连续非空行合并）
    closeList();
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s|^\s*[|>]|^```|^\s*([-*+]|\d+\.)\s/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  closeList();
  return out.join('\n');
}

const CSS = `
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
body {
  font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif;
  font-size: 10.5pt; line-height: 1.75; color: #1b1b1f; margin: 0;
  -webkit-font-smoothing: antialiased;
}
h1 { font-size: 21pt; margin: 0 0 14pt; padding-bottom: 8pt;
     border-bottom: 2.5pt solid #1b1b1f; letter-spacing: .01em; }
h2 { font-size: 15pt; margin: 22pt 0 9pt; padding-left: 9pt;
     border-left: 4pt solid #c9982a; page-break-after: avoid; }
h3 { font-size: 12.5pt; margin: 16pt 0 7pt; page-break-after: avoid; }
h4 { font-size: 11pt; margin: 12pt 0 6pt; page-break-after: avoid; }
p  { margin: 7pt 0; text-align: justify; }
ul, ol { margin: 7pt 0 7pt 20pt; padding: 0; }
li { margin: 3pt 0; }
code {
  font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
  font-size: 9.2pt; background: #f2f2f5; padding: 1pt 3.5pt;
  border-radius: 2.5pt;
  /* ⚠ 原来是 break-all，会把 who:address 断成 who:addres / s，
     hacd_score_total 这类标识符在 RPC 文档里断了十几处。改为整词优先，
     只有实在放不下（超长路径/哈希）才断。 */
  word-break: normal;
  overflow-wrap: break-word;
}
pre {
  background: #f7f7fa; border: .6pt solid #e0e0e6; border-radius: 3pt;
  padding: 8pt 10pt; overflow-wrap: break-word; white-space: pre-wrap;
  page-break-inside: avoid; margin: 9pt 0;
}
pre code {
  background: none; padding: 0; font-size: 8.6pt; line-height: 1.5;
  /* 代码块允许长路径换行，否则会溢出页面 */
  word-break: break-all;
}
/* ⚠ 这里踩过一个坑，记下来免得后人重犯：
   原先写的是 overflow-wrap: anywhere。它的隐藏语义是「该元素的最小内容宽度
   算作 1 个字符」——于是 table-layout:auto 认为这一列可以压到任意窄，
   先把列压扁，再把 who:address 折成 who:addres / s。
   换成 break-word：只在真的放不下时才断，且**不影响**内在宽度计算，
   列宽会按完整标识符分配。 */
td code, th code {
  word-break: normal;
  overflow-wrap: break-word;
}
/* 按内容分配列宽（配合上面的 break-word，标识符列才拿得到足够宽度） */
table { table-layout: auto; }
th, td { hyphens: none; text-align: left; }
blockquote {
  margin: 9pt 0; padding: 7pt 12pt; background: #fdf8ec;
  border-left: 3pt solid #c9982a; color: #3a3a42;
}
blockquote p { margin: 3pt 0; }
table {
  border-collapse: collapse; width: 100%; margin: 9pt 0; font-size: 9.3pt;
  /* 整表禁止分页看着更整洁，但**长表格**（如附录的参数表）会被整块推到下一页，
     上一页剩一大块空白 —— 实测白皮书第 15 页就是这样整页空白的。
     所以只禁止「行内」断裂，让长表自然跨页。 */
  page-break-inside: auto;
}
/* 表头在跨页时重复，读者翻到下一页仍知道各列含义 */
thead { display: table-header-group; }
/* 单行不跨页断裂 */
tr { page-break-inside: avoid; break-inside: avoid; }
/* 空表格头保护：无 thead 的表仍按普通表格走 */
th, td { border: .6pt solid #d5d5dd; padding: 4.5pt 7pt; text-align: left; vertical-align: top; }
th { background: #f2f2f5; font-weight: 600; }
hr { border: 0; border-top: .8pt solid #dcdce4; margin: 16pt 0; }
a { color: #8a6512; text-decoration: none; word-break: break-all; }
strong { font-weight: 600; }
`;

async function main() {
  const argv = process.argv.slice(2);
  let outDir = null;
  const files = [];
  for (let k = 0; k < argv.length; k++) {
    if (argv[k] === '--out') { outDir = argv[++k]; }
    else files.push(argv[k]);
  }
  if (!outDir || files.length === 0) {
    console.error('用法: electron gen_pdf.js --out <目录> <md...>');
    app.exit(2); return;
  }
  // 一律转绝对路径：loadFile 传相对路径会相对**本脚本目录**解析，
  // 而 mkdir 用的是当前工作目录 —— 两者不一致时临时 html 会写到别处，
  // 报 ERR_FILE_NOT_FOUND，且错误信息里看不出是路径问题。
  outDir = path.resolve(outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, images: false },
  });

  for (const f of files) {
    if (!fs.existsSync(f)) { console.error('  [SKIP] 不存在: ' + f); continue; }
    const md = fs.readFileSync(f, 'utf8');
    const title = (md.match(/^#\s+(.+)$/m) || [null, path.basename(f, '.md')])[1];
    const html = '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">' +
      '<title>' + esc(title) + '</title><style>' + CSS + '</style></head><body>' +
      mdToHtml(md) + '</body></html>';

    const tmp = path.join(outDir, '.__tmp_' + path.basename(f, '.md') + '.html');
    fs.writeFileSync(tmp, html, 'utf8');
    await win.loadFile(tmp);

    const pdf = path.join(outDir, path.basename(f, '.md') + '.pdf');
    const buf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'default' },
      preferCSSPageSize: true,
    });
    fs.writeFileSync(pdf, buf);
    fs.unlinkSync(tmp);
    console.log('  [OK] ' + path.basename(pdf) + '  ' + buf.length + ' B');
  }

  win.destroy();
  app.exit(0);
}

app.disableHardwareAcceleration();
app.whenReady().then(main).catch(e => { console.error(e); app.exit(1); });
