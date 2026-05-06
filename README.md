# Whiplash Notes

An ultra-minimalist, always-on-top note-taking app for Windows 11. Built for video note-taking — it floats above every other window so you never lose your place.

---

## Download

Grab the latest `.exe` from the [Releases](../../releases) page. No installation needed — just double-click and it opens.

> If Windows shows a SmartScreen warning, click **More info → Run anyway**. This is normal for unsigned indie apps.

---

## Features

- **Always on Top** — floats above every other window, including video players. Click the status text in the bottom-right corner to toggle it on/off whenever you need.
- **Frameless dark UI** — deep charcoal background, rounded corners, no distracting title bar.
- **Rich text formatting** — Bold, Italic, Underline, and Strikethrough via toolbar buttons or `Ctrl+B / I / U`.
- **Adjustable font size** — change it on the fly from the toolbar.
- **Notes sidebar** — click the ≡ button to see all your saved notes and switch between them.
- **Auto-save** — every keystroke is saved automatically after a short pause. No manual saving ever.
- **Plain `.txt` files** — notes are saved to `Documents\WhiplashNotes\` as readable text files you can open in Notepad, VS Code, or any editor.
- **100% offline** — zero cloud, zero analytics, zero external connections.

---

## Running from Source

Requires [Node.js](https://nodejs.org) (LTS).

```bash
git clone https://github.com/SwopnilSunder/whiplash-notes.git
cd whiplash-notes
npm install
npm start
```

To build the portable `.exe` yourself:

```bash
npm run dist
```

The output will be in the `dist/` folder.

---

## Where are my notes saved?

```
C:\Users\<you>\Documents\WhiplashNotes\
```

Each note is a plain `.txt` file named by date and time (e.g. `note_20260506_143022.txt`). You can open, edit, back up, or sync them with anything you like.

---

## Tech Stack

- [Electron](https://www.electronjs.org/) — cross-platform desktop shell
- Vanilla JavaScript, HTML, CSS — no frameworks
- Node.js `fs` module — local file storage

---

## License

MIT — do whatever you want with it.
