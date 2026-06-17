/* Poster Sizer — app.js */

// ── State ──────────────────────────────────────────────
const state = {
  htmlSource: null,
  fileName: null,
  naturalW: 0,
  naturalH: 0,
  printScale: 1,
  editMode: false,
  selectedEl: null,
  panelApplied: {}, // prop → original inline value
};

// ── DOM refs ───────────────────────────────────────────
const workspace     = document.getElementById('workspace');
const emptyState    = document.getElementById('empty-state');
const previewPanel  = document.getElementById('preview-panel');
const posterVP      = document.getElementById('poster-viewport');
const iframe        = document.getElementById('poster-frame');
const fileInput     = document.getElementById('file-input');
const fileNameEl    = document.getElementById('file-name');
const scaleInd      = document.getElementById('scale-indicator');
const btnUpload     = document.getElementById('btn-upload');
const btnPrint      = document.getElementById('btn-print');
const toggleEdit    = document.getElementById('toggle-edit');
const propsPanel    = document.getElementById('props-panel');
const propsBreadcrumb = document.getElementById('props-breadcrumb');
const propsClose    = document.getElementById('props-close');
const btnReset      = document.getElementById('btn-reset-element');
const sourceControls = document.getElementById('source-controls');
const inpSourceW    = document.getElementById('inp-source-w');
const inpSourceH    = document.getElementById('inp-source-h');
const btnRefit      = document.getElementById('btn-refit');

// CSS prop inputs
const propFontSize     = document.getElementById('prop-font-size');
const propFontSizeUnit = document.getElementById('prop-font-size-unit');
const propColor        = document.getElementById('prop-color');
const propColorHex     = document.getElementById('prop-color-hex');
const propBgColor      = document.getElementById('prop-bg-color');
const propBgColorHex   = document.getElementById('prop-bg-color-hex');
const propBgClear      = document.getElementById('prop-bg-clear');
const propFontWeight   = document.getElementById('prop-font-weight');
const propAlignBtns    = Array.from(document.querySelectorAll('.prop-align-btn'));
const propPadding      = document.getElementById('prop-padding');
const propLineHeight   = document.getElementById('prop-line-height');

// ── File Ingestion ─────────────────────────────────────
btnUpload.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

// Drag and drop
workspace.addEventListener('dragover', (e) => {
  e.preventDefault();
  emptyState.classList.add('drag-active');
});

workspace.addEventListener('dragleave', (e) => {
  if (!workspace.contains(e.relatedTarget)) {
    emptyState.classList.remove('drag-active');
  }
});

workspace.addEventListener('drop', (e) => {
  e.preventDefault();
  emptyState.classList.remove('drag-active');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.html') && !name.endsWith('.htm')) {
    alert('Please upload an HTML file (.html or .htm)');
    return;
  }
  state.fileName = file.name;
  fileNameEl.textContent = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    state.htmlSource = e.target.result;
    loadIntoFrame(state.htmlSource);
  };
  reader.readAsText(file);
}

// ── Iframe Loading ─────────────────────────────────────
function loadIntoFrame(htmlString) {
  state.editMode = false;
  toggleEdit.checked = false;
  toggleEdit.disabled = true;
  btnPrint.disabled = true;
  sourceControls.classList.add('hidden');
  closePropsPanel();

  iframe.srcdoc = htmlString;
}

iframe.addEventListener('load', async () => {
  if (!state.htmlSource) return;

  const doc = iframe.contentDocument;
  if (!doc) return;

  // Wait for fonts before measuring
  try {
    await doc.fonts.ready;
  } catch (e) { /* fonts API may not be available in sandboxed iframe */ }

  // Two rAF frames for layout to settle
  await raf2();

  await measureAndScale();

  injectEditStyles();

  // Wire up click listener for element selection
  doc.addEventListener('click', onIframeClick, true);

  // Show preview
  emptyState.classList.add('hidden');
  previewPanel.classList.remove('hidden');
  toggleEdit.disabled = false;
  btnPrint.disabled = false;
});

