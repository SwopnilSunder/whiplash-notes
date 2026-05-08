// ─────────────────────────────────────────────────────────────────────────────
//  renderer.js  –  All editor logic
//
//  Features:
//    • Save as plain .txt (markdown-lite + code fences for code blocks)
//    • Load most recent note on startup
//    • 400ms debounced auto-save
//    • Sidebar listing all notes — click to switch
//    • Always-on-top toggle via status bar click
//    • B/I/U/S formatting + Ctrl+B/I/U/N shortcuts
//    • New note (+) and delete (🗑) with correct sidebar updates
//    • Find in note — Ctrl+F, TreeWalker highlights, Prev/Next navigation
//    • Dynamic Syntax Highlighting — type /language then Enter or Space
//      to insert a highlighted code block (powered by lib/prism-bundle.js)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Element refs ──────────────────────────────────────────────────────────────
const editor       = document.getElementById('editor');
const fontSizeEl   = document.getElementById('font-size');
const statusEl     = document.getElementById('status-text');
const btnNew       = document.getElementById('btn-new');
const btnDelete    = document.getElementById('btn-delete');
const btnSidebar   = document.getElementById('btn-sidebar');
const btnSearch    = document.getElementById('btn-search');
const sidebar      = document.getElementById('sidebar');
const notesList    = document.getElementById('notes-list');
const searchBar    = document.getElementById('search-bar');
const searchInput  = document.getElementById('search-input');
const searchCount  = document.getElementById('search-count');

// ── State ─────────────────────────────────────────────────────────────────────
let currentFilename = null;
let allNotes        = [];    // in-memory cache: [{ filename, content, mtime }]
let sidebarOpen     = false;
let saveTimer       = null;
// Search state
let searchOpen      = false;
let searchMarks     = [];    // all <mark> elements currently in the editor
let searchIndex     = -1;   // which mark is currently active
let statusTimer     = null;
// Undo stack for code-block deletions (X button)
const deletedBlocks = [];

// ── Language aliases ──────────────────────────────────────────────────────────
// Maps the /trigger word the user types to the canonical language key
// used by Prism and stored in data-lang on the code block.
const LANG_ALIASES = {
  python:     'python',   py:         'python',
  javascript: 'javascript', js:       'javascript',
  typescript: 'typescript', ts:       'typescript',
  c:          'c',
  cpp:        'cpp',      'c++':      'cpp',
  java:       'java',
  bash:       'bash',     sh:         'bash',     shell: 'bash',
  json:       'json',
  sql:        'sql',
  go:         'go',       golang:     'go',
  rust:       'rust',     rs:         'rust',
  markdown:   'markdown', md:         'markdown',
  yaml:       'yaml',     yml:        'yaml',
  ruby:       'ruby',     rb:         'ruby',
  php:        'php',
};

// ── HTML escape ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Code block HTML factory ───────────────────────────────────────────────────
/**
 * Returns the HTML string for a code block wrapper.
 * The initial code is stored in data-initial-code (URL-encoded) so
 * setupCodeBlock() can read it back without needing to parse innerHTML.
 */
function createCodeBlockHTML(lang, code) {
  const highlighted = (window.Prism && code)
    ? window.Prism.highlight(code, null, lang)
    : escHtml(code);
  const encoded = encodeURIComponent(code);
  return (
    `<div class="code-block" data-lang="${lang}" contenteditable="false">` +
      `<div class="code-block-header">` +
        `<span class="code-lang-label">${lang}</span>` +
        `<div class="code-header-actions">` +
          `<button class="code-copy-btn">Copy</button>` +
          `<button class="code-delete-btn" title="Delete block">✕</button>` +
        `</div>` +
      `</div>` +
      `<div class="code-block-body">` +
        `<pre class="code-pre language-${lang}">` +
          `<code class="language-${lang}">${highlighted}</code>` +
        `</pre>` +
        `<textarea class="code-textarea" spellcheck="false" ` +
                  `autocomplete="off" data-initial-code="${encoded}"></textarea>` +
      `</div>` +
    `</div>`
  );
}

// ── Code block setup ──────────────────────────────────────────────────────────
/**
 * Wire up a .code-block element: populate textarea from data-initial-code,
 * re-highlight on every keystroke, sync height, copy button.
 */
