// ─────────────────────────────────────────────────────────────────────────────
//  main.js  –  Electron main process
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Notes directory ───────────────────────────────────────────────────────────
// Saved to the user's Documents folder so they're easy to find and open
// in any text editor: C:\Users\<you>\Documents\WhiplashNotes\
const NOTES_DIR = path.join(app.getPath('documents'), 'WhiplashNotes');

function ensureNotesDir() {
  if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });
}

// ── Window ────────────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:          680,
    height:         420,
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