function raf2() {
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// ── Measurement ────────────────────────────────────────
async function measureAndScale() {
  const doc  = iframe.contentDocument;
  const html = doc.documentElement;
  const body = doc.body;

  // Step 1: detect intended viewport width from meta tag
  const viewportMeta = doc.querySelector('meta[name="viewport"]');
  const widthMatch   = viewportMeta?.content?.match(/width=(\d+)/);
  const intendedW    = widthMatch ? parseInt(widthMatch[1]) : null;

  // Inject measurement helper: height:auto prevents 100vh from inflating measurements
  const measureStyle = doc.createElement('style');
  measureStyle.id = 'poster-sizer-measure';
  measureStyle.textContent = `
    html, body {
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
    }
  `;
  doc.head.appendChild(measureStyle);

  // PASS 1: render at a narrow width (100px) so that content with fixed/max-width
  // constraints overflows the iframe → body.scrollWidth = the content's natural width
  // (e.g. a max-width:660px wrapper gives scrollWidth=660, not the iframe width).
  // Fluid content (width:100% everywhere) gives scrollWidth≈100 → falls back to 1200.
  iframe.style.width  = '100px';
  iframe.style.height = '3000px';

  await raf2();

  const minContentW = Math.max(body.scrollWidth || 0, html.scrollWidth || 0);
  let w = intendedW || (minContentW > 320 ? minContentW : 1200);

  // PASS 2: render at the detected content width to measure the natural height
  iframe.style.width  = w + 'px';
  iframe.style.height = '3000px';

  await raf2();

  let h = Math.max(
    body.scrollHeight  || 0,
    body.offsetHeight  || 0,
    html.scrollHeight  || 0,
    html.offsetHeight  || 0
  );

  if (h < 10) h = Math.round(w * (36 / 24));

  // Remove measurement helper
  measureStyle.remove();

  state.naturalW = w;
  state.naturalH = h;

  // Show source dimension controls and populate with detected values
  sourceControls.classList.remove('hidden');
  inpSourceW.value = w;
  inpSourceH.value = h;

  applyScale();
}

// ── Scale Calculation ──────────────────────────────────
function applyScale() {
  const POSTER_W_PX = 24 * 96; // 2304
  const POSTER_H_PX = 36 * 96; // 3456

  const { naturalW, naturalH } = state;

  // Fit-to-contain scale for printing
  state.printScale = Math.min(POSTER_W_PX / naturalW, POSTER_H_PX / naturalH);

  // Size the poster-viewport div (px per inch × 24in wide, 36in tall)
  const pad = 48;
  const availW = workspace.clientWidth - (propsPanel.classList.contains('hidden') ? 0 : 230) - pad * 2;
  const availH = workspace.clientHeight - pad * 2;
  const vpScale = Math.min(availW / 24, availH / 36); // px per inch

  posterVP.style.setProperty('--viewport-scale', vpScale + 'px');

  // Set the iframe to the content's natural pixel dimensions, then scale the
  // iframe element itself in the parent page so it fits the poster-viewport.
  // This avoids any in-document transform/clip issues — the iframe renders at
  // full resolution and the parent CSS scales it down cleanly.
  const displayW = 24 * vpScale; // visual width of poster-viewport in screen px
  const previewScale = displayW / naturalW;

  iframe.style.width     = naturalW + 'px';
  iframe.style.height    = naturalH + 'px';
  iframe.style.transform = `scale(${previewScale})`;

  injectPrintStyles();
  updateScaleIndicator();
}

function injectPrintStyles() {
  const doc = iframe.contentDocument;
  if (!doc) return;

  const { naturalW, naturalH, printScale } = state;

  const old = doc.getElementById('poster-sizer-scale');
  if (old) old.remove();

  const style = doc.createElement('style');
  style.id = 'poster-sizer-scale';
  // Only print styles are injected — screen display is handled by the parent
  // page scaling the iframe element itself (no in-document transforms needed).
  style.textContent = `
/* === Poster Sizer Print Styles === */
@media print {
  html {
    zoom: ${printScale.toFixed(6)};
    width: ${naturalW}px !important;
    height: ${naturalH}px !important;
    overflow: hidden !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  body {
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }
}
@page {
  size: 24in 36in;
  margin: 0;
}
`;
  doc.head.appendChild(style);
}

function updateScaleIndicator() {
  const { naturalW, naturalH, printScale } = state;
  const scalePct = (printScale * 100).toFixed(0);
  scaleInd.textContent =
    `Print scale: ${printScale.toFixed(2)}× (${scalePct}%) · Source: ${naturalW}×${naturalH}px → 24×36 in`;
}

// ── Source Dimension Overrides ────────────────────────
function applySourceDims() {
  const w = parseInt(inpSourceW.value);
  const h = parseInt(inpSourceH.value);
  if (w >= 100 && h >= 100) {
    state.naturalW = w;
    state.naturalH = h;
    applyScale();
  }
}

inpSourceW.addEventListener('change', applySourceDims);
inpSourceH.addEventListener('change', applySourceDims);

btnRefit.addEventListener('click', async () => {
  if (state.htmlSource) await measureAndScale();
});

// ── Window Resize ──────────────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.htmlSource) applyScale();
  }, 150);
});