function setupCodeBlock(wrapper) {
  wrapper.dataset.wired = '1'; // sentinel so the MutationObserver won't double-wire

  const ta        = wrapper.querySelector('.code-textarea');
  const codeEl    = wrapper.querySelector('code');
  const copyBtn   = wrapper.querySelector('.code-copy-btn');
  const deleteBtn = wrapper.querySelector('.code-delete-btn');
  const lang      = wrapper.dataset.lang || 'text';

  // Restore code from the encoded attribute (set by createCodeBlockHTML or
  // loaded from textToHtml after parsing a code fence from disk).
  const initial = decodeURIComponent(ta.dataset.initialCode || '');
  if (initial) {
    ta.value = initial;
    rehighlight();
  }

  function rehighlight() {
    codeEl.innerHTML = window.Prism
      ? window.Prism.highlight(ta.value, null, lang)
      : escHtml(ta.value);
    syncHeight();
  }

  function syncHeight() {
    // Let the textarea shrink first so scrollHeight reflects real content height
    ta.style.height = '1px';
    ta.style.height = ta.scrollHeight + 'px';
    // Keep the pre at least as tall so the body height covers the textarea
    const pre = wrapper.querySelector('.code-pre');
    pre.style.minHeight = ta.style.height;
  }

  ta.addEventListener('input', () => {
    rehighlight();
    scheduleSave();
  });

  ta.addEventListener('keydown', ev => {
    // Tab → insert 4 spaces
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(e);
      ta.selectionStart = ta.selectionEnd = s + 4;
      rehighlight();
    }
    // Escape → return focus to editor after this block
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      focusEditorAfterBlock(wrapper);
    }
    // ArrowDown on last line → move cursor to editor content after this block
    if (ev.key === 'ArrowDown') {
      if (!ta.value.slice(ta.selectionEnd).includes('\n')) {
        ev.preventDefault();
        ev.stopPropagation();
        focusEditorAfterBlock(wrapper);
      }
    }
    // ArrowUp on first line → move cursor to editor content before this block
    if (ev.key === 'ArrowUp') {
      if (!ta.value.slice(0, ta.selectionStart).includes('\n')) {
        ev.preventDefault();
        ev.stopPropagation();
        focusEditorBeforeBlock(wrapper);
      }
    }
  });

  // Sync horizontal scroll between textarea and pre
  ta.addEventListener('scroll', () => {
    const pre = wrapper.querySelector('.code-pre');
    pre.scrollTop  = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  });

  // Copy button
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(ta.value).then(() => {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');
      }, 1500);
    }).catch(() => {
      // Fallback for environments without clipboard API
      ta.select();
      document.execCommand('copy');
    });
  });

  // Delete button — removes the block and pushes to our undo stack (Ctrl+Z restores it)
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      ta.dataset.initialCode = encodeURIComponent(ta.value);
      const afterEl = wrapper.nextSibling;
      focusEditorAfterBlock(wrapper);
      deletedBlocks.push({ el: wrapper, afterEl });
      wrapper.remove();
      scheduleSave();
    });
  }

  // Initial height
  syncHeight();
}

// ── Init all code blocks ──────────────────────────────────────────────────────
/** Called after setting editor.innerHTML — wires up every .code-block found. */
function initCodeBlocks() {
  editor.querySelectorAll('.code-block').forEach(setupCodeBlock);
}

// ── Code block ↔ editor focus helpers ────────────────────────────────────────

function getNodeRect(node) {
  if (node.nodeType === Node.ELEMENT_NODE) return node.getBoundingClientRect();
  const r = document.createRange();
  r.selectNodeContents(node);
  return r.getBoundingClientRect();
}

function isOnLastVisualLine(range, el) {
  const rRect = range.getBoundingClientRect();
  // Zero-height rect means cursor is at a void node like <br> — treat as boundary
  if (rRect.height === 0) return true;
  return rRect.bottom >= getNodeRect(el).bottom - 2;
}

function isOnFirstVisualLine(range, el) {
  const rRect = range.getBoundingClientRect();
  if (rRect.height === 0) return true;
  return rRect.top <= getNodeRect(el).top + 2;
}

