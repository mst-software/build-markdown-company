#!/usr/bin/env node
// md2pdf (MST Software): Markdown -> PDF có trang bìa + logo, dùng Chrome/Edge có sẵn
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const MarkdownIt = require('markdown-it');
const anchor = require('markdown-it-anchor');
const hljs = require('highlight.js');
const puppeteer = require('puppeteer-core');
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString, PDFNumber } = require('pdf-lib');

const COMPANY = 'MST Software';
const LOGO = path.join(__dirname, '..', 'assets', 'logo.png');

function usage() {
  console.log(`Cách dùng: node md2pdf.js <file.md> [file2.md ...] [tuỳ chọn]

  -o, --output <file.pdf>   Tên file xuất (chỉ khi có 1 file đầu vào)
  --toc                     Thêm mục lục
  --no-cover                Bỏ trang bìa
  --no-numbering            Không đánh số tiêu đề (01, 1.1, ...)
  --author <tên>            Tác giả hiện trên trang bìa
  --subtitle <text>         Dòng phụ dưới tiêu đề trên trang bìa
  --kicker <text>           Nhãn nhỏ phía trên tiêu đề bìa (mặc định "Tài liệu")
  --company <tên>           Tên công ty (mặc định "${COMPANY}")
  --logo <file.png>         Dùng logo khác
  --format <A4|Letter>      Khổ giấy (mặc định A4)
  --css <file.css>          CSS tuỳ chỉnh thêm vào
  --no-page-numbers         Không hiện số trang
  -h, --help                Trợ giúp`);
}

function parseArgs(argv) {
  const o = { inputs: [], format: 'A4', toc: false, cover: true, numbering: true, pageNumbers: true, company: COMPANY, logo: LOGO };
  const val = (i) => { if (i >= argv.length) { console.error('Thiếu giá trị cho ' + argv[i - 1]); process.exit(1); } return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-o' || a === '--output') o.output = val(++i);
    else if (a === '--toc') o.toc = true;
    else if (a === '--no-cover') o.cover = false;
    else if (a === '--no-numbering') o.numbering = false;
    else if (a === '--author') o.author = val(++i);
    else if (a === '--subtitle') o.subtitle = val(++i);
    else if (a === '--kicker') o.kicker = val(++i);
    else if (a === '--company') o.company = val(++i);
    else if (a === '--logo') o.logo = val(++i);
    else if (a === '--format') o.format = val(++i);
    else if (a === '--css') o.css = val(++i);
    else if (a === '--no-page-numbers') o.pageNumbers = false;
    else if (a.startsWith('-')) { console.error('Tuỳ chọn không hợp lệ: ' + a); process.exit(1); }
    else o.inputs.push(a);
  }
  return o;
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Không tìm thấy Chrome/Edge. Đặt biến môi trường CHROME_PATH trỏ tới trình duyệt.');
  return found;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildMd(baseDir) {
  const md = new MarkdownIt({
    html: true, linkify: true, typographer: true,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch {}
      }
      return esc(code);
    },
  });
  md.use(anchor, { slugify: slug });
  md.use(calloutPlugin);
  md.use(require('markdown-it-task-lists'), { enabled: false });
  md.use(require('markdown-it-footnote'));

  // ```mermaid -> <pre class="mermaid">
  const defFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, ...rest) => {
    const t = tokens[idx];
    if (t.info.trim() === 'mermaid') return `<pre class="mermaid">${esc(t.content)}</pre>\n`;
    return defFence(tokens, idx, ...rest);
  };
  // ảnh "/image/a.png" -> thử tìm theo thư mục chứa file .md
  const defImg = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, ...rest) => {
    const src = tokens[idx].attrGet('src') || '';
    if (src.startsWith('/') && !src.startsWith('//')) {
      const local = path.join(baseDir, src);
      if (fs.existsSync(local)) tokens[idx].attrSet('src', pathToFileURL(local).href);
    }
    return defImg(tokens, idx, ...rest);
  };
  return md;
}


const slug = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
  .trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'muc';