// ── Edit Mode ──────────────────────────────────────────
toggleEdit.addEventListener('change', () => {
  state.editMode = toggleEdit.checked;
  setEditMode(state.editMode);
});

const TEXT_TAGS = new Set([
  'P','H1','H2','H3','H4','H5','H6',
  'SPAN','LI','TD','TH','A','LABEL',
  'FIGCAPTION','CAPTION','BLOCKQUOTE',
  'STRONG','EM','B','I','SMALL','MARK','LEGEND','SUMMARY',
]);

function setEditMode(enabled) {
  const doc = iframe.contentDocument;
  if (!doc) return;

  if (enabled) {
    doc.querySelectorAll('*').forEach(el => {
      if (TEXT_TAGS.has(el.tagName) && hasDirectText(el)) {
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('data-poster-editable', '');
      }
    });
    doc.body.classList.add('edit-mode');
  } else {
    doc.querySelectorAll('[data-poster-editable]').forEach(el => {
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-poster-editable');
    });
    doc.body.classList.remove('edit-mode');
    closePropsPanel();
    state.selectedEl = null;
  }
}

function hasDirectText(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
      return true;
    }
  }
  return false;
}

// ── Edit Styles (injected into iframe) ────────────────
function injectEditStyles() {
  const doc = iframe.contentDocument;
  if (!doc) return;

  const old = doc.getElementById('poster-sizer-edit');
  if (old) old.remove();

  const style = doc.createElement('style');
  style.id = 'poster-sizer-edit';
  style.textContent = `
@media screen {
  body.edit-mode [contenteditable] {
    outline: 2px dashed rgba(74,158,255,0.5);
    cursor: text;
    border-radius: 2px;
  }
  body.edit-mode [contenteditable]:hover {
    outline-color: rgba(74,158,255,0.85);
  }
  body.edit-mode [contenteditable]:focus {
    outline: 2px solid #4a9eff;
    background: rgba(74,158,255,0.06);
  }
  body.edit-mode *:not([contenteditable]):hover {
    outline: 1px dashed rgba(255,255,255,0.15);
    cursor: pointer;
  }
}
`;
  doc.head.appendChild(style);
}

// ── Element Selection / Props Panel ───────────────────
function onIframeClick(e) {
  if (!state.editMode) return;

  // Don't steal focus from contenteditable elements when typing
  if (e.target.getAttribute('contenteditable') === 'true') {
    // Still update the props panel for the clicked element
    openPropsPanel(e.target);
    return;
  }

  openPropsPanel(e.target);
}