function focusEditorAfterBlock(block) {
  // Skip <br> gaps; if the next real sibling is also a code block, jump into it
  let sib = block.nextSibling;
  while (sib && sib.nodeName === 'BR') sib = sib.nextSibling;
  if (sib && sib.nodeType === Node.ELEMENT_NODE && sib.classList.contains('code-block')) {
    const ta = sib.querySelector('.code-textarea');
    if (ta) { ta.focus(); ta.setSelectionRange(0, 0); }
    return;
  }

  editor.focus();
  const sel = window.getSelection();
  const rng = document.createRange();
  const next = block.nextSibling;
  if (next) {
    if (next.nodeType === Node.TEXT_NODE) rng.setStart(next, 0);
    else rng.setStartBefore(next);
  } else {
    rng.setStartAfter(block);
  }
  rng.collapse(true);
  sel.removeAllRanges();
  sel.addRange(rng);
}

function focusEditorBeforeBlock(block) {
  // Skip <br> gaps; if the previous real sibling is also a code block, jump into it
  let sib = block.previousSibling;
  while (sib && sib.nodeName === 'BR') sib = sib.previousSibling;
  if (sib && sib.nodeType === Node.ELEMENT_NODE && sib.classList.contains('code-block')) {
    const ta = sib.querySelector('.code-textarea');
    if (ta) { const len = ta.value.length; ta.focus(); ta.setSelectionRange(len, len); }
    return;
  }

  editor.focus();
  const sel = window.getSelection();
  const rng = document.createRange();
  const prev = block.previousSibling;
  if (prev) {
    if (prev.nodeType === Node.TEXT_NODE) rng.setStart(prev, prev.nodeValue.length);
    else rng.setStart(prev, prev.childNodes.length);
  } else {
    rng.setStart(editor, 0);
  }
  rng.collapse(true);
  sel.removeAllRanges();
  sel.addRange(rng);
}

/**
 * Ensure the editor has a trailing editable element after any final code block.
 * Without this, clicks and cursor positioning can fall inside the textarea.
 */
function ensureTrailingLine() {
  const last = editor.lastChild;
  if (last && last.nodeType === Node.ELEMENT_NODE && last.classList.contains('code-block')) {
    const trail = document.createElement('div');
    trail.appendChild(document.createElement('br'));
    editor.appendChild(trail);
  }
}

// ── Code block trigger ────────────────────────────────────────────────────────
/**
 * Called from the editor keydown handler when Enter or Space is pressed.
 * Checks if the current "line" in the editor is exactly /language.
 * If so, replaces that line with a new syntax-highlighted code block.
 * Returns true if a code block was inserted (caller should return early).
 */
function tryInsertCodeBlock(e) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;

  const container   = range.startContainer;
  const cursorOffset = range.startOffset;

  // Don't trigger if the cursor is inside an existing code block
  if (container.nodeType === Node.TEXT_NODE &&
      container.parentElement &&
      container.parentElement.closest('.code-block')) return false;

  // ── Find the direct child of the editor that contains the cursor ──
  // In div-per-line mode each paragraph is a <div>; in pre-wrap / BR mode
  // the text sits directly in the editor as text nodes.
  let node = container;
  while (node && node.parentNode !== editor) node = node.parentNode;

  const lineEl = (node && node !== editor && node.nodeType === Node.ELEMENT_NODE)
    ? node : null;

  // ── Extract the text of just the current "line" ──
  // With white-space:pre-wrap, Electron may keep everything in one text node
  // separated by \n characters. We must look only at the text before the
  // cursor, starting from the last newline.
  let lineText = '';
  if (lineEl) {
    lineText = lineEl.textContent.trim();
  } else if (container.nodeType === Node.TEXT_NODE) {
    const beforeCursor = container.nodeValue.slice(0, cursorOffset);
    const lastNL = beforeCursor.lastIndexOf('\n');
    lineText = beforeCursor.slice(lastNL + 1).trim(); // text since last newline
  }

  // Must be exactly /language — nothing else on the line
  const m = lineText.match(/^\/([a-z+]+)$/i);
  if (!m) return false;

  const lang = LANG_ALIASES[m[1].toLowerCase()];
  if (!lang) return false;

  e.preventDefault();

  // ── Build code block and trailing blank line ──
  const tmp = document.createElement('div');
  tmp.innerHTML = createCodeBlockHTML(lang, '');
  const codeBlock = tmp.firstElementChild;
  const trail = document.createElement('div');
  trail.appendChild(document.createElement('br'));

  // ── Splice the trigger out of the DOM and insert the code block ──
  if (lineEl) {
    // Simple case: the trigger is an entire <div> line — just swap it out
    lineEl.replaceWith(codeBlock);
    codeBlock.insertAdjacentElement('afterend', trail);

  } else if (container.nodeType === Node.TEXT_NODE) {
    // Text-node case (pre-wrap / BR-separated lines):
    // Identify what to keep before and after the trigger text.
    const fullText = container.nodeValue;
    const beforeCursor = fullText.slice(0, cursorOffset);
    const lastNL = beforeCursor.lastIndexOf('\n');

    // Text before the trigger line (drop the separating \n too)
    const keepBefore = lastNL >= 0 ? fullText.slice(0, lastNL) : '';
    // Text after the cursor on this same text node
    const keepAfter  = fullText.slice(cursorOffset);

    // Insert new nodes after the container (in reverse order so each
    // call to .after() places the item immediately after container):
    if (keepAfter) container.after(document.createTextNode(keepAfter));
    container.after(trail);
    container.after(codeBlock);

    // Shrink or remove the original text node
    if (keepBefore) {
      container.nodeValue = keepBefore;
    } else {
      container.remove();
    }

  } else {
    // Fallback (shouldn't normally be reached)
    editor.appendChild(codeBlock);
    editor.appendChild(trail);
  }

  setupCodeBlock(codeBlock);
  setTimeout(() => codeBlock.querySelector('.code-textarea').focus(), 10);
  scheduleSave();
  return true;
}