// ---------- front-matter (--- key: value ---) ----------
function parseFrontMatter(src) {
  const m = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: {}, text: src };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (k) fm[k[1].toLowerCase()] = k[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { fm, text: src.slice(m[0].length) };
}
const isTrue = (v) => /^(true|yes|on|1)$/i.test(String(v));
const isFalse = (v) => /^(false|no|off|0)$/i.test(String(v));

// ---------- hộp lưu ý: > [!NOTE] ... ----------
const CALLOUTS = {
  note: ['Ghi chú', 'i'], tip: ['Mẹo', '✓'], important: ['Quan trọng', '!'],
  warning: ['Cảnh báo', '!'], caution: ['Nguy hiểm', '×'],
};
function calloutPlugin(md) {
  md.core.ruler.push('callout', (state) => {
    const t = state.tokens;
    for (let i = 0; i < t.length; i++) {
      if (t[i].type !== 'blockquote_open') continue;
      const p = t[i + 1], inl = t[i + 2];
      if (!p || p.type !== 'paragraph_open' || !inl || inl.type !== 'inline') continue;
      const m = inl.content.match(/^\[!(\w+)\]/);
      const def = m && CALLOUTS[m[1].toLowerCase()];
      if (!def) continue;
      const kind = m[1].toLowerCase();
      const c = inl.children;
      if (c[0] && c[0].type === 'text') { c[0].content = c[0].content.replace(/^\[!\w+\][ \t]*/, ''); if (!c[0].content) c.shift(); }
      if (c[0] && c[0].type === 'softbreak') c.shift();
      t[i].attrJoin('class', `callout callout-${kind}`);
      const h = new state.Token('html_block', '', 0);
      h.content = `<div class="callout-title"><span class="ci">${def[1]}</span>${def[0]}</div>\n`;
      t.splice(i + 1, 0, h);
    }
  });
}

// ---------- bảng: căn phải cột số, tô màu cột mức độ ----------
const NUM_RE = /^[~≈≤≥<>+\-–−]?\s*\d[\d.,\s]*(?:%|đ|₫|\$|usd|vnd|k|m|tr|ms|s|gb|mb|x)?$/i;
function levelOf(text) {
  if (text.length > 26) return null;
  if (/^(rất )?cao|^high|^nghiêm trọng|^critical/i.test(text) && !/trung bình/i.test(text)) return 'high';
  if (/trung bình|^medium|^vừa/i.test(text)) return 'mid';
  if (/^thấp|^low|^nhẹ/i.test(text)) return 'low';
  return null;
}
function enhanceTables(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'table_open') continue;
    let end = i;
    while (tokens[end].type !== 'table_close') end++;
    const cols = [];
    let col = 0;
    for (let k = i; k < end; k++) {
      const tk = tokens[k];
      if (tk.type === 'tr_open') col = 0;
      else if (tk.type === 'th_open' || tk.type === 'td_open') {
        (cols[col] = cols[col] || []).push({ open: tk, inl: tokens[k + 1], head: tk.type === 'th_open' });
        col++;
      }
    }
    for (const cells of cols) {
      const body = cells.filter((c) => !c.head);
      if (!body.length) continue;
      if (body.filter((c) => NUM_RE.test(c.inl.content.trim())).length / body.length >= 0.8) {
        cells.forEach((c) => c.open.attrJoin('class', 'num'));
        continue;
      }
      const lv = body.map((c) => levelOf(c.inl.content.trim()));
      if (lv.filter(Boolean).length / body.length >= 0.6) {
        body.forEach((c, n) => lv[n] && c.open.attrJoin('class', `lv lv-${lv[n]}`));
      }
    }
    i = end;
  }
}


