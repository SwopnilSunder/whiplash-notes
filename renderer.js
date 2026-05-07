// ─────────────────────────────────────────────────────────────────────────────
//  renderer.js  –  All editor logic
//
//  Features:
//    • Save as plain .txt (with simple markdown for bold/italic/etc.)
//    • Load most recent note on startup
//    • 400ms debounced auto-save
//    • Sidebar listing all notes — click to switch
//    • Always-on-top toggle via status bar click
//    • B/I/U/S formatting + Ctrl+B/I/U/N shortcuts
//    • New note (+) and delete (🗑) with correct sidebar updates
//    • Find in note — Ctrl+F, TreeWalker highlights, Prev/Next navigation
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

// ── Format conversion ─────────────────────────────────────────────────────────
// Notes are saved as plain .txt with lightweight markdown so they read well
// in Notepad, VS Code, or any other editor. Formatting round-trips cleanly.

/**
 * Convert contenteditable innerHTML → plain text with markdown markers.
 * This is what gets written to the .txt file on disk.
 */
function htmlToText(html) {
  return html
    // Block elements → newlines
    .replace(/<div>/gi,   '\n')
    .replace(/<\/div>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    // Inline formatting → markdown
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b>([\s\S]*?)<\/b>/gi,           '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/gi,         '*$1*')
    .replace(/<i>([\s\S]*?)<\/i>/gi,           '*$1*')
    .replace(/<u>([\s\S]*?)<\/u>/gi,           '__$1__')
    .replace(/<s>([\s\S]*?)<\/s>/gi,           '~~$1~~')
    .replace(/<del>([\s\S]*?)<\/del>/gi,       '~~$1~~')
    // Strip any remaining tags, decode entities
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&nbsp;/g,  ' ')
    .trim();
}

/**
 * Convert plain text (with markdown markers) → HTML for the contenteditable.
 * Called when loading a note from disk.
 */
function textToHtml(text) {
  // Escape HTML special chars first so we don't interpret existing < > in notes
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Apply markdown → HTML (order matters: ** before *)
  html = html
    .replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([\s\S]*?)__/g,      '<u>$1</u>')
    .replace(/~~([\s\S]*?)~~/g,      '<s>$1</s>')
    .replace(/\*([\s\S]*?)\*/g,      '<em>$1</em>')
    .replace(/\n/g,                  '<br>');

  return html;
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
  return (text.split('\n').find(l => l.trim()) || '(empty)')
    .replace(/[*_~]/g, '')
    .trim();
}

/** Second non-empty line, if any */
function secondLine(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return '';
  return lines[1].replace(/[*_~]/g, '').trim();
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

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function switchToNote(note) {
  if (note.filename === currentFilename) return;

  // Save current before switching
  clearTimeout(saveTimer);
  await flushCurrentNote();

  currentFilename  = note.filename;
  editor.innerHTML = textToHtml(note.content);
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

/** Escape special regex characters in the user's search string */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walk every text node inside the editor using TreeWalker, find all matches,
 * and wrap them in <mark class="highlight"> elements.
 * TreeWalker is used (instead of innerHTML regex) because it correctly handles
 * text that spans across formatting tags like <strong> or <em>.
 */
function highlightMatches(query) {
  clearHighlights();
  if (!query.trim()) { updateSearchCount(); return; }

  const regex    = new RegExp(escapeRegex(query), 'gi');
  const walker   = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];

  // Collect all text nodes first (modifying the DOM while walking breaks the walker)
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  textNodes.forEach(textNode => {
    const text    = textNode.nodeValue;
    const matches = [...text.matchAll(regex)];
    if (matches.length === 0) return;

    const fragment = document.createDocumentFragment();
    let lastIndex  = 0;

    matches.forEach(match => {
      // Plain text before this match
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      // The match itself, wrapped in <mark>
      const mark       = document.createElement('mark');
      mark.className   = 'highlight';
      mark.textContent = match[0];
      fragment.appendChild(mark);
      lastIndex = match.index + match[0].length;
    });

    // Any remaining text after the last match
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  });

  // Collect all inserted marks and activate the first one
  searchMarks = Array.from(editor.querySelectorAll('mark.highlight'));
  searchIndex = searchMarks.length > 0 ? 0 : -1;
  activateMark(searchIndex);
  updateSearchCount();
}

/** Remove all <mark> elements, restoring plain text nodes */
function clearHighlights() {
  editor.querySelectorAll('mark.highlight').forEach(mark => {
    // replaceWith spreads child nodes back into the parent
    mark.replaceWith(...mark.childNodes);
  });
  editor.normalize(); // merge adjacent text nodes back together
  searchMarks = [];
  searchIndex = -1;
}

/** Highlight the active mark and scroll it into view */
function activateMark(index) {
  searchMarks.forEach((m, i) => m.classList.toggle('active', i === index));
  if (searchMarks[index]) {
    searchMarks[index].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/** Move to the next (+1) or previous (-1) match */
function navigateMatch(dir) {
  if (searchMarks.length === 0) return;
  searchIndex = (searchIndex + dir + searchMarks.length) % searchMarks.length;
  activateMark(searchIndex);
  updateSearchCount();
}

/** Update the "2 / 7" counter next to the search input */
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
  // If there's already a query in the box, re-highlight immediately
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

// Search button in toolbar
btnSearch.addEventListener('click', () => {
  searchOpen ? closeSearch() : openSearch();
});

// Re-highlight live as the user types
searchInput.addEventListener('input', () => {
  highlightMatches(searchInput.value);
});

// Enter = next match, Shift+Enter = previous, Escape = close
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
  const content = htmlToText(editor.innerHTML);
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
  // that must not be written to the .txt file
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
    // Load the next most-recent note
    currentFilename  = allNotes[0].filename;
    editor.innerHTML = textToHtml(allNotes[0].content);
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

// Our own authoritative record of the browser's pending format state.
// We update it every time we call execCommand, so we never have to ask
// the browser (queryCommandState / DOM walk) — both are unreliable for
// detecting pending state vs. inherited-from-surrounding-text state.
const fmtState = { bold: false, italic: false, underline: false, strikeThrough: false };

/**
 * Apply a format and keep fmtState in sync.
 * execCommand is a toggle — we only call it when it would move in the
 * direction we want. fmtState tells us the true current pending state.
 */
function applyFormat(cmd) {
  editor.focus();
  const btn = document.querySelector(`.fmt-btn[data-cmd="${cmd}"]`);
  if (!btn) return;

  const willActivate = !btn.classList.contains('active');

  // Call execCommand only when its toggle would produce the right result.
  // fmtState[cmd] is what the browser's pending state actually is right now.
  if (willActivate !== fmtState[cmd]) {
    document.execCommand(cmd, false, null);
  }

  fmtState[cmd] = willActivate;
  btn.classList.toggle('active');
}

/**
 * Reset all format buttons AND cancel any pending browser format state.
 * Called on new note, note switch, and note delete so formats never
 * bleed across into a fresh editing context.
 */
function resetFormatButtons() {
  Object.keys(fmtState).forEach(cmd => {
    if (fmtState[cmd]) {
      // Browser pending state is ON — call execCommand to turn it OFF
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
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
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

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  allNotes = await window.notesAPI.loadAll();  // newest first

  if (allNotes.length > 0) {
    currentFilename  = allNotes[0].filename;
    editor.innerHTML = textToHtml(allNotes[0].content);
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
