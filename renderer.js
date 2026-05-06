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
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Element refs ──────────────────────────────────────────────────────────────
const editor     = document.getElementById('editor');
const fontSizeEl = document.getElementById('font-size');
const statusEl   = document.getElementById('status-text');
const btnNew     = document.getElementById('btn-new');
const btnDelete  = document.getElementById('btn-delete');
const btnSidebar = document.getElementById('btn-sidebar');
const sidebar    = document.getElementById('sidebar');
const notesList  = document.getElementById('notes-list');

// ── State ─────────────────────────────────────────────────────────────────────
let currentFilename = null;
let allNotes        = [];    // in-memory cache: [{ filename, content, mtime }]
let sidebarOpen     = false;
let saveTimer       = null;
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
  renderSidebar();
  editor.focus();
}

btnSidebar.addEventListener('click', () => {
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('open', sidebarOpen);
  btnSidebar.classList.toggle('active', sidebarOpen);
  if (sidebarOpen) renderSidebar();
});

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
function applyFormat(cmd) {
  editor.focus();
  document.execCommand(cmd, false, null);
}

document.querySelectorAll('.fmt-btn').forEach(btn => {
  btn.addEventListener('mousedown', e => e.preventDefault()); // keep selection
  btn.addEventListener('click',     () => applyFormat(btn.dataset.cmd));
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
editor.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'b': e.preventDefault(); applyFormat('bold');      break;
      case 'i': e.preventDefault(); applyFormat('italic');    break;
      case 'u': e.preventDefault(); applyFormat('underline'); break;
      case 'n': e.preventDefault(); btnNew.click();           break;
    }
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