// ---------- chú thích hình / bảng / sơ đồ (tự đánh số) ----------
//  Hình:  ![Chú thích](duong-dan.png)  đứng một mình trên một dòng   -> "Hình N. Chú thích" (dưới hình)
//  Sơ đồ: khối ```mermaid, ngay dưới là dòng "Hình: Chú thích"        -> "Hình N. Chú thích" (dưới sơ đồ)
//  Bảng:  ngay dưới bảng là dòng "Bảng: Chú thích"                    -> "Bảng N. Chú thích" (trên bảng)
const FIG_CAP_RE = /^(?:Hình|Hinh|Figure|Fig)\s*[:.]\s*([\s\S]+)$/i;
const TAB_CAP_RE = /^(?:Bảng|Bang|Table)\s*:\s*([\s\S]+)$/i;
function addCaptions(tokens, md) {
  const T = tokens[0] && tokens[0].constructor;
  if (!T) return;
  const html = (c) => { const t = new T('html_block', '', 0); t.content = c; return t; };
  const capHtml = (md, s) => md.renderInline(s);
  let fig = 0, tab = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    // ảnh đứng một mình
    if (tk.type === 'paragraph_open') {
      const inl = tokens[i + 1], close = tokens[i + 2];
      const kids = inl && inl.children;
      if (kids && kids.length === 1 && kids[0].type === 'image' && close && close.type === 'paragraph_close') {
        const alt = (kids[0].content || '').trim();
        let cap = '';
        if (alt) { fig++; cap = `<figcaption><span class="lbl">Hình ${fig}.</span> ${capHtml(md, alt)}</figcaption>`; }
        tokens[i] = html('<figure class="fig">\n');
        tokens[i + 2] = html(`${cap}</figure>\n`);
        i += 2;
        continue;
      }
    }
    // sơ đồ mermaid + "Hình: ..."
    if (tk.type === 'fence' && tk.info.trim() === 'mermaid') {
      const po = tokens[i + 1], inl = tokens[i + 2], pc = tokens[i + 3];
      const m = po && po.type === 'paragraph_open' && inl && inl.type === 'inline' && pc && pc.type === 'paragraph_close' && inl.content.trim().match(FIG_CAP_RE);
      if (m) {
        fig++;
        tokens.splice(i + 1, 3, html(`<figcaption><span class="lbl">Hình ${fig}.</span> ${capHtml(md, m[1].trim())}</figcaption></figure>\n`));
        tokens.splice(i, 0, html('<figure class="fig">\n'));
        i += 2;
      }
      continue;
    }
    // bảng + "Bảng: ..."
    if (tk.type === 'table_open') {
      let end = i;
      while (tokens[end].type !== 'table_close') end++;
      const po = tokens[end + 1], inl = tokens[end + 2], pc = tokens[end + 3];
      const m = po && po.type === 'paragraph_open' && inl && inl.type === 'inline' && pc && pc.type === 'paragraph_close' && inl.content.trim().match(TAB_CAP_RE);
      if (m) {
        tab++;
        tokens.splice(end + 1, 3);
        tokens.splice(i, 0, html(`<div class="tcap"><span class="lbl">Bảng ${tab}.</span> ${capHtml(md, m[1].trim())}</div>\n`));
        i = end + 1;
      } else i = end;
    }
  }
}

// ---------- đánh số tiêu đề (## -> 01, ### -> 1.1, #### -> 1.1.1) ----------
function numberHeadings(tokens, enabled) {
  const cnt = [0, 0, 0];
  const items = [];
  tokens.forEach((t, i) => {
    if (t.type !== 'heading_open') return;
    const lv = +t.tag[1];
    if (lv < 2 || lv > 4) return;
    const idx = lv - 2;
    cnt[idx]++;
    for (let k = idx + 1; k < 3; k++) cnt[k] = 0;
    const num = lv === 2 ? String(cnt[0]).padStart(2, '0') : cnt.slice(0, idx + 1).join('.');
    const inl = tokens[i + 1];
    if (enabled) {
      const span = new t.constructor('html_inline', '', 0);
      span.content = `<span class="num">${num}</span>`;
      inl.children.unshift(span);
    }
    if (lv <= 3) items.push({ level: lv, id: t.attrGet('id'), text: inl.content, num });
  });
  return items;
}

function buildToc(items, pages, numbering) {
  if (!items.length) return '';
  const lis = items.map((x) => `<li class="l${x.level}"><a href="#${x.id}"><span class="t">${numbering ? `<span class="n">${x.num}</span>` : ''}${esc(x.text)}</span><span class="dots"></span><span class="pg">${pages ? (pages[x.id] ?? '') : '00'}</span></a></li>`).join('');
  return `<nav class="toc"><div class="toc-title">Mục lục</div><ul>${lis}</ul></nav>`;
}

