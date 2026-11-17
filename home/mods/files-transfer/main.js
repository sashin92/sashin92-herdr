// A lazy file browser for the focused pane's folder, with bounded read-only previews.
// Made from Herdr's files mod, with file transfer for spaces on another machine:
//
//   down  the arrow on a row under the pointer (and beside an open file's name)
//         copies that file or folder to ~/Downloads here; a name already taken
//         there gets " (1)", " (2)"…
//   up    files and folders dropped from Finder onto a folder's row go into that
//         folder; onto a file's row, into the folder it is in; onto the title or
//         below the list, into the folder shown. Nothing there is replaced: a
//         name already taken stops the whole drop.
//
// Both go through scp to the address the machine was added with (`hc machine
// ls`), so they need the same ssh setup Herdr used, and can't reach a machine
// added through a command (--via). hc's own `put` stops at 16 MB and has no
// way back. On this computer the rows do neither: Finder already does.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, hc, home, readTextFile, watchFolder, theme, settings, window } from "herdr";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const SCP = ["-q", "-r", "-p", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
// $1: the remote file as scp names it, $2: its name. Prints where it landed.
const DOWNLOAD = 'd="$HOME/Downloads"; mkdir -p "$d" || exit 1; n="$2"; case "$n" in ?*.*) stem="${n%.*}"; ext=".${n##*.}";; *) stem="$n"; ext="";; esac; t="$d/$n"; i=1; while [ -e "$t" ]; do t="$d/$stem ($i)$ext"; i=$((i+1)); done; scp ' + SCP.join(" ") + ' "$1" "$t" && printf %s "$t"';
// $1: a folder, the rest: names. Prints the names that folder already has.
const TAKEN = 'cd "$1" || exit 2; shift; for n; do if [ -e "$n" ] || [ -L "$n" ]; then printf "%s\\n" "$n"; fi; done';
const problem = (r, fallback) => (r.stderr || r.stdout || fallback).trim().split("\n").pop();

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    // Transfers: one at a time; `note` says how the last one went until the next.
    this.busy = false; this.note = null; this.hover = null;
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  // The address scp reaches a machine at: the one it was added with.
  async target(on) {
    const r = await hc(["machine", "ls", "--json"]);
    const m = r.code === 0 ? (JSON.parse(r.stdout).machines ?? []).find((k) => k.name === on) : null;
    if (!m) throw new Error(`${on} is not a machine hc knows`);
    if (m.via) throw new Error(`${on} was added through a command, which scp can't use`);
    return m.target;
  }

  // A file or folder of the machine, into ~/Downloads here.
  download(path, cx) {
    if (this.busy || !this.on) return;
    const on = this.on, from = `${this.root}/${path}`, name = path.split("/").pop();
    this.busy = true; this.note = { text: `Downloading ${name}…` };
    cx.spawn(async (cx) => {
      try {
        const target = await this.target(on);
        const r = await exec("sh", ["-c", DOWNLOAD, "download", `${target}:${from}`, name], { timeout: 600000 });
        if (r.code !== 0) throw new Error(problem(r, "scp failed"));
        const at = r.stdout.trim();
        this.note = { text: `Downloaded to ${at.startsWith(home()) ? "~" + at.slice(home().length) : at}` };
      } catch (e) { this.note = { text: `Download failed: ${e.message ?? e}`, error: true }; }
      finally { this.busy = false; cx.notify(); }
    });
    cx.notify();
  }

  // Dropped files and folders, into `folder` (a path under the root, "" for the root) on the machine.
  upload(folder, paths, cx) {
    if (this.busy || !this.on || !paths?.length) return;
    const on = this.on, context = this.context, to = folder ? `${this.root}/${folder}` : this.root;
    const names = paths.map((p) => p.replace(/\/+$/, "").split("/").pop());
    const what = names.length === 1 ? names[0] : `${names.length} items`;
    this.busy = true; this.note = { text: `Uploading ${what}…` };
    cx.spawn(async (cx) => {
      try {
        const target = await this.target(on);
        const taken = await exec("sh", ["-c", TAKEN, "taken", to, ...names], { on });
        if (taken.code !== 0) throw new Error(problem(taken, "cannot open that folder"));
        const clash = taken.stdout.split("\n").filter(Boolean);
        if (clash.length) throw new Error(`${clash.join(", ")} already there; nothing was sent`);
        const r = await exec("scp", [...SCP, ...paths, `${target}:${to}/`], { timeout: 600000 });
        if (r.code !== 0) throw new Error(problem(r, "scp failed"));
        this.note = { text: `Uploaded ${what} to ${folder || to.split("/").pop()}` };
        if (this.current(context)) {
          // Show where it went: the folder unfolded and read again.
          if (folder) for (let parts = folder.split("/"), i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
          this.refresh(cx);
        }
      } catch (e) { this.note = { text: `Upload failed: ${e.message ?? e}`, error: true }; }
      finally { this.busy = false; cx.notify(); }
    });
    cx.notify();
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  downloadButton(path, t) {
    return div().id(`download-${path}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.muted)
      .hover(s => s.bg(t.raised).text_color(t.foreground)).tooltip("Download to ~/Downloads on this computer")
      // The row under it opens the file on a click: the press stays here.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.download(path, cx); })
      .child(svg("mods/files-transfer/download.svg").size(13));
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .on_hover((over, cx) => { if (over) this.hover = path; else if (this.hover === path) this.hover = null; cx.notify(); })
        .when(Boolean(this.on), el => el.on_drop((e, cx) => this.upload(entry.dir ? path : prefix, e.paths, cx)))
        .child(entry.dir ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)))
        .when(Boolean(this.on) && this.hover === path && !this.busy, el => el.child(this.downloadButton(path, t))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().id("files-head").h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.on) && !this.file, el => el.on_drop((e, cx) => this.upload("", e.paths, cx)))
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        .when(Boolean(this.on) && Boolean(this.file) && !this.busy, el => el.child(this.downloadButton(this.file, t))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))
        // Room under the last row to drop into the folder shown.
        .when(Boolean(this.on), el => el.child(div().id("files-drop").h(72).flex_none().on_drop((e, cx) => this.upload("", e.paths, cx))))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")))
      // How the last transfer went (a click puts it away), else what the rows can do on another machine.
      .when(Boolean(this.note) || Boolean(this.on), el => el.child(div().id("files-note").flex_none().px(12).py(7).border_t(1).border_color(t.border).text_size(11)
        .text_color(this.note?.error ? t.ansi1 : this.note ? t.foreground : t.dim)
        .when(Boolean(this.note) && !this.busy, n => n.cursor_pointer().on_click((_e, cx) => { this.note = null; cx.notify(); }))
        .child(this.note?.text ?? "Drop files on a folder to upload · ↓ on a row downloads")));
  }
}