function openPropsPanel(el) {
  state.selectedEl = el;
  state.panelApplied = {};

  // Breadcrumb
  const path = [];
  let node = el;
  while (node && node.tagName && node.tagName !== 'BODY') {
    let label = node.tagName.toLowerCase();
    if (node.id) label += `#${node.id}`;
    else if (node.className && typeof node.className === 'string') {
      const cls = node.className.trim().split(/\s+/)[0];
      if (cls) label += `.${cls}`;
    }
    path.unshift(label);
    node = node.parentElement;
  }
  propsBreadcrumb.textContent = path.slice(-3).join(' > ') || el.tagName.toLowerCase();
  propsBreadcrumb.title = path.join(' > ');

  // Populate fields from computed style
  const cs = iframe.contentWindow.getComputedStyle(el);

  // Font size
  const fsPx = parseFloat(cs.fontSize);
  propFontSize.value = fsPx ? fsPx.toFixed(0) : '';
  propFontSizeUnit.value = 'px';

  // Color
  const fgRgb = cs.color;
  propColor.value = rgbToHex(fgRgb) || '#000000';
  propColorHex.value = rgbToHex(fgRgb) || '';

  // Background color
  const bgRgb = cs.backgroundColor;
  const bgHex = rgbToHex(bgRgb);
  propBgColor.value = bgHex || '#ffffff';
  propBgColorHex.value = (bgRgb === 'rgba(0, 0, 0, 0)' || bgRgb === 'transparent') ? '' : (bgHex || '');

  // Font weight
  const fw = cs.fontWeight;
  propFontWeight.value = ['300','400','500','600','700','800','900'].includes(fw) ? fw : '';

  // Text align
  const ta = cs.textAlign;
  propAlignBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.align === ta);
  });

  // Padding (average of 4 sides or top as reference)
  const pt = parseFloat(cs.paddingTop);
  propPadding.value = isNaN(pt) ? '' : pt.toFixed(0);

  // Line height
  const lh = cs.lineHeight;
  const lhNum = parseFloat(lh);
  const fsNum = parseFloat(cs.fontSize) || 1;
  propLineHeight.value = lh === 'normal' ? '' : (lhNum / fsNum).toFixed(2);

  // Show panel
  propsPanel.classList.remove('hidden');
  applyScale(); // recalculate viewport since panel width changed
}

function closePropsPanel() {
  propsPanel.classList.add('hidden');
  state.selectedEl = null;
  if (state.htmlSource) {
    setTimeout(() => applyScale(), 50);
  }
}

propsClose.addEventListener('click', closePropsPanel);

// ── CSS Property Inputs ────────────────────────────────
function applyStyleToSelected(prop, value) {
  if (!state.selectedEl) return;
  state.selectedEl.style[prop] = value;
}

// Font size
propFontSize.addEventListener('input', () => {
  const v = propFontSize.value;
  if (!v) return;
  applyStyleToSelected('fontSize', v + propFontSizeUnit.value);
});
propFontSizeUnit.addEventListener('change', () => {
  const v = propFontSize.value;
  if (!v) return;
  applyStyleToSelected('fontSize', v + propFontSizeUnit.value);
});

// Color
propColor.addEventListener('input', () => {
  propColorHex.value = propColor.value;
  applyStyleToSelected('color', propColor.value);
});
propColorHex.addEventListener('input', () => {
  const h = propColorHex.value;
  if (/^#[0-9a-fA-F]{6}$/.test(h)) {
    propColor.value = h;
    applyStyleToSelected('color', h);
  }
});

// Background color
propBgColor.addEventListener('input', () => {
  propBgColorHex.value = propBgColor.value;
  applyStyleToSelected('backgroundColor', propBgColor.value);
});
propBgColorHex.addEventListener('input', () => {
  const h = propBgColorHex.value;
  if (/^#[0-9a-fA-F]{6}$/.test(h)) {
    propBgColor.value = h;
    applyStyleToSelected('backgroundColor', h);
  }
});
propBgClear.addEventListener('click', () => {
  propBgColorHex.value = '';
  applyStyleToSelected('backgroundColor', '');
});

// Font weight
propFontWeight.addEventListener('change', () => {
  applyStyleToSelected('fontWeight', propFontWeight.value);
});

// Text align
propAlignBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    propAlignBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyStyleToSelected('textAlign', btn.dataset.align);
  });
});

// Padding
propPadding.addEventListener('input', () => {
  const v = propPadding.value;
  if (v === '') return;
  applyStyleToSelected('padding', v + 'px');
});

// Line height
propLineHeight.addEventListener('input', () => {
  const v = propLineHeight.value;
  if (v === '') return;
  applyStyleToSelected('lineHeight', v);
});