function buildInfo(fm, o, dateStr) {
  const status = fm.status
    ? `<span class="st ${/nháp|draft/i.test(fm.status) ? 'st-draft' : /duyệt|chính thức|final|approved|hoàn/i.test(fm.status) ? 'st-final' : 'st-other'}">${esc(fm.status)}</span>` : '';
  const rows = [['Phiên bản', fm.version && esc(fm.version)], ['Trạng thái', status], ['Ngày', esc(dateStr)],
    ['Tác giả', o.author && esc(o.author)], ['Người duyệt', fm.reviewer && esc(fm.reviewer)], ['Đơn vị', esc(o.company)]].filter((r) => r[1]);
  return `<section class="docinfo"><div class="docinfo-title">Thông tin tài liệu</div><dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`;
}

// Chrome xuất link nội bộ dạng "named destination"; pdf-lib không mang theo khi ghép trang.
// Hàm này đổi chúng thành link trỏ thẳng tới trang (explicit destination) để bấm được.
function nameKey(o) {
  if (o instanceof PDFName) return o.decodeText();
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  return null;
}
function collectNamedDests(doc) {
  const ctx = doc.context;
  const map = new Map();
  const put = (k, v) => {
    v = ctx.lookup(v);
    if (v instanceof PDFDict) v = ctx.lookup(v.get(PDFName.of('D')));
    if (v instanceof PDFArray && k != null) map.set(k, v);
  };
  const walk = (node) => {
    node = ctx.lookup(node);
    if (!(node instanceof PDFDict)) return;
    const names = ctx.lookup(node.get(PDFName.of('Names')));
    if (names instanceof PDFArray) for (let i = 0; i + 1 < names.size(); i += 2) put(nameKey(names.get(i)), names.get(i + 1));
    const kids = ctx.lookup(node.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) walk(kids.get(i));
  };
  const cat = doc.catalog;
  const dests = ctx.lookup(cat.get(PDFName.of('Dests')));
  if (dests instanceof PDFDict) for (const [k, v] of dests.entries()) put(k.decodeText(), v);
  const names = ctx.lookup(cat.get(PDFName.of('Names')));
  if (names instanceof PDFDict) walk(names.get(PDFName.of('Dests')));
  return map;
}
function pageIndexOf(doc, ref) {
  return doc.getPages().findIndex((p) => p.ref === ref || (p.ref.objectNumber === ref.objectNumber && p.ref.generationNumber === ref.generationNumber));
}
async function headingPages(bytes, items) {
  const doc = await PDFDocument.load(bytes);
  const dests = collectNamedDests(doc);
  const pages = {};
  for (const x of items) {
    const arr = dests.get(x.id);
    const pi = arr ? pageIndexOf(doc, arr.get(0)) : -1;
    if (pi >= 0) pages[x.id] = pi + 1;
  }
  return pages;
}
function fixInternalLinks(srcDoc, merged, offset) {
  const ctx = srcDoc.context;
  const dests = collectNamedDests(srcDoc);
  srcDoc.getPages().forEach((srcPage, i) => {
    const annots = ctx.lookup(srcPage.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) return;
    const dstPage = merged.getPage(offset + i);
    const dAnnots = merged.context.lookup(dstPage.node.get(PDFName.of('Annots')));
    if (!(dAnnots instanceof PDFArray)) return;
    for (let n = 0; n < annots.size(); n++) {
      const sa = ctx.lookup(annots.get(n));
      const da = merged.context.lookup(dAnnots.get(n));
      if (!(sa instanceof PDFDict) || !(da instanceof PDFDict)) continue;
      let key = nameKey(sa.get(PDFName.of('Dest')));
      const act = ctx.lookup(sa.get(PDFName.of('A')));
      if (key == null && act instanceof PDFDict && ctx.lookup(act.get(PDFName.of('S'))) === PDFName.of('GoTo')) key = nameKey(act.get(PDFName.of('D')));
      const arr = key != null ? dests.get(key) : null;
      if (!arr) continue;
      const target = pageIndexOf(srcDoc, arr.get(0));
      if (target < 0) continue;
      const rest = [];
      for (let k = 1; k < arr.size(); k++) rest.push(arr.get(k));
      da.delete(PDFName.of('A'));
      da.set(PDFName.of('Dest'), merged.context.obj([merged.getPage(offset + target).ref, ...(rest.length ? rest : [PDFName.of('Fit')])]));
    }
  });
}

