/**
 * Mermaid inline renderer — Client half.
 *
 * The Harness Markdown renderer has no plugin hook for code fences (its code
 * renderer only special-cases `math`), so this plugin enhances the rendered
 * conversation: it watches for code blocks whose content is Mermaid and swaps
 * them for a rendered SVG, with a toolbar (source toggle, zoom, fit, copy as
 * PNG, download SVG, fullscreen). Mermaid itself is a lazily-loaded sibling
 * chunk (`client.mermaid.js`), so the base plugin stays tiny and the ~1 MB
 * engine only downloads when a diagram first appears.
 *
 * The stage is height-capped to ~one screen; the diagram is sized in explicit
 * pixels so zoom/fit actually change its rendered size. Anything that fails to
 * parse is left untouched, so a normal code block is never broken.
 */
window.__ModuleLoader__.load({
  id: 'dsh-flowchart',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // A Mermaid block is detected by content (the fence language is not shown
    // reliably in the DOM), using the set of diagram keywords Mermaid accepts.
    const MERMAID_START = /^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/;

    const MAX_STAGE_VH = 0.68; // never taller than ~2/3 of the window
    const MAX_STAGE_PX = 640;
    const PAD = 24;

    const CSS = [
      '.dsh-mermaid-figure{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);margin:10px 0;overflow:hidden;font-size:13px}',
      '.dsh-mermaid-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 8px 5px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);flex-wrap:wrap}',
      '.dsh-mermaid-label{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);letter-spacing:.02em;user-select:none;white-space:nowrap}',
      '.dsh-mermaid-label::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--dsw-alias-brand-primary);opacity:.85}',
      '.dsh-mermaid-spacer{flex:1 1 auto}',
      '.dsh-mermaid-tools{display:flex;align-items:center;gap:2px;flex:0 0 auto}',
      '.dsh-mermaid-sep{width:1px;height:16px;background:var(--dsw-alias-border-l1);margin:0 4px}',
      '.dsh-mermaid-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}',
      '.dsh-mermaid-btn:hover{background:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}',
      '.dsh-mermaid-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsh-mermaid-btn[aria-pressed="true"]{background:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.dsh-mermaid-btn-text{width:auto;padding:0 8px;font-size:12px}',
      '.dsh-mermaid-zoom{min-width:42px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;user-select:none}',
      '.dsh-mermaid-toast{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:0;transition:opacity .16s ease;margin-right:2px;white-space:nowrap;pointer-events:none}',
      '.dsh-mermaid-toast.show{opacity:1}',
      '.dsh-mermaid-stage{position:relative;max-height:min(68vh,640px);overflow:hidden;background:var(--dsw-alias-bg-base);min-height:48px;box-sizing:border-box;cursor:default;user-select:none;-webkit-user-select:none}',
      '.dsh-mermaid-figure:fullscreen .dsh-mermaid-stage{cursor:grab}',
      '.dsh-mermaid-figure:fullscreen .dsh-mermaid-stage.dsh-mermaid-dragging{cursor:grabbing}',
      '.dsh-mermaid-canvas{position:absolute;left:0;top:0;width:max-content;transform-origin:0 0;will-change:transform}',
      '.dsh-mermaid-canvas svg{display:block}',
      '.dsh-mermaid-status{color:var(--dsw-alias-label-secondary);font-size:12px;padding:6px 2px;white-space:nowrap}',
      '.dsh-mermaid-source{margin:0;padding:12px 14px;overflow:auto;max-height:min(68vh,640px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--dsh-code-font-size,12px);line-height:1.5;white-space:pre}',
      '.dsh-mermaid-source[hidden],.dsh-mermaid-stage[hidden]{display:none}',
      '.dsh-mermaid-figure:fullscreen{display:flex;flex-direction:column;width:100vw;height:100vh;margin:0;border:0;border-radius:0;background:var(--dsw-alias-bg-base)}',
      '.dsh-mermaid-figure:fullscreen .dsh-mermaid-stage{flex:1 1 auto;min-height:0;max-height:none;height:auto !important}',
    ].join('\n');

    const ZH = (function () {
      const lang = ((document.documentElement && document.documentElement.lang) || navigator.language || '').toLowerCase();
      return lang.indexOf('zh') === 0;
    })();
    const LABELS = {
      title: 'Mermaid',
      source: ZH ? '源码' : 'Source',
      diagram: ZH ? '图表' : 'Diagram',
      sourceTitle: ZH ? '查看源码' : 'View source',
      diagramTitle: ZH ? '显示图表' : 'Show diagram',
      rendering: ZH ? '渲染中…' : 'Rendering…',
      zoomIn: ZH ? '放大' : 'Zoom in',
      zoomOut: ZH ? '缩小' : 'Zoom out',
      fit: ZH ? '适应页面' : 'Fit to page',
      copy: ZH ? '复制图片' : 'Copy image',
      copySource: ZH ? '复制源码' : 'Copy source',
      copiedImage: ZH ? '已复制图片，可直接粘贴分享' : 'Image copied — paste to share',
      copiedSource: ZH ? '已复制源码' : 'Source copied',
      copySourceFail: ZH ? '复制源码失败' : 'Source copy failed',
      download: ZH ? '下载 SVG' : 'Download SVG',
      fullscreen: ZH ? '全屏查看' : 'Fullscreen',
      downloaded: ZH ? '已下载 SVG' : 'SVG downloaded',
      copyFail: ZH ? '复制图片失败' : 'Image copy failed',
      copyFallback: ZH ? '复制受限，已下载 PNG' : 'Clipboard blocked — PNG downloaded',
      downloadFail: ZH ? '下载失败' : 'Download failed',
      noChart: ZH ? '暂无图表' : 'No diagram yet',
    };

    // ---------------------------------------------------------------------
    // Icons (inline SVG, drawn with currentColor)
    // ---------------------------------------------------------------------
    const ICON = {
      zoomIn: '<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14"/><path d="M7 5.2v3.6M5.2 7h3.6"/>',
      zoomOut: '<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14"/><path d="M5.2 7h3.6"/>',
      fit: '<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.8"/><rect x="5.4" y="5.4" width="5.2" height="5.2" rx="1.1"/>',
      copy: '<rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6"/><path d="M3 10.4V3.5A1.5 1.5 0 0 1 4.5 2H11"/>',
      download: '<path d="M8 2.2v8M5.1 7.4 8 10.2l2.9-2.8M2.8 13.4h10.4"/>',
      fullscreen: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M2.5 10v3.5H6M13.5 10v3.5H10"/>',
      source: '<path d="M5.4 4.6 2.2 8l3.2 3.4M10.6 4.6 13.8 8l-3.2 3.4"/>',
    };

    const SVGNS = 'http://www.w3.org/2000/svg';
    function makeIcon(paths) {
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('width', '15');
      svg.setAttribute('height', '15');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.4');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = paths;
      return svg;
    }
    function makeBtn(title, paths, onClick, text) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dsh-mermaid-btn' + (text ? ' dsh-mermaid-btn-text' : '');
      b.title = title;
      b.setAttribute('aria-label', title);
      if (text) b.textContent = text;
      else b.appendChild(makeIcon(paths));
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onClick(ev);
      });
      return b;
    }
    function clamp(v, lo, hi) {
      return Math.max(lo, Math.min(hi, v));
    }

    // ---------------------------------------------------------------------
    // Lazy Mermaid engine + theme
    // ---------------------------------------------------------------------
    let mermaidPromise = null;
    let appliedThemeKey = null;

    // Mermaid keeps parser/render state on the module singleton; concurrent
    // parse()/render() calls can corrupt it and surface as bogus syntax errors.
    // Serialize every parse+render through this chain.
    let renderChain = Promise.resolve();
    function enqueue(task) {
      const run = renderChain.then(task, task);
      renderChain = run.then(
        () => {},
        () => {},
      );
      return run;
    }

    function loadMermaid() {
      if (!mermaidPromise) {
        mermaidPromise = require.async('./client.mermaid.js').then(
          (m) => m.mermaid,
          (err) => {
            mermaidPromise = null;
            throw err;
          },
        );
      }
      return mermaidPromise;
    }

    function readTheme() {
      const cs = getComputedStyle(document.documentElement);
      const get = (name, fallback) => {
        const v = (cs.getPropertyValue(name) || '').trim();
        return v || fallback;
      };
      const bg = get('--dsw-alias-bg-base', '#ffffff');
      return {
        bg,
        layer1: get('--dsw-alias-bg-layer-1', bg),
        layer2: get('--dsw-alias-bg-layer-2', bg),
        text: get('--dsw-alias-label-primary', '#1f2328'),
        sub: get('--dsw-alias-label-secondary', '#57606a'),
        border: get('--dsw-alias-border-l2', '#d0d7de'),
        brand: get('--dsw-alias-brand-primary', '#2f81f7'),
        font: get('--dsw-font-family', 'ui-sans-serif, system-ui, sans-serif'),
      };
    }

    function themeVars(t) {
      return {
        background: t.bg,
        primaryColor: t.layer1,
        primaryTextColor: t.text,
        primaryBorderColor: t.border,
        secondaryColor: t.layer2,
        secondaryTextColor: t.text,
        secondaryBorderColor: t.border,
        tertiaryColor: t.bg,
        tertiaryTextColor: t.text,
        tertiaryBorderColor: t.border,
        lineColor: t.sub,
        textColor: t.text,
        mainBkg: t.layer1,
        nodeBorder: t.border,
        clusterBkg: t.layer1,
        clusterBorder: t.border,
        titleColor: t.text,
        edgeLabelBackground: t.bg,
        fontFamily: t.font,
        fontSize: '13px',
      };
    }

    function baseConfig(t) {
      return {
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        themeVariables: themeVars(t),
        fontFamily: t.font,
        flowchart: {
          // HTML labels wrap long text and give Mermaid real measured sizes;
          // generous spacing + straight edges keep dense CJK diagrams from
          // overlapping their edge labels.
          htmlLabels: true,
          nodeSpacing: 130,
          rankSpacing: 170,
          padding: 20,
          wrappingWidth: 260,
          curve: 'linear',
          useMaxWidth: true,
        },
        sequence: { useMaxWidth: true },
        gantt: { useMaxWidth: true },
        er: { useMaxWidth: true },
        class: { useMaxWidth: true },
        state: { useMaxWidth: true },
      };
    }

    async function ensureMermaid() {
      const mermaid = await loadMermaid();
      const t = readTheme();
      const key = JSON.stringify(t);
      if (key !== appliedThemeKey) {
        mermaid.initialize(baseConfig(t));
        appliedThemeKey = key;
      }
      return mermaid;
    }

    // Render a standalone SVG for rasterization: SVG-text labels only (no
    // foreignObject) so it draws onto a canvas. The next normal render resets
    // the display config back to rich HTML labels.
    async function renderSvgForExport(code) {
      return enqueue(async () => {
        const mermaid = await loadMermaid();
        const cfg = baseConfig(readTheme());
        cfg.flowchart = Object.assign({}, cfg.flowchart, { htmlLabels: false });
        mermaid.initialize(cfg);
        const id = 'dsh-export-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
        const result = await mermaid.render(id, code);
        appliedThemeKey = null; // re-init rich display config on next render
        return result && result.svg ? result.svg : '';
      });
    }

    // ---------------------------------------------------------------------
    // DOM / export helpers
    // ---------------------------------------------------------------------
    function codeOf(contentEl) {
      const codeEl = contentEl.querySelector('code');
      if (!codeEl) return null;
      return codeEl.textContent == null ? '' : codeEl.textContent;
    }

    function looksLikeMermaid(code) {
      if (!code || code.trim().length === 0) return false;
      const lines = code.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const s = lines[i].trim();
        if (!s) continue;
        if (s.startsWith('%%') || s === '---') continue; // directives / frontmatter
        if (!MERMAID_START.test(lines[i])) return false;
        // Flowcharts need an edge or a node shape; this avoids treating an
        // arbitrary block that merely starts with the word "graph" as a diagram.
        if (/^(?:flowchart|graph)\b/.test(s)) {
          return /-->|-\.-|==>|\[|\{/.test(code);
        }
        if (/^sequenceDiagram\b/.test(s)) {
          return /->>|-->>|participant|autonumber/.test(code);
        }
        return true;
      }
      return false;
    }

    function naturalSize(svg) {
      try {
        const vb = svg.viewBox && svg.viewBox.baseVal;
        if (vb && vb.width && vb.height) return { w: vb.width, h: vb.height };
      } catch (e) {
        /* ignore */
      }
      try {
        const r = svg.getBoundingClientRect();
        if (r.width && r.height) return { w: r.width, h: r.height };
      } catch (e) {
        /* ignore */
      }
      return { w: 800, h: 600 };
    }

    function viewBoxSize(el) {
      try {
        const vb = el && el.getAttribute ? el.getAttribute('viewBox') : null;
        if (vb) {
          const p = vb.trim().split(/[\s,]+/).map(Number);
          if (p.length === 4 && p[2] > 0 && p[3] > 0) return { w: p[2], h: p[3] };
        }
      } catch (e) {
        /* ignore */
      }
      return naturalSize(el);
    }

    function svgStringToElement(str) {
      try {
        const doc = new DOMParser().parseFromString(str, 'image/svg+xml');
        return doc.documentElement;
      } catch (e) {
        return null;
      }
    }

    // Serialize a standalone SVG sized to its natural dimensions.
    function standaloneSvg(svg, natural) {
      const clone = svg.cloneNode(true);
      clone.removeAttribute('style');
      clone.setAttribute('xmlns', SVGNS);
      clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      clone.setAttribute('width', String(Math.round(natural.w)));
      clone.setAttribute('height', String(Math.round(natural.h)));
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    }

    // Encode a string to a base64 data: URL. Using a data URL (rather than a
    // blob: URL) keeps the SVG self-contained and avoids any src/CSP/taint
    // quirks when loading it into an <img> for rasterization.
    function svgToDataUrl(str) {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return 'data:image/svg+xml;base64,' + btoa(bin);
    }

    function rasterizeDataUrl(dataUrl, natural) {
      return new Promise((resolve, reject) => {
        const w = natural.w;
        const h = natural.h;
        const scale = 2;
        const img = new Image();
        let settled = false;
        let timer = 0;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          if (timer) window.clearTimeout(timer);
          fn(arg);
        };
        timer = window.setTimeout(() => finish(reject, new Error('svg rasterize timeout')), 6000);
        img.onload = () => {
          try {
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.ceil(w * scale));
            cv.height = Math.max(1, Math.ceil(h * scale));
            const ctx = cv.getContext('2d');
            let bg = '#ffffff';
            try {
              bg = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base').trim() || '#ffffff';
            } catch (e) {
              bg = '#ffffff';
            }
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, 0, 0, cv.width, cv.height);
            cv.toBlob((blob) => {
              if (blob) finish(resolve, blob);
              else finish(reject, new Error('toBlob returned null'));
            }, 'image/png');
          } catch (err) {
            finish(reject, err);
          }
        };
        img.onerror = () => finish(reject, new Error('svg image failed to load'));
        img.src = dataUrl;
      });
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }

    // Legacy path: selecting an <img> and execCommand('copy') puts the bitmap
    // on the clipboard in Chromium, which QQ/WeChat accept on paste.
    function copyImageViaSelection(dataUrl) {
      try {
        const wrap = document.createElement('div');
        wrap.setAttribute('contenteditable', 'true');
        wrap.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;pointer-events:none;';
        const img = document.createElement('img');
        img.src = dataUrl;
        wrap.appendChild(img);
        document.body.appendChild(wrap);
        const range = document.createRange();
        range.selectNodeContents(wrap);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } catch (e) {
          ok = false;
        }
        sel.removeAllRanges();
        wrap.remove();
        return ok;
      } catch (e) {
        return false;
      }
    }

    async function copyImage(view, toast, code) {
      if (!view || !view.svg) {
        toast(LABELS.noChart);
        return;
      }
      let dataUrl = '';
      let blob = null;
      let svgEl = view.svg;
      let natural = view.natural;
      try {
        if (code) {
          // Prefer a fresh SVG-text render so the PNG has real labels.
          const exportStr = await renderSvgForExport(code);
          const el = svgStringToElement(exportStr);
          if (el && el.tagName && el.tagName.toLowerCase() === 'svg') {
            svgEl = el;
            natural = viewBoxSize(el);
          }
        }
        dataUrl = svgToDataUrl(standaloneSvg(svgEl, natural));
        blob = await rasterizeDataUrl(dataUrl, natural);
      } catch (e) {
        toast(LABELS.copyFail);
        if (window.console && console.debug) console.debug('[dsh-mermaid] rasterize failed:', (e && e.message) || e);
        return;
      }
      // 1) Preferred: async Clipboard API with image/png.
      try {
        if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
          await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
          toast(LABELS.copiedImage);
          return;
        }
      } catch (e) {
        if (window.console && console.debug) console.debug('[dsh-mermaid] clipboard.write failed:', (e && e.message) || e);
      }
      // 2) Fallback: selection + execCommand copy of the image (data URL).
      if (copyImageViaSelection(dataUrl)) {
        toast(LABELS.copiedImage);
        return;
      }
      // 3) Last resort: download the PNG so it can still be shared.
      try {
        downloadBlob(blob, 'mermaid-' + Date.now() + '.png');
        toast(LABELS.copyFallback);
      } catch (e) {
        toast(LABELS.copyFail);
      }
    }

    // Mermaid (with default settings) may append an error diagram reading
    // "Syntax error in text" to the DOM on a parse failure. Remove any such
    // stray node that is not inside one of our own figures.
    function cleanupStrayErrors() {
      try {
        // Mermaid's error diagram is an <svg> containing the message text.
        const svgs = document.querySelectorAll('svg');
        for (let i = 0; i < svgs.length; i += 1) {
          const el = svgs[i];
          if (el.closest && el.closest('.dsh-mermaid-figure')) continue;
          const text = el.textContent || '';
          if (text.indexOf('Syntax error in text') >= 0) el.remove();
        }
      } catch (e) {
        /* ignore */
      }
    }

    function copyText(text, toast) {
      const fallback = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          ta.remove();
          toast(ok ? LABELS.copiedSource : LABELS.copySourceFail);
        } catch (e) {
          toast(LABELS.copySourceFail);
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => toast(LABELS.copiedSource), fallback);
      } else {
        fallback();
      }
    }

    function downloadSvg(view, toast) {
      if (!view || !view.svg) {
        toast(LABELS.noChart);
        return;
      }
      try {
        const data = standaloneSvg(view.svg, view.natural);
        downloadBlob(new Blob([data], { type: 'image/svg+xml;charset=utf-8' }), 'mermaid-' + Date.now() + '.svg');
        toast(LABELS.downloaded);
      } catch (e) {
        toast(LABELS.downloadFail);
      }
    }

    function buildFigure(code) {
      const figure = document.createElement('div');
      figure.className = 'dsh-mermaid-figure';
      figure.setAttribute('data-dsh-mermaid', '1');

      const bar = document.createElement('div');
      bar.className = 'dsh-mermaid-bar';
      const label = document.createElement('span');
      label.className = 'dsh-mermaid-label';
      label.textContent = LABELS.title;
      const spacer = document.createElement('span');
      spacer.className = 'dsh-mermaid-spacer';
      const tools = document.createElement('div');
      tools.className = 'dsh-mermaid-tools';
      const toast = document.createElement('span');
      toast.className = 'dsh-mermaid-toast';

      const stage = document.createElement('div');
      stage.className = 'dsh-mermaid-stage';
      stage.setAttribute('data-dsh-mermaid-stage', '1');
      const canvas = document.createElement('div');
      canvas.className = 'dsh-mermaid-canvas';
      const status = document.createElement('div');
      status.className = 'dsh-mermaid-status';
      status.textContent = LABELS.rendering;
      canvas.appendChild(status);
      stage.appendChild(canvas);

      const source = document.createElement('pre');
      source.className = 'dsh-mermaid-source';
      source.hidden = true;
      const srcCode = document.createElement('code');
      srcCode.textContent = code;
      source.appendChild(srcCode);

      const view = { svg: null, natural: { w: 800, h: 600 }, scale: 1, fitMode: true, panX: 0, panY: 0 };
      let toastTimer = 0;
      function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        if (toastTimer) window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1800);
      }
      // Paint the base-size SVG and place it with a translate/scale transform,
      // so panning and zooming never fight a scroll container.
      function apply() {
        if (!view.svg) return;
        const nw = Math.max(1, Math.round(view.natural.w));
        const nh = Math.max(1, Math.round(view.natural.h));
        view.svg.style.maxWidth = 'none';
        view.svg.style.width = nw + 'px';
        view.svg.style.height = nh + 'px';
        view.svg.setAttribute('width', String(nw));
        view.svg.setAttribute('height', String(nh));
        canvas.style.transform =
          'translate(' + view.panX + 'px, ' + view.panY + 'px) scale(' + view.scale + ')';
        zoomPct.textContent = Math.round(view.scale * 100) + '%';
      }
      function fit(freeze) {
        if (!view.svg) return;
        const fullscreen = document.fullscreenElement === figure;
        const capH = fullscreen
          ? Math.max(160, window.innerHeight - 96)
          : Math.max(160, Math.min(window.innerHeight * MAX_STAGE_VH, MAX_STAGE_PX));
        let availW = 80;
        try {
          availW = Math.max(80, stage.clientWidth - PAD);
        } catch (e) {
          availW = 80;
        }
        const availH = Math.max(80, capH - PAD);
        const s = Math.min(availW / view.natural.w, availH / view.natural.h, 1);
        view.scale = clamp(s, 0.06, 1);
        view.fitMode = true;
        // Freeze the stage height once so zoom/fit only scale the diagram
        // inside a fixed canvas instead of resizing the box in the chat.
        if (freeze && !fullscreen) {
          const targetH = Math.round(clamp(view.natural.h * view.scale + PAD, 64, capH));
          stage.style.height = targetH + 'px';
        }
        const sw = stage.clientWidth || availW + PAD;
        const sh = stage.clientHeight || availH + PAD;
        view.panX = (sw - view.natural.w * view.scale) / 2;
        view.panY = (sh - view.natural.h * view.scale) / 2;
        apply();
      }
      function zoomBy(factor) {
        if (!view.svg) return;
        const rect = stage.getBoundingClientRect();
        zoomAnchored((view.scale || 1) * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      // Zoom while keeping the point under the cursor fixed.
      function zoomAnchored(next, clientX, clientY) {
        if (!view.svg) return;
        const rect = stage.getBoundingClientRect();
        const cx = clientX - rect.left;
        const cy = clientY - rect.top;
        const prev = view.scale || 1;
        const ns = clamp(next, 0.15, 6);
        view.panX = cx - (cx - view.panX) * (ns / prev);
        view.panY = cy - (cy - view.panY) * (ns / prev);
        view.scale = ns;
        view.fitMode = false;
        apply();
      }

      // Fullscreen: wheel zooms, left-drag pans freely. Outside fullscreen the
      // wheel is left alone so the chat keeps scrolling normally.
      stage.addEventListener(
        'wheel',
        (ev) => {
          if (document.fullscreenElement !== figure || !view.svg) return;
          ev.preventDefault();
          const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
          zoomAnchored((view.scale || 1) * factor, ev.clientX, ev.clientY);
        },
        { passive: false },
      );

      let drag = null;
      stage.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || !view.svg) return;
        if (document.fullscreenElement !== figure && view.fitMode) return;
        drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, panX: view.panX, panY: view.panY };
        try {
          stage.setPointerCapture(ev.pointerId);
        } catch (e) {
          /* ignore */
        }
        stage.classList.add('dsh-mermaid-dragging');
        ev.preventDefault();
      });
      stage.addEventListener('pointermove', (ev) => {
        if (!drag || ev.pointerId !== drag.id) return;
        view.panX = drag.panX + (ev.clientX - drag.x);
        view.panY = drag.panY + (ev.clientY - drag.y);
        view.fitMode = false;
        apply();
      });
      function endDrag(ev) {
        if (!drag) return;
        try {
          stage.releasePointerCapture(drag.id);
        } catch (e) {
          /* ignore */
        }
        drag = null;
        stage.classList.remove('dsh-mermaid-dragging');
      }
      stage.addEventListener('pointerup', endDrag);
      stage.addEventListener('pointercancel', endDrag);

      const zoomPct = document.createElement('span');
      zoomPct.className = 'dsh-mermaid-zoom';
      zoomPct.textContent = '100%';

      const zoomOut = makeBtn(LABELS.zoomOut, ICON.zoomOut, () => zoomBy(1 / 1.25));
      const zoomIn = makeBtn(LABELS.zoomIn, ICON.zoomIn, () => zoomBy(1.25));
      const fitBtn = makeBtn(LABELS.fit, ICON.fit, () => fit());
      function sourceShown() {
        return !source.hidden;
      }
      function refreshCopyLabel() {
        copyBtn.title = sourceShown() ? LABELS.copySource : LABELS.copy;
        copyBtn.setAttribute('aria-label', copyBtn.title);
      }
      const copyBtn = makeBtn(LABELS.copy, ICON.copy, () => {
        if (sourceShown()) copyText(code, showToast);
        else copyImage(view, showToast, code);
      });
      refreshCopyLabel();
      const dlBtn = makeBtn(LABELS.download, ICON.download, () => downloadSvg(view, showToast));
      const fsBtn = makeBtn(LABELS.fullscreen, ICON.fullscreen, () => {
        try {
          if (document.fullscreenElement === figure) {
            if (document.exitFullscreen) document.exitFullscreen();
          } else if (figure.requestFullscreen) {
            const p = figure.requestFullscreen();
            if (p && p.catch) p.catch(() => {});
          }
        } catch (e) {
          /* ignore */
        }
      });

      const sourceBtn = makeBtn(LABELS.sourceTitle, ICON.source, () => {
        const show = source.hidden;
        source.hidden = !show;
        stage.hidden = show;
        sourceBtn.textContent = show ? LABELS.diagram : LABELS.source;
        sourceBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
        sourceBtn.title = show ? LABELS.diagramTitle : LABELS.sourceTitle;
        sourceBtn.setAttribute('aria-label', sourceBtn.title);
        refreshCopyLabel();
        if (show) source.scrollTop = 0;
      }, LABELS.source);

      function sep() {
        const s = document.createElement('span');
        s.className = 'dsh-mermaid-sep';
        return s;
      }
      tools.appendChild(zoomOut);
      tools.appendChild(zoomPct);
      tools.appendChild(zoomIn);
      tools.appendChild(fitBtn);
      tools.appendChild(sep());
      tools.appendChild(copyBtn);
      tools.appendChild(dlBtn);
      tools.appendChild(fsBtn);
      tools.appendChild(sep());
      tools.appendChild(sourceBtn);

      bar.appendChild(label);
      bar.appendChild(spacer);
      bar.appendChild(toast);
      bar.appendChild(tools);
      figure.appendChild(bar);
      figure.appendChild(stage);
      figure.appendChild(source);

      return { figure, stage, canvas, view, apply, fit, zoomBy };
    }

    // ---------------------------------------------------------------------
    // Enhancer lifecycle
    // ---------------------------------------------------------------------
    function createEnhancer() {
      const records = new Map(); // blockEl -> { phase, code, figure, canvas, view, apply, fit }
      let disposed = false;
      let scanTimer = 0;
      let themeTimer = 0;
      let uid = 0;

      // Clear any error graphics a previous (buggy) instance left behind.
      cleanupStrayErrors();

      function onResize() {
        if (disposed) return;
        window.requestAnimationFrame(() => {
          for (const rec of records.values()) {
            if (rec.phase === 'done' && rec.view && rec.view.fitMode && rec.fit) rec.fit(true);
          }
        });
      }

      async function renderInto(rec, code) {
        const svgText = await enqueue(async () => {
          const mermaid = await ensureMermaid();
          // Validate first: mermaid.parse throws (or returns false) on bad
          // syntax without drawing anything, so we never trigger error art.
          try {
            const parsed = await mermaid.parse(code);
            if (parsed === false) throw new Error('invalid');
          } catch (e) {
            const err = new Error('invalid mermaid syntax');
            err.dshInvalid = true;
            throw err;
          }
          const id = 'dsh-mermaid-' + (uid += 1);
          const result = await mermaid.render(id, code);
          return result && result.svg ? result.svg : '';
        });
        if (disposed || !rec.figure || !rec.figure.isConnected) return false;
        rec.canvas.innerHTML = svgText;
        const svg = rec.canvas.querySelector('svg');
        if (svg) {
          svg.removeAttribute('height');
          svg.removeAttribute('width');
          svg.style.maxWidth = 'none';
        }
        rec.view.svg = svg;
        rec.view.natural = svg ? naturalSize(svg) : { w: 800, h: 600 };
        if (rec.view.fitMode) rec.fit();
        else rec.apply();
        return true;
      }

      function process(block, contentEl, code) {
        // Start from a visible original block; we only hide it after a good render.
        block.style.display = '';
        block.removeAttribute('data-dsh-mermaid-hidden');
        const built = buildFigure(code);
        const rec = {
          phase: 'rendering',
          code,
          figure: built.figure,
          canvas: built.canvas,
          view: built.view,
          apply: built.apply,
          fit: built.fit,
        };
        records.set(block, rec);
        built.figure.style.display = 'none';
        block.insertAdjacentElement('afterend', built.figure);

        renderInto(rec, code)
          .then((ok) => {
            if (!ok || records.get(block) !== rec) {
              built.figure.remove();
              if (records.get(block) === rec) records.delete(block);
              return;
            }
            const still = contentEl.isConnected ? codeOf(contentEl) : null;
            if (still !== null && still !== code) {
              built.figure.remove();
              records.delete(block);
              return;
            }
            rec.phase = 'done';
            built.figure.style.display = '';
            // Re-fit after the figure is visible (stage has a real width now).
            window.requestAnimationFrame(() => {
              if (records.get(block) === rec) built.fit(true);
            });
            block.style.display = 'none';
            block.setAttribute('data-dsh-mermaid-hidden', '1');
          })
          .catch((err) => {
            if (records.get(block) === rec) records.delete(block);
            built.figure.remove();
            // Invalid syntax: never retry. Transient render/load errors: allow
            // a couple of retries, then give up (a retry storm floods the page).
            if (err && err.dshInvalid) {
              block._dshMermaidFailedCode = code;
            } else {
              const tries = block._dshMermaidTryCode === code ? (block._dshMermaidTries || 0) + 1 : 1;
              block._dshMermaidTryCode = code;
              block._dshMermaidTries = tries;
              if (tries >= 3) block._dshMermaidFailedCode = code;
            }
            if (block.isConnected) {
              block.style.display = '';
              block.removeAttribute('data-dsh-mermaid-hidden');
            }
            cleanupStrayErrors();
            if (window.console && console.debug) {
              console.debug('[dsh-mermaid] render skipped:', (err && err.message) || err);
            }
          });
      }

      function scan() {
        if (disposed) return;
        const contents = document.querySelectorAll('[data-code-block-content]');

        for (const [block, rec] of records) {
          if (!block.isConnected) {
            if (rec.figure) rec.figure.remove();
            records.delete(block);
          }
        }

        for (let i = 0; i < contents.length; i += 1) {
          const contentEl = contents[i];
          const block = contentEl.closest('.md-code-block');
          if (!block) continue;

          const code = codeOf(contentEl);
          const candidate = code !== null && looksLikeMermaid(code);
          const rec = records.get(block);

          // Already tried this exact source and it was not valid Mermaid.
          if (candidate && block._dshMermaidFailedCode === code) continue;

          if (!candidate) {
            if (rec) {
              if (rec.figure) rec.figure.remove();
              records.delete(block);
              block.style.display = '';
              block.removeAttribute('data-dsh-mermaid-hidden');
            } else if (block.getAttribute('data-dsh-mermaid-hidden') === '1') {
              block.style.display = '';
              block.removeAttribute('data-dsh-mermaid-hidden');
            }
            continue;
          }

          if (rec) {
            if (rec.phase === 'rendering') {
              if (rec.code === code) continue;
              if (rec.figure) rec.figure.remove();
              records.delete(block);
            } else if (rec.phase === 'done') {
              if (rec.code === code && rec.figure && rec.figure.isConnected) {
                if (block.style.display !== 'none') block.style.display = 'none';
                continue;
              }
              if (rec.figure) rec.figure.remove();
              records.delete(block);
            }
          }
          process(block, contentEl, code);
        }
      }

      function scheduleScan() {
        if (disposed) return;
        if (scanTimer) return;
        scanTimer = window.setTimeout(() => {
          scanTimer = 0;
          scan();
        }, 260);
      }

      function scheduleThemeRerender() {
        if (disposed) return;
        if (themeTimer) return;
        themeTimer = window.setTimeout(() => {
          themeTimer = 0;
          appliedThemeKey = null;
          for (const [block, rec] of records) {
            if (rec.phase !== 'done' || !rec.figure || !rec.figure.isConnected) continue;
            if (rec.canvas) {
              rec.canvas.innerHTML = '<div class="dsh-mermaid-status">' + LABELS.rendering + '</div>';
            }
            renderInto(rec, rec.code).catch(() => {});
          }
        }, 180);
      }

      const domObserver = new MutationObserver(scheduleScan);
      domObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

      const themeObserver = new MutationObserver(scheduleThemeRerender);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'],
      });

      let media = null;
      try {
        media = window.matchMedia('(prefers-color-scheme: dark)');
        if (media && media.addEventListener) media.addEventListener('change', scheduleThemeRerender);
      } catch (e) {
        media = null;
      }
      window.addEventListener('resize', onResize);
      document.addEventListener('fullscreenchange', onResize);

      scheduleScan();

      return {
        dispose() {
          disposed = true;
          if (scanTimer) window.clearTimeout(scanTimer);
          if (themeTimer) window.clearTimeout(themeTimer);
          domObserver.disconnect();
          themeObserver.disconnect();
          if (media && media.removeEventListener) media.removeEventListener('change', scheduleThemeRerender);
          window.removeEventListener('resize', onResize);
          document.removeEventListener('fullscreenchange', onResize);
          for (const [block, rec] of records) {
            if (rec.figure) rec.figure.remove();
            if (block.isConnected) {
              block.style.display = '';
              block.removeAttribute('data-dsh-mermaid-hidden');
            }
          }
          records.clear();
        },
      };
    }

    function MermaidEnhancer() {
      React.useEffect(() => {
        const enhancer = createEnhancer();
        return () => enhancer.dispose();
      }, []);
      return h(
        React.Fragment,
        null,
        h('style', { key: 'css' }, CSS),
        h('span', { key: 'anchor', 'aria-hidden': 'true', style: { display: 'none' } }),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'dsh-mermaid-enhancer', order: 60 },
            MermaidEnhancer,
          ),
        );
      },
    };
  },
});
