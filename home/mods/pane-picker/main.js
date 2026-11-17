// Go to a space, a tab or a pane. A tree: machines are the big groups (this
// computer, then the others); under each its spaces, folded; a space unfolds
// into its tabs and a tab into its panes (program, folder, title, terminal
// address). ↑/↓ or k/j move, → or l unfolds, ← or h folds, Enter goes, Esc
// leaves. No filter box: the tree is short enough to walk.
//
// Beside the list, a preview as text (`hc read`), refreshed while the picker
// is open: a pane alone, or a tab's panes where its splits put them (a space:
// its shown tab). The splits come from each machine's `herdr-app` document.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, run, hc, exec, checking, theme, settings, props, closeOverlay, shared, setShared, window as appWindow } from "herdr";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const BODY = 640;
const LIST_W = 600;
const GAP = 8;
const H = { machine: 42, space: 32, tab: 28, pane: 28 };

// Space colors, the same way the other mods pick them (shared "space.colors").
const PROJECT_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
function spaceColors() {
  const ids = new Set(spaces().map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
  for (const p of spaces()) {
    if (kept[p.id] || p.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[p.id] = PROJECT_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  if (changed) setShared("space.colors", kept);
  return kept;
}
function spaceColor(t, p) {
  if (p.name === "~") return t.dim;
  const c = spaceColors()[p.id] ?? PROJECT_COLORS[0];
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
}

// Home as "~", on other machines too (their home isn't known here).
function folder(cwd) {
  return (cwd ?? "").replace(/^\/(home|Users)\/[^/]+(?=\/|$)/, "~");
}

// Terminal text over the terminals' background. A theme's own ink can be as
// dark as that background (Herdr 98: black on black), so fall back on contrast.
const lum = (c) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c ?? "");
  return m ? (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255 : null;
};
function ink(t) {
  if (t.terminal_foreground) return t.terminal_foreground;
  const bg = lum(t.background);
  const fg = lum(t.foreground);
  if (bg === null || fg === null || Math.abs(bg - fg) > 0.4) return t.foreground;
  return bg < 0.5 ? "#e6e7e9" : "#1f2328";
}

// A tab's split tree (rows and columns of weighted children) as one box per
// pane, in 0..1 of the tab. `prefix`: "machine/" for another machine's ids.
function boxes(node, x, y, w, h, prefix, out) {
  if (node.type === "block") {
    out.push({ x, y, w, h, pane: prefix + node.id });
    return out;
  }
  const kids = node.children ?? [];
  const sum = kids.reduce((a, k) => a + (k.size?.weight ?? 1), 0) || 1;
  let at = 0;
  for (const k of kids) {
    const share = (k.size?.weight ?? 1) / sum;
    if (node.type === "column") boxes(k, x, y + at * h, w, share * h, prefix, out);
    else boxes(k, x + at * w, y, share * w, h, prefix, out);
    at += share;
  }
  return out;
}

// `hc connect` reads its requests from stdin, one per line, and exec() has no
// stdin to give: the platform's shell pipes them in.
function askCore(lines) {
  if (appWindow()?.platform === "windows") {
    const quoted = lines.map((l) => `'${l.replace(/'/g, "''")}'`).join(",");
    return exec("powershell", ["-NoProfile", "-Command", `${quoted} | hc connect`]);
  }
  return exec("sh", ["-c", 'printf "%s\\n" "$1" | hc connect', "sh", lines.join("\n")]);
}

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const keyOf = (r) => (r.kind === "space" ? `s:${r.w.id}` : r.kind === "tab" ? `t:${r.tab.id}` : `p:${r.p.pane}`);
const pickable = (rows) => rows.filter((r) => r.kind !== "machine");
const VI = { h: "left", j: "down", k: "up", l: "right", "ㅗ": "left", "ㅓ": "down", "ㅏ": "up", "ㅣ": "right" };

export default class PanePicker extends View {
  init(_props, cx) {
    // The keys come to this view itself: it has no text box to hold them.
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(600, () => this.handle.focus());
    // The selected row's key, and the unfolded spaces' and tabs' ids.
    this.sel = null;
    this.open = new Set();
    this.scroll = 0;
    // Screens read so far, by terminal address; each tab's boxes, by tab id.
    this.shots = {};
    this.trees = {};
    this.loadTrees(cx);
    this.load(cx);
    cx.timer.every(1500, (cx) => this.load(cx));
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    const all = panes();
    const out = [];
    let head = null;
    for (const w of spaces()) {
      const machine = w.machine ?? "This computer";
      const tabs = [];
      let n = 0;
      for (const tab of w.tabs) {
        const mine = [];
        for (const p of all) {
          if (p.tab !== tab.id) continue;
          const name = p.terminal ? (p.program?.name ?? "terminal") : (p.mod ?? "mod");
          mine.push({ kind: "pane", w, tab, p, name });
        }
        tabs.push({ tab, mine });
        n += mine.length;
      }
      if (head?.name !== machine) out.push((head = { kind: "machine", name: machine, remote: !!w.machine, spaces: 0, panes: 0 }));
      head.spaces++;
      head.panes += n;
      const open = this.open.has(w.id);
      out.push({ kind: "space", w, open, panes: n });
      if (!open) continue;
      for (const { tab, mine } of tabs) {
        const unfolded = this.open.has(tab.id);
        out.push({ kind: "tab", w, tab, open: unfolded, panes: mine.length });
        if (unfolded) out.push(...mine);
      }
    }
    return out;
  }

  // The selected row: the kept one, else the space you're in.
  current(rows) {
    const list = pickable(rows);
    const kept = list.find((r) => keyOf(r) === this.sel);
    if (kept) return kept;
    const cur = focused();
    return list.find((r) => r.kind === "space" && r.w.id === cur?.space) ?? list[0];
  }

  go(r) {
    if (!r) return;
    this.close();
    if (r.kind === "space") return run("space.select", { id: r.w.id });
    run("tab.select", { id: r.tab.id });
    if (r.kind === "pane") run("pane.focus", { pane: r.p.pane });
  }

  // → unfolds a space or a tab, then steps into it. ← folds: a pane's tab, an
  // unfolded tab or space, and from a folded tab its space.
  fold(r, right) {
    const id = r.kind === "space" ? r.w.id : r.kind === "tab" ? r.tab.id : null;
    if (right) {
      if (!id) return;
      if (!this.open.has(id)) {
        this.open.add(id);
        // A space with one tab: straight to its panes.
        if (r.kind === "space" && r.w.tabs.length === 1) this.open.add(r.w.tabs[0].id);
      } else {
        const list = pickable(this.rows());
        const next = list[list.findIndex((x) => keyOf(x) === keyOf(r)) + 1];
        if (next && next.kind !== "space") this.sel = keyOf(next);
      }
    } else if (r.kind === "pane") {
      this.open.delete(r.tab.id);
      this.sel = `t:${r.tab.id}`;
    } else if (r.kind === "tab" && !this.open.has(id)) {
      this.open.delete(r.w.id);
      this.sel = `s:${r.w.id}`;
    } else this.open.delete(id);
  }

  // What a row previews, as boxes in 0..1 of the preview: a pane alone, or a
  // tab's panes where its splits put them (a space: its shown tab).
  target(r) {
    if (!r) return [];
    if (r.kind === "pane") return [{ x: 0, y: 0, w: 1, h: 1, pane: r.p.pane }];
    const tab = r.kind === "tab" ? r.tab : (r.w.tabs.find((x) => x.active) ?? r.w.tabs[0]);
    if (!tab) return [];
    if (this.trees[tab.id]) return this.trees[tab.id];
    // Splits not read (yet): side by side.
    const mine = panes().filter((p) => p.tab === tab.id);
    return mine.map((p, i) => ({ x: i / mine.length, y: 0, w: 1 / mine.length, h: 1, pane: p.pane }));
  }

  // Every machine's splits, once: `doc.get` over `hc connect`, one request per line.
  loadTrees(cx) {
    if (checking()) return;
    const names = [null, ...new Set(spaces().map((w) => w.machine).filter(Boolean))];
    const ask = names.map((m, i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "doc.get", params: m ? { name: "herdr-app", on: m } : { name: "herdr-app" } }));
    cx.spawn(async (cx) => {
      try {
        const r = await askCore(ask);
        for (const line of r.stdout.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          const prefix = names[msg.id] ? `${names[msg.id]}/` : "";
          for (const s of msg.result?.value?.spaces ?? [])
            for (const tab of s.tabs ?? []) if (tab.root) this.trees[prefix + tab.id] = boxes(tab.root, 0, 0, 1, 1, prefix, []);
        }
        this.load(cx);
        cx.notify();
      } catch {}
    });
  }

  // Reads the previewed screens; redraws only when one changed.
  load(cx) {
    if (checking()) return;
    const by = new Map(panes().map((p) => [p.pane, p]));
    const addrs = this.target(this.current(this.rows())).map((b) => by.get(b.pane)?.terminal).filter(Boolean);
    if (!addrs.length) return;
    cx.spawn(async (cx) => {
      let changed = false;
      await Promise.all(
        addrs.map(async (addr) => {
          try {
            const r = await hc(["read", addr, "--json"]);
            if (r.code !== 0) return;
            const text = JSON.parse(r.stdout).text ?? "";
            if (this.shots[addr] === text) return;
            this.shots[addr] = text;
            changed = true;
          } catch {}
        }),
      );
      if (changed) cx.notify();
    });
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[st] ?? t.dim).child(st === "idle" ? "○" : st ? "●" : "·");
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const list = pickable(rows);
    const cur = focused();
    const sel = this.current(rows);
    this.sel = sel ? keyOf(sel) : null;
    const at = list.indexOf(sel);
    // One continuous strip: each row at a fixed y. Scrolling moves the strip
    // only as far as it takes to keep the selected row in view.
    const tops = [];
    let y = 0;
    rows.forEach((r) => { tops.push(y); y += H[r.kind]; });
    const total = y;
    const height = Math.min(BODY, this.bodyHeight ?? BODY);
    const fixed = total > height;
    const maxScroll = Math.max(0, total - height);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const si = rows.indexOf(sel);
    if (si >= 0) {
      // After a key press, keep the machine title above its first space in
      // view too. Not after the wheel: it would pull the strip back each frame.
      const top = this.reveal && rows[si - 1]?.kind === "machine" ? tops[si - 1] : tops[si];
      this.reveal = false;
      if (top < this.scroll) this.scroll = top;
      if (tops[si] + H[sel.kind] > this.scroll + height) this.scroll = tops[si] + H[sel.kind] - height;
    }
    const place = (el, i) =>
      fixed
        ? el.absolute().left(0).right(0).top(tops[i] - this.scroll).bottom(height - (tops[i] + H[rows[i].kind] - this.scroll))
        : el;
    const visible = (i) => !fixed || (tops[i] + H[rows[i].kind] > this.scroll && tops[i] < this.scroll + height);
    const status = (el, st) =>
      el
        .when(st === "blocked", (e) => e.child(div().flex_none().text_size(11).text_color(t.blocked).child("needs you")))
        .when(st === "done", (e) => e.child(div().flex_none().text_size(11).text_color(t.done).child("finished")));
    const chevron = (open) => svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim);
    const toggle = (r) => (_e, cx) => {
      this.fold(r, !r.open);
      this.sel = keyOf(r);
      this.handle.focus();
      this.load(cx);
      cx.notify();
    };

    const row = (r) => {
      if (r.kind === "machine") {
        return div()
          .h(H.machine)
          .flex_none()
          .px(4)
          .pt(12)
          .pb(4)
          .child(
            h_flex()
              .size_full()
              .px(10)
              .gap(8)
              .items_center()
              .rounded(6)
              .bg(t.raised)
              .text_color(t.foreground)
              .child(svg(`mods/workspace-chrome/${r.remote ? "server" : "monitor"}.svg`).size(13).flex_none())
              .child(div().flex_1().truncate().text_size(12).font_semibold().child(r.name))
              .child(div().flex_none().text_size(11).text_color(t.dim).child(`${count(r.spaces, "space")} · ${count(r.panes, "pane")}`)),
          );
      }
      const on = r === sel;
      const base = (id, left) =>
        h_flex()
          .id(id)
          .mx(4)
          .pl(left)
          .pr(10)
          .h(H[r.kind])
          .rounded(7)
          .gap(8)
          .items_center()
          .cursor_pointer()
          .when(on, (el) => el.bg(t.hover))
          .hover((s) => s.bg(t.hover));
      if (r.kind === "space") {
        return status(
          base(`pp-s-${r.w.id}`, 10)
            .on_click(toggle(r))
            .child(chevron(r.open))
            .child(h_flex().size(18).flex_none().rounded(5).bg(spaceColor(t, r.w)).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...r.w.name][0]?.toUpperCase() ?? "?"))
            .child(div().truncate().text_color(t.foreground).when(r.w.active, (d) => d.font_semibold()).child(r.w.name))
            .when(!!r.w.status, (el) => el.child(this.glyph(t, r.w.status)))
            .child(div().flex_1()),
          r.w.status,
        ).child(div().flex_none().text_size(11).text_color(t.dim).child(`${count(r.w.tabs.length, "tab")} · ${count(r.panes, "pane")}`));
      }
      if (r.kind === "tab") {
        const here = r.tab.id === cur?.tab;
        return status(
          base(`pp-t-${r.tab.id}`, 29)
            .on_click(toggle(r))
            .child(chevron(r.open))
            .child(div().truncate().text_size(12).text_color(r.tab.active ? t.foreground : t.muted).when(here, (d) => d.font_semibold()).child(r.tab.named ? r.tab.name : `tab ${r.tab.name}`))
            .when(!!r.tab.status, (el) => el.child(this.glyph(t, r.tab.status)))
            .child(div().flex_1()),
          r.tab.status,
        ).child(div().flex_none().text_size(11).text_color(t.dim).child(count(r.panes, "pane")));
      }
      const here = r.p.pane === cur?.pane;
      // A shell's title is just its address or folder: shown already.
      const title = [r.name, r.p.cwd, r.p.terminal].includes(r.p.title) ? "" : (r.p.title ?? "");
      return status(
        base(`pp-${r.p.pane}`, 48)
          .on_click(() => this.go(r))
          .child(this.glyph(t, r.p.status))
          .child(div().w(112).flex_none().truncate().text_color(t.foreground).when(here, (d) => d.font_semibold()).child(r.name))
          .child(div().flex_1().truncate().text_color(t.muted).child(folder(r.p.cwd)))
          .when(!!title, (el) => el.child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(title))),
        r.p.status,
      ).child(div().flex_none().text_size(11).text_color(t.dim).child(r.p.terminal ?? ""));
    };

    // The preview: one card per box, each showing the end of its screen.
    const by = new Map(panes().map((p) => [p.pane, p]));
    const shown = this.target(sel);
    const width = this.previewWidth ?? 800;
    const small = shown.length > 1;
    const line = small ? 14 : 16;
    const card = (b) => {
      const p = by.get(b.pane);
      const text = p?.terminal ? this.shots[p.terminal] : undefined;
      // A gap after every card but the last of its row and column.
      const w = b.w * width - (b.x + b.w < 0.999 ? GAP : 0);
      const h = b.h * height - (b.y + b.h < 0.999 ? GAP : 0);
      const fit = Math.max(1, Math.floor((h - 26 - 8) / line));
      const lines = (text ?? "").replace(/\s+$/, "").split("\n").slice(-fit);
      return v_flex()
        .absolute()
        .left(b.x * width)
        .top(b.y * height)
        .w(w)
        .h(h)
        .overflow_hidden()
        .rounded(8)
        .border_1()
        .border_color(p && p.pane === cur?.pane ? t.accent : t.border)
        .bg(t.background)
        .child(
          h_flex().h(26).flex_none().px(10).gap(8).items_center().text_size(11).text_color(t.dim)
            .child(div().flex_none().text_color(t.muted).child(p?.terminal ?? p?.mod ?? ""))
            .child(div().flex_1().truncate().child(p?.terminal ? [p.program?.name, folder(p.cwd)].filter(Boolean).join(" · ") : (p?.title ?? ""))),
        )
        .child(
          v_flex()
            .flex_1()
            .min_h(0)
            .px(10)
            .pb(8)
            .justify_end()
            .overflow_hidden()
            .font_family(settings().font_family ?? settings().font ?? "JetBrains Mono")
            .text_size(small ? 10 : 11)
            .text_color(ink(t))
            .children(text === undefined ? [] : lines.map((l) => div().h(line).flex_none().whitespace_nowrap().child(l))),
        );
    };
    const preview = div()
      .id("pp-preview")
      .on_size_change((size, cx) => {
        this.previewWidth = size.width / settings().zoom;
        cx.notify();
      })
      .relative()
      .h_full()
      .flex_1()
      .min_w(0)
      .children(shown.map(card));

    return v_flex()
      .id("pane-picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        // hjkl as the arrows, also under the Korean layout (the same keys type ㅗㅓㅏㅣ).
        const m = e.modifiers;
        const k = (!m.control && !m.alt && !m.platform && VI[e.key]) || e.key;
        if (k === "escape") return this.close();
        if (!sel) return;
        if (k === "enter") return this.go(sel);
        if (k === "down") this.sel = keyOf(list[(at + 1) % list.length]);
        else if (k === "up") this.sel = keyOf(list[(at + list.length - 1) % list.length]);
        else if (k === "right" || k === "left") this.fold(sel, k === "right");
        else return;
        this.reveal = true;
        this.load(cx);
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Go to…")).child(div().id("pp-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
      .child(
        h_flex()
          .id("pp-body")
          .on_size_change((size, cx) => {
            this.bodyHeight = size.height / settings().zoom;
            cx.notify();
          })
          .h(BODY)
          .min_h(0)
          .gap(12)
          .child(
            v_flex()
              .id("pp-list")
              .w(LIST_W)
              .flex_none()
              .h_full()
              .when(!list.length, (el) => el.child(div().px(14).py(6).text_color(t.dim).child("Nothing open.")))
              .when(fixed, (el) =>
                el.overflow_hidden().on_scroll_wheel((e, cx) => {
                  this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll));
                  // The selection follows the wheel, so the next frame doesn't scroll back to it.
                  const topOf = (j) => tops[rows.indexOf(list[j])];
                  let i = at;
                  while (i < list.length - 1 && topOf(i) < this.scroll) i++;
                  while (i > 0 && topOf(i) + H[list[i].kind] > this.scroll + height) i--;
                  if (list[i]) this.sel = keyOf(list[i]);
                  this.load(cx);
                  cx.notify();
                }))
              .children(rows.map((r, i) => (visible(i) ? place(row(r), i) : null)).filter(Boolean)),
          )
          .child(preview),
      )
      .child(div().flex_none().px(10).text_size(11).text_color(t.dim).child("↑↓ / k j move · → / l unfold · ← / h fold · Enter go · Esc close"));
  }
}
