// ─────────────────────────────────────────────────────────────────────────────
//  main.js  –  Electron main process
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Notes directory ───────────────────────────────────────────────────────────
// Saved to the user's Documents folder so they're easy to find and open
// in any text editor: C:\Users\<you>\Documents\WhiplashNotes\
const NOTES_DIR      = path.join(app.getPath('documents'), 'WhiplashNotes');
const WIN_STATE_FILE = path.join(app.getPath('userData'),  'window-state.json');

function ensureNotesDir() {
  if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });
}

// ── Window state persistence ──────────────────────────────────────────────────
function loadWinState() {
  try {
    const state = JSON.parse(fs.readFileSync(WIN_STATE_FILE, 'utf8'));
    // Make sure the top-left corner is still on a connected display
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      state.x >= a.x && state.x < a.x + a.width &&
      state.y >= a.y && state.y < a.y + a.height
    );
    if (onScreen) return state;          // { x, y, width, height }
  } catch { /* first run or corrupt file */ }
  return { width: 680, height: 420 };   // defaults — Electron centres automatically
}

function saveWinState(win) {
  if (win.isMinimized() || win.isMaximized()) return;
  try { fs.writeFileSync(WIN_STATE_FILE, JSON.stringify(win.getBounds()), 'utf8'); }
  catch { /* non-fatal */ }
}

// ── Window ────────────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  const winState = loadWinState();

  mainWindow = new BrowserWindow({
    ...winState,            // x, y, width, height (or just width/height on first run)
    minWidth:       340,
    minHeight:      200,
    frame:          false,
    transparent:    true,
    roundedCorners: true,
    alwaysOnTop:    true,
    resizable:      true,
    hasShadow:      true,
    icon:           path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      devTools:         false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.loadFile('index.html');

  mainWindow.on('close', () => saveWinState(mainWindow));
}

// ── IPC: File operations ──────────────────────────────────────────────────────

// Save note as plain text (.txt) — readable in any editor
ipcMain.handle('notes:save', (_event, { filename, content }) => {
  ensureNotesDir();
  fs.writeFileSync(path.join(NOTES_DIR, filename), content, 'utf8');
  return { ok: true };
});

// Delete a note file
ipcMain.handle('notes:delete', (_event, filename) => {
  const fp = path.join(NOTES_DIR, filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  return { ok: true };
});

// Return all notes sorted newest → oldest
ipcMain.handle('notes:loadAll', () => {
  ensureNotesDir();
  return fs.readdirSync(NOTES_DIR)
    .filter(f => f.endsWith('.txt'))
    .map(filename => {
      const fp   = path.join(NOTES_DIR, filename);
      const stat = fs.statSync(fp);
      return { filename, content: fs.readFileSync(fp, 'utf8'), mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
});

// ── IPC: Window controls ──────────────────────────────────────────────────────

// Toggle always-on-top and return the new state
ipcMain.handle('window:toggleAlwaysOnTop', () => {
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next, 'screen-saver');
  return next;
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureNotesDir();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