// Reset element
btnReset.addEventListener('click', () => {
  if (!state.selectedEl) return;
  // Remove all inline styles added by the panel (and contenteditable inline styles)
  const el = state.selectedEl;
  ['fontSize','color','backgroundColor','fontWeight','textAlign','padding','lineHeight'].forEach(p => {
    el.style[p] = '';
  });
  // Refresh panel fields
  openPropsPanel(el);
});

// ── Print ──────────────────────────────────────────────
btnPrint.addEventListener('click', triggerPrint);

function triggerPrint() {
  if (!state.htmlSource) return;

  const doc = iframe.contentDocument;
  const { naturalW, naturalH, printScale } = state;

  // Collect head tags, excluding injected poster-sizer styles
  const headParts = Array.from(doc.head.children)
    .filter(el => !['poster-sizer-scale', 'poster-sizer-edit', 'poster-sizer-measure'].includes(el.id))
    .map(el => el.outerHTML)
    .join('\n');

  // Clone body without edit-mode markers; preserve body inline styles (often
  // hold background-color in Claude-generated posters).
  const tempBody = doc.body.cloneNode(true);
  tempBody.querySelectorAll('[data-poster-editable]').forEach(el => {
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-poster-editable');
  });
  tempBody.classList.remove('edit-mode');
  const bodyHTML = tempBody.innerHTML;
  const bodyStyle = doc.body.getAttribute('style') || '';

  // Center content horizontally within the 24in page (content may be narrower).
  // With CSS zoom, the zoomed layout width is naturalW * printScale.
  const POSTER_W_CSS = 24 * 96; // 2304 px
  const centerLeft = Math.max(0, Math.round((POSTER_W_CSS - naturalW * printScale) / 2));

  // Build a standalone print document. The user clicks the "Print" button
  // in the popup themselves, which ensures fonts/images are fully loaded
  // before print() is triggered (avoids the timing race that strips backgrounds).
  //
  // IMPORTANT: we use CSS `zoom` (not `transform: scale`) on #_pw.
  // `transform` is a visual-only effect — Chrome's PDF renderer measures
  // layout dimensions, not painted dimensions, so a transformed div still
  // renders at its original layout size in the PDF.
  // `zoom` actually changes the layout box, so Chrome sees the zoomed size.
  const printHTML = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
${headParts}
<style>
*, *::before, *::after {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  color-adjust: exact !important;
}
html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: 24in !important;
  height: 36in !important;
  overflow: hidden !important;
}
#_pw {
  zoom: ${printScale.toFixed(6)};
  width: ${naturalW}px;
  height: ${naturalH}px;
  overflow: hidden;
  position: absolute;
  top: 0;
  left: ${centerLeft}px;
}
#_bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: rgba(26,27,30,0.96);
  color: #e8e9ed;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  z-index: 99999;
  box-shadow: 0 -2px 16px rgba(0,0,0,0.5);
}
#_bar strong { color: #4a9eff; }
#_bar-btn {
  margin-left: auto;
  background: #4a9eff;
  color: #fff;
  border: none;
  padding: 9px 20px;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
#_bar-btn:hover { background: #3a8eef; }
@media print { #_bar { display: none !important; } }
@page { size: 24in 36in; margin: 0; }
</style>
</head><body>
<div id="_pw"${bodyStyle ? ` style="${bodyStyle}"` : ''}>${bodyHTML}</div>
<div id="_bar">
  <span>Poster preview — when the print dialog opens, set <strong>Destination → Save as PDF</strong>. Paper size auto-sets to <strong>24 × 36 in</strong>.</span>
  <button id="_bar-btn" onclick="window.print()">Print / Save PDF</button>
</div>
</body></html>`;

  const blob = new Blob([printHTML], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const pw = window.open(url, '_blank');
  if (!pw) {
    URL.revokeObjectURL(url);
    alert('Popup blocked — please allow popups for this page and try again.');
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 600000);
}

// ── Helpers ────────────────────────────────────────────
function rgbToHex(rgb) {
  if (!rgb) return null;
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const r = parseInt(m[1]);
  const g = parseInt(m[2]);
  const b = parseInt(m[3]);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}
