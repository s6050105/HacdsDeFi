/* ==========================================================================
   hacds.com — 极简 Markdown 渲染
   只覆盖白皮书用到的语法：标题、段落、列表、表格、代码、引用、粗体、行内码、链接、分隔线。
   不追求完整实现，避免引入第三方依赖。
   ========================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }

  function render(md) {
    const lines = String(md).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 空行
      if (!line.trim()) { i++; continue; }

      // 架构图 HTML 块（<!--ARCHFIG--> ... <!--/ARCHFIG-->）原样输出，不转义
      if (line.trim() === '<!--ARCHFIG-->') {
        i++;
        const buf = [];
        while (i < lines.length && lines[i].trim() !== '<!--/ARCHFIG-->') {
          buf.push(lines[i]);
          i++;
        }
        i++; // 跳过结束标记
        out.push('<div class="archfig-wrap">' + buf.join(String.fromCharCode(10)) + '</div>');
        continue;
      }

      // 代码块
      if (line.trim().startsWith('```')) {
        i++;
        const buf = [];
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          buf.push(lines[i]);
          i++;
        }
        i++; // 跳过结束 ```
        out.push('<pre class="code">' + esc(buf.join('\n')) + '</pre>');
        continue;
      }

      // 分隔线
      if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

      // 标题
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        const lv = h[1].length;
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 表格
      if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
        const head = line.split('|').slice(1, -1).map(x => x.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(lines[i].split('|').slice(1, -1).map(x => x.trim()));
          i++;
        }
        out.push('<table><thead><tr>' +
          head.map(x => '<th>' + inline(x) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(x => '<td>' + inline(x) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>');
        continue;
      }

      // 引用
      if (line.trim().startsWith('>')) {
        const buf = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>');
        continue;
      }

      // 无序列表
      if (/^\s*[-*+]\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        }
        out.push('<ul>' + buf.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>');
        continue;
      }

      // 有序列表
      if (/^\s*\d+\.\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        out.push('<ol>' + buf.map(x => '<li>' + inline(x) + '</li>').join('') + '</ol>');
        continue;
      }

      // 段落（连续非空行合并）
      const buf = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(#{1,4}\s|\s*[-*+]\s|\s*\d+\.\s|>|\||```|---+$)/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (buf.length) out.push('<p>' + inline(buf.join(' ')) + '</p>');
    }

    return out.join('\n');
  }

  window.MiniMD = { render };
})();