// ── Serialise editor → plain text ─────────────────────────────────────────────
/**
 * Walk the editor's DOM and produce plain text with:
 *   - **bold**, *italic*, __underline__, ~~strikethrough__ markdown markers
 *   - ```lang\ncode\n``` fences for code blocks
 * This replaces the old htmlToText(editor.innerHTML) approach so that code
 * blocks (which are not in innerHTML as plain text) are handled correctly.
 */
function editorToText() {
  const parts = [];

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();

    // Code block → code fence
    if (node.classList && node.classList.contains('code-block')) {
      const lang = node.dataset.lang || '';
      const ta   = node.querySelector('.code-textarea');
      const code = ta ? ta.value : (node.querySelector('code')?.textContent || '');
      parts.push(`\`\`\`${lang}\n${code}\n\`\`\``);
      return;
    }

    // Block elements → leading newline (browser wraps paragraphs in <div>)
    if (tag === 'div' || tag === 'p') parts.push('\n');
    if (tag === 'br') { parts.push('\n'); return; }

    // Inline formatting → markdown markers (wrap children)
    const isB = tag === 'strong' || tag === 'b';
    const isI = tag === 'em'     || tag === 'i';
    const isU = tag === 'u';
    const isS = tag === 's'      || tag === 'del';

    if (isB) parts.push('**');
    if (isI) parts.push('*');
    if (isU) parts.push('__');
    if (isS) parts.push('~~');

    node.childNodes.forEach(walk);

    if (isS) parts.push('~~');
    if (isU) parts.push('__');
    if (isI) parts.push('*');
    if (isB) parts.push('**');
  }

  editor.childNodes.forEach(walk);

  return parts
    .join('')
    .replace(/^\n+/, '')      // strip leading newlines
    .replace(/\n{3,}/g, '\n\n') // collapse excessive blank lines
    .trim();
}

// ── Format conversion (used for loading notes from disk) ─────────────────────
/**
 * Convert plain text (markdown-lite + code fences) → HTML for the editor.
 * Code fences (```lang\ncode\n```) become .code-block HTML via
 * createCodeBlockHTML(). Regular text uses the same inline → html rules as
 * before, now extracted into the helper inlineToHtml().
 */
function inlineToHtml(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Markdown → HTML (order matters: ** before *)
  html = html
    .replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([\s\S]*?)__/g,      '<u>$1</u>')
    .replace(/~~([\s\S]*?)~~/g,      '<s>$1</s>')
    .replace(/\*([\s\S]*?)\*/g,      '<em>$1</em>')
    .replace(/\n/g,                  '<br>');

  return html;
}