function dataUri(file) {
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

async function renderPdf(browser, htmlFile, pdfOpts, withMermaid) {
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle0', timeout: 60000 });
    if (withMermaid && (await page.$('pre.mermaid'))) {
      await page.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') });
      await page.evaluate(async () => {
        mermaid.initialize({
          startOnLoad: false, theme: 'base',
          themeVariables: { primaryColor: '#eaf1ff', primaryBorderColor: '#0066ff', primaryTextColor: '#141414', lineColor: '#0066ff', fontFamily: 'Segoe UI, Arial, sans-serif' },
        });
        await mermaid.run({ querySelector: 'pre.mermaid' });
      });
    }
    await page.evaluateHandle('document.fonts.ready');
    return await page.pdf(pdfOpts);
  } finally {
    await page.close();
  }
}

async function convert(browser, input, baseOpts) {
  const opts = { ...baseOpts };
  const abs = path.resolve(input);
  const dir = path.dirname(abs);
  const raw = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
  const { fm, text: src } = parseFrontMatter(raw);
  // CLI > front-matter > mặc định
  for (const k of ['author', 'subtitle', 'kicker']) if (fm[k] && !baseOpts[k]) opts[k] = fm[k];
  if (fm.company && baseOpts.company === COMPANY) opts.company = fm.company;
  if (fm.toc !== undefined && !baseOpts.toc) opts.toc = isTrue(fm.toc);
  if (fm.numbering !== undefined && isFalse(fm.numbering)) opts.numbering = false;
  if (fm.cover !== undefined && isFalse(fm.cover)) opts.cover = false;
  const dateStr = fm.date || fmtDate(new Date());

  const md = buildMd(dir);
  const env = {};
  const tokens = md.parse(src, env);

  // Tiêu đề = front-matter title, hoặc H1 đầu tiên
  const h1i = tokens.findIndex((t) => t.type === 'heading_open' && t.tag === 'h1');
  const title = fm.title || (h1i >= 0 ? tokens[h1i + 1].content : path.basename(abs, path.extname(abs)));
  if (opts.cover && h1i >= 0) tokens.splice(h1i, 3); // bỏ H1 khỏi nội dung vì đã nằm trên bìa

  enhanceTables(tokens);
  addCaptions(tokens, md);
  const items = numberHeadings(tokens, opts.numbering);
  const showInfo = fm.version || fm.status || fm.reviewer || isTrue(fm.info);
  const rendered = md.renderer.render(tokens, md.options, env);
  const infoHtml = showInfo ? buildInfo(fm, opts, dateStr) : '';
  const makeBody = (pages) => infoHtml + (opts.toc ? buildToc(items, pages, opts.numbering) : '') + rendered;
  const body = makeBody(null);

  let css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  if (opts.css) css += '\n' + fs.readFileSync(opts.css, 'utf8');
  const logo = dataUri(opts.logo);
  const base = `<base href="${pathToFileURL(dir).href}/">`;
  const wrap = (inner) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${inner}</body></html>`;

  const tmpBody = path.join(dir, `.~${path.basename(abs)}.body.html`);
  const tmpCover = path.join(dir, `.~${path.basename(abs)}.cover.html`);
  const out = opts.output && opts.inputs.length === 1 ? path.resolve(opts.output) : abs.replace(/\.(md|markdown)$/i, '') + '.pdf';
  const pageBase = { format: opts.format, printBackground: true };

  try {
    fs.writeFileSync(tmpBody, wrap(body), 'utf8');
    const hf = 'width:100%;margin:0 22mm;font-family:Segoe UI,Arial,sans-serif;font-size:8px;color:#6b7788;display:flex;justify-content:space-between;align-items:center;';
    const grad = 'height:2px;background:linear-gradient(90deg,#0066ff,#00c8ff,rgba(0,200,255,0));';
    const headerTpl = `<div style="width:100%;margin:0 22mm;font-family:Segoe UI,Arial,sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:6px;font-size:8px;color:#6b7788;">
        <img src="${logo}" style="height:8mm;"/><span style="max-width:60%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;letter-spacing:.06em;text-transform:uppercase;">${esc(title)}</span></div>
        <div style="${grad}"></div></div>`;
    const footerTpl = `<div style="width:100%;margin:0 22mm;font-family:Segoe UI,Arial,sans-serif;">
        <div style="${grad}"></div>
        <div style="${hf.replace('margin:0 22mm;','width:100%;')}padding-top:6px;"><span style="letter-spacing:.06em;">${esc(opts.company)}</span>${opts.pageNumbers ? '<span style="font-weight:700;color:#0066ff;"><span class="pageNumber"></span> <span style="color:#9aa5b5;font-weight:400;">/ <span class="totalPages"></span></span></span>' : ''}</div></div>`;
    const bodyPdfOpts = {
      ...pageBase,
      margin: { top: '28mm', bottom: '22mm', left: '22mm', right: '22mm' },
      displayHeaderFooter: true, headerTemplate: headerTpl, footerTemplate: footerTpl,
    };
    let bodyBytes = await renderPdf(browser, tmpBody, bodyPdfOpts, true);
    if (opts.toc && items.length) {
      // lượt 2: biết mỗi mục nằm ở trang nào -> điền số trang vào mục lục (bố cục không đổi nên số trang vẫn đúng)
      const pages = await headingPages(bodyBytes, items);
      fs.writeFileSync(tmpBody, wrap(makeBody(pages)), 'utf8');
      bodyBytes = await renderPdf(browser, tmpBody, bodyPdfOpts, true);
    }

    let finalBytes = bodyBytes;
    if (opts.cover) {
      const meta = [
        opts.author ? `<div><small>Tác giả</small><b>${esc(opts.author)}</b></div>` : '',
        fm.version ? `<div><small>Phiên bản</small><b>${esc(fm.version)}</b></div>` : '',
        `<div><small>Ngày</small><b>${esc(dateStr)}</b></div>`,
        `<div><small>Đơn vị</small><b>${esc(opts.company)}</b></div>`,
      ].join('');
      fs.writeFileSync(tmpCover, wrap(`<section class="cover">
        <i class="px d"></i><i class="px a"></i><i class="px b"></i><i class="px c"></i><i class="px e"></i>
        <img class="cover-logo" src="${logo}"/>
        <div class="cover-body">
          <div class="cover-kicker">${esc(opts.kicker || 'Tài liệu')}</div>
          <h1 class="cover-title" style="border:0;padding:0">${esc(title)}</h1>
          ${opts.subtitle ? `<div class="cover-sub">${esc(opts.subtitle)}</div>` : ''}
        </div>
        <div class="band2"></div><div class="band"></div>
        <div class="cover-meta">${meta}</div></section>`), 'utf8');
      const coverBytes = await renderPdf(browser, tmpCover, { ...pageBase, margin: { top: '0', bottom: '0', left: '0', right: '0' }, pageRanges: '1' }, false);
      const merged = await PDFDocument.create();
      for (const bytes of [coverBytes, bodyBytes]) {
        const doc = await PDFDocument.load(bytes);
        const offset = merged.getPageCount();
        (await merged.copyPages(doc, doc.getPageIndices())).forEach((p) => merged.addPage(p));
        fixInternalLinks(doc, merged, offset);
      }
      merged.setTitle(title); merged.setAuthor(opts.author || opts.company); merged.setCreator(opts.company);
      finalBytes = await merged.save();
    }
    fs.writeFileSync(out, finalBytes);
  } finally {
    fs.rmSync(tmpBody, { force: true });
    fs.rmSync(tmpCover, { force: true });
  }
  return out;
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.inputs.length) { usage(); process.exit(opts.help ? 0 : 1); }
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
  let failed = false;
  try {
    for (const f of opts.inputs) {
      if (!fs.existsSync(f)) { console.error('Không thấy file: ' + f); failed = true; continue; }
      console.log('✔ ' + (await convert(browser, f, opts)));
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Lỗi: ' + e.message); process.exit(1); });