function textToHtml(text) {
  // Split on code fences, preserving order
  const FENCE = /```(\w*)\n([\s\S]*?)\n```/g;
  const parts  = [];
  let lastIndex = 0;
  let m;

  while ((m = FENCE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(inlineToHtml(text.slice(lastIndex, m.index)));
    }
    const lang = LANG_ALIASES[m[1].toLowerCase()] || m[1].toLowerCase() || 'text';
    parts.push(createCodeBlockHTML(lang, m[2]));
    lastIndex = FENCE.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(inlineToHtml(text.slice(lastIndex)));
  }

  return parts.join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFilename() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    `note_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.txt`
  );
}

/** Extract MM/DD date from filename like note_20260506_143022.txt */
function filenameToDate(filename) {
  const m = filename.match(/note_\d{4}(\d{2})(\d{2})_/);
  return m ? `${m[2]}/${m[1]}` : '??/??';
}

/** First non-empty line of plain text, stripped of markdown markers */
function firstLine(text) {
  return (text.split('\n').find(l => l.trim() && !l.trim().startsWith('```')) || '(empty)')
    .replace(/[*_~`]/g, '')
    .trim();
}

/** Second non-empty line, if any */
function secondLine(text) {
  const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('```'));
  if (lines.length < 2) return '';
  return lines[1].replace(/[*_~`]/g, '').trim();
}

function flashStatus(msg, ms = 1400) {
  clearTimeout(statusTimer);
  const wasAotOn = statusEl.classList.contains('aot-on');
  statusEl.textContent = msg;
  statusTimer = setTimeout(() => {
    setAotLabel(wasAotOn);
  }, ms);
}

// ── Always-on-top toggle ──────────────────────────────────────────────────────

function setAotLabel(isOn) {
  statusEl.textContent = isOn ? '● Always on Top' : '○ Floating off';
  statusEl.classList.toggle('aot-on',  isOn);
  statusEl.classList.toggle('aot-off', !isOn);
}

statusEl.addEventListener('click', async () => {
  const isNowOn = await window.notesAPI.toggleAlwaysOnTop();
  setAotLabel(isNowOn);
});

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  notesList.innerHTML = '';

  if (allNotes.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:14px 12px;font-size:11px;color:#55555a;font-family:var(--font)';
    empty.textContent = 'No notes yet';
    notesList.appendChild(empty);
    return;
  }

  allNotes.forEach(note => {
    const item  = document.createElement('div');
    item.className = 'note-item' + (note.filename === currentFilename ? ' active' : '');

    const title = firstLine(note.content).slice(0, 22);
    const sub   = secondLine(note.content).slice(0, 24);
    const date  = filenameToDate(note.filename);

    item.innerHTML = `
      <div class="note-item-title">
        ${escHtml(title)} <span class="note-date">(${date})</span>
      </div>
      ${sub ? `<div class="note-item-sub">– ${escHtml(sub)}</div>` : ''}
    `;

    item.addEventListener('click', () => switchToNote(note));
    notesList.appendChild(item);
  });
}

async function switchToNote(note) {
  if (note.filename === currentFilename) return;

  // Save current before switching
  clearTimeout(saveTimer);
  await flushCurrentNote();

  currentFilename  = note.filename;
  editor.innerHTML = textToHtml(note.content);
  initCodeBlocks();
  ensureTrailingLine();
  resetFormatButtons();
  renderSidebar();
  editor.focus();
}

btnSidebar.addEventListener('click', () => {
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('open', sidebarOpen);
  btnSidebar.classList.toggle('active', sidebarOpen);
  if (sidebarOpen) renderSidebar();
});

// ── Find in note ──────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walk every text node inside the editor using TreeWalker, find all matches,
 * and wrap them in <mark class="highlight"> elements.
 * Code blocks are skipped — searching only covers plain text.
 */
function highlightMatches(query) {
  clearHighlights();
  if (!query.trim()) { updateSearchCount(); return; }

  const regex  = new RegExp(escapeRegex(query), 'gi');
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip text nodes that live inside a code block
      if (node.parentElement && node.parentElement.closest('.code-block')) {
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  textNodes.forEach(textNode => {
    const text    = textNode.nodeValue;
    const matches = [...text.matchAll(regex)];
    if (matches.length === 0) return;

    const fragment = document.createDocumentFragment();
    let lastIndex  = 0;

    matches.forEach(match => {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const mark       = document.createElement('mark');
      mark.className   = 'highlight';
      mark.textContent = match[0];
      fragment.appendChild(mark);
      lastIndex = match.index + match[0].length;
    });

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  });

  searchMarks = Array.from(editor.querySelectorAll('mark.highlight'));
  searchIndex = searchMarks.length > 0 ? 0 : -1;
  activateMark(searchIndex);
  updateSearchCount();
}

function clearHighlights() {
  editor.querySelectorAll('mark.highlight').forEach(mark => {
    mark.replaceWith(...mark.childNodes);
  });
  editor.normalize();
  searchMarks = [];
  searchIndex = -1;
}

function activateMark(index) {
  searchMarks.forEach((m, i) => m.classList.toggle('active', i === index));
  if (searchMarks[index]) {
    searchMarks[index].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function navigateMatch(dir) {
  if (searchMarks.length === 0) return;
  searchIndex = (searchIndex + dir + searchMarks.length) % searchMarks.length;
  activateMark(searchIndex);
  updateSearchCount();
}

function updateSearchCount() {
  if (!searchInput.value.trim()) { searchCount.textContent = ''; return; }
  if (searchMarks.length === 0)  { searchCount.textContent = 'No results'; return; }
  searchCount.textContent = `${searchIndex + 1} / ${searchMarks.length}`;
}

function openSearch() {
  searchOpen = true;
  searchBar.classList.add('open');
  btnSearch.classList.add('active');
  searchInput.focus();
  searchInput.select();
  if (searchInput.value.trim()) highlightMatches(searchInput.value);
}

function closeSearch() {
  searchOpen = false;
  searchBar.classList.remove('open');
  btnSearch.classList.remove('active');
  clearHighlights();
  searchCount.textContent = '';
  searchInput.value = '';
  editor.focus();
}

btnSearch.addEventListener('click', () => {
  searchOpen ? closeSearch() : openSearch();
});

searchInput.addEventListener('input', () => {
  highlightMatches(searchInput.value);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    navigateMatch(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    closeSearch();
  }
});

document.getElementById('search-prev').addEventListener('click',  () => navigateMatch(-1));
document.getElementById('search-next').addEventListener('click',  () => navigateMatch(1));
document.getElementById('search-close').addEventListener('click', () => closeSearch());

// ── Save ──────────────────────────────────────────────────────────────────────

async function flushCurrentNote() {
  if (!currentFilename) return;
  const content = editorToText();
  if (!content) return;
  await window.notesAPI.save(currentFilename, content);
  // Update in-memory cache
  const idx = allNotes.findIndex(n => n.filename === currentFilename);
  if (idx >= 0) {
    allNotes[idx].content = content;
    allNotes[idx].mtime   = Date.now();
  } else {
    allNotes.unshift({ filename: currentFilename, content, mtime: Date.now() });
  }
}

function scheduleSave() {
  // Don't save while search is active — the DOM contains <mark> tags
  if (searchOpen) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!currentFilename) currentFilename = makeFilename();
    await flushCurrentNote();
    if (sidebarOpen) renderSidebar();
    flashStatus('Saved  ·  Always on Top');
  }, 400);
}

editor.addEventListener('input', scheduleSave);

// ── New note ──────────────────────────────────────────────────────────────────
btnNew.addEventListener('click', async () => {
  clearTimeout(saveTimer);
  await flushCurrentNote();

  editor.innerHTML = '';
  currentFilename  = makeFilename();
  resetFormatButtons();
  editor.focus();
  if (sidebarOpen) renderSidebar();
  flashStatus('New note');
});

// ── Delete note ───────────────────────────────────────────────────────────────
btnDelete.addEventListener('click', async () => {
  clearTimeout(saveTimer);

  if (currentFilename) {
    await window.notesAPI.delete(currentFilename);
    allNotes = allNotes.filter(n => n.filename !== currentFilename);
  }

  if (allNotes.length > 0) {
    currentFilename  = allNotes[0].filename;
    editor.innerHTML = textToHtml(allNotes[0].content);
    initCodeBlocks();
    ensureTrailingLine();
  } else {
    editor.innerHTML = '';
    currentFilename  = makeFilename();
  }

  if (sidebarOpen) renderSidebar();
  editor.focus();
  flashStatus('Deleted');
});

// ── Font size ─────────────────────────────────────────────────────────────────
fontSizeEl.addEventListener('change', () => {
  const size = parseInt(fontSizeEl.value, 10);
  if (!isNaN(size) && size >= 8 && size <= 72) {
    editor.style.fontSize = size + 'px';
  }
});
fontSizeEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { fontSizeEl.blur(); editor.focus(); }
});

// ── Format buttons ────────────────────────────────────────────────────────────
// Pure manual toggles — clicking lights the button up, clicking again dims it.
// The cursor position never re-engages or disengages a button automatically.

const fmtState = { bold: false, italic: false, underline: false, strikeThrough: false };

function applyFormat(cmd) {
  editor.focus();
  const btn = document.querySelector(`.fmt-btn[data-cmd="${cmd}"]`);
  if (!btn) return;

  const willActivate = !btn.classList.contains('active');

  if (willActivate !== fmtState[cmd]) {
    document.execCommand(cmd, false, null);
  }

  fmtState[cmd] = willActivate;
  btn.classList.toggle('active');
}

function resetFormatButtons() {
  Object.keys(fmtState).forEach(cmd => {
    if (fmtState[cmd]) {
      document.execCommand(cmd, false, null);
      fmtState[cmd] = false;
    }
  });
  document.querySelectorAll('.fmt-btn').forEach(btn => btn.classList.remove('active'));
}

document.querySelectorAll('.fmt-btn').forEach(btn => {
  btn.addEventListener('mousedown', e => e.preventDefault()); // keep selection
  btn.addEventListener('click', () => applyFormat(btn.dataset.cmd));
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
editor.addEventListener('keydown', e => {
  // Code block trigger: /language + Enter or Space
  if (e.key === 'Enter' || e.key === ' ') {
    if (tryInsertCodeBlock(e)) return;
  }

  // Arrow key navigation into adjacent code blocks (synchronous pre-check).
  // We inspect where the cursor is BEFORE the browser moves it. If it is on
  // the last visual line above a code block (ArrowDown) or the first visual
  // line below one (ArrowUp), we intercept and focus the textarea directly.
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const goingDown = e.key === 'ArrowDown';
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      let lineEl = range.startContainer;
      while (lineEl && lineEl.parentNode !== editor) lineEl = lineEl.parentNode;

      if (lineEl && lineEl !== editor) {
        if (goingDown) {
          let sib = lineEl.nextSibling;
          while (sib && sib.nodeName === 'BR') sib = sib.nextSibling;
          if (sib && sib.nodeType === Node.ELEMENT_NODE && sib.classList.contains('code-block') &&
              isOnLastVisualLine(range, lineEl)) {
            e.preventDefault();
            const ta = sib.querySelector('.code-textarea');
            if (ta) { ta.focus(); ta.setSelectionRange(0, 0); }
          }
        } else {
          let sib = lineEl.previousSibling;
          while (sib && sib.nodeName === 'BR') sib = sib.previousSibling;
          if (sib && sib.nodeType === Node.ELEMENT_NODE && sib.classList.contains('code-block') &&
              isOnFirstVisualLine(range, lineEl)) {
            e.preventDefault();
            const ta = sib.querySelector('.code-textarea');
            if (ta) { const len = ta.value.length; ta.focus(); ta.setSelectionRange(len, len); }
          }
        }
      }

      // Prevent browser wrap-around: at the very top/bottom of the editor the
      // browser moves the cursor to the opposite end of the content. Block it.
      // Skip when rRect.height === 0 (cursor in a <br>/empty line) — those
      // positions always return true from isOnFirst/LastVisualLine and would
      // freeze both arrow keys.
      const rRect = range.getBoundingClientRect();
      if (rRect.height > 0) {
        const edRect = editor.getBoundingClientRect();
        if (!goingDown && rRect.top    <= edRect.top    + 2) e.preventDefault();
        if (goingDown  && rRect.bottom >= edRect.bottom - 2) e.preventDefault();
      }
    }
  }

  // Guard: prevent Backspace / Delete from swallowing an adjacent code block.
  // beforeinput's getTargetRanges() only returns the merge-boundary, not the
  // block itself, so intersectsNode() always misses it. keydown is reliable.
  if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.getRangeAt(0).collapsed) {
      const range     = sel.getRangeAt(0);
      const container = range.startContainer;
      const offset    = range.startOffset;
      let adjacent    = null;

      // Returns true for nodes that are "visually empty" — BRs, whitespace text,
      // or elements whose every descendant is one of those (e.g. <div><br><br></div>).
      function isVisuallyEmpty(n) {
        if (!n) return false;
        if (n.nodeName === 'BR') return true;
        if (n.nodeType === Node.TEXT_NODE) return n.nodeValue.trim() === '';
        if (n.nodeType === Node.ELEMENT_NODE)
          return n.childNodes.length > 0 && [...n.childNodes].every(isVisuallyEmpty);
        return false;
      }

      if (e.key === 'Backspace') {
        if (container === editor) {
          adjacent = offset > 0 ? editor.childNodes[offset - 1] : null;
        } else {
          let node = container;
          while (node && node !== editor && node.parentNode !== editor) node = node.parentNode;
          if (node && node !== editor) {
            const isLineStart = offset === 0;
            const isEmptyLine = node.nodeType === Node.ELEMENT_NODE && isVisuallyEmpty(node);
            if (isLineStart || isEmptyLine) adjacent = node.previousSibling;
          }
        }
        while (adjacent && isVisuallyEmpty(adjacent)) adjacent = adjacent.previousSibling;
      } else {
        const atEnd = container.nodeType === Node.TEXT_NODE
          ? offset === container.nodeValue.length
          : offset === container.childNodes.length;
        if (container === editor) {
          adjacent = editor.childNodes[offset] || null;
        } else if (atEnd) {
          let node = container;
          while (node && node !== editor && node.parentNode !== editor) node = node.parentNode;
          if (node && node !== editor) adjacent = node.nextSibling;
        }
        while (adjacent && isVisuallyEmpty(adjacent)) adjacent = adjacent.nextSibling;
      }

      if (adjacent && adjacent.nodeType === Node.ELEMENT_NODE && adjacent.classList.contains('code-block')) {
        e.preventDefault();
      }
    }
  }

  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'z': {
        // Restore the most recently X-deleted code block before falling through to browser undo
        if (deletedBlocks.length > 0) {
          e.preventDefault();
          const { el, afterEl } = deletedBlocks.pop();
          if (afterEl && afterEl.parentNode === editor) editor.insertBefore(el, afterEl);
          else editor.appendChild(el);
          setupCodeBlock(el);
          scheduleSave();
        }
        break;
      }
      case 'b': e.preventDefault(); applyFormat('bold');      break;
      case 'i': e.preventDefault(); applyFormat('italic');    break;
      case 'u': e.preventDefault(); applyFormat('underline'); break;
      case 'n': e.preventDefault(); btnNew.click();           break;
      case 'f': e.preventDefault(); openSearch();             break;
    }
  }
  if (e.key === 'Escape' && searchOpen) closeSearch();
});

// Also catch Ctrl+F from anywhere in the window (e.g. when sidebar is focused)
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openSearch();
  }
});


// ── Re-wire code blocks restored by Ctrl+Z ────────────────────────────────────
// Direct DOM removal bypasses the browser's undo stack; we use execCommand
// instead. When Ctrl+Z restores the HTML the event listeners are gone, so this
// observer calls setupCodeBlock again on any unwired (.code-block) node.
const codeBlockObserver = new MutationObserver(() => {
  editor.querySelectorAll('.code-block:not([data-wired])').forEach(block => {
    setupCodeBlock(block);
  });
});
codeBlockObserver.observe(editor, { childList: true });

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  allNotes = await window.notesAPI.loadAll();  // newest first

  if (allNotes.length > 0) {
    currentFilename  = allNotes[0].filename;
    editor.innerHTML = textToHtml(allNotes[0].content);
    initCodeBlocks();
    ensureTrailingLine();
  } else {
    currentFilename = makeFilename();
  }

  // Always-on-top starts ON
  setAotLabel(true);

  editor.focus();
  // Move caret to end
  const sel = window.getSelection();
  const rng = document.createRange();
  rng.selectNodeContents(editor);
  rng.collapse(false);
  sel.removeAllRanges();
  sel.addRange(rng);
}

init();
