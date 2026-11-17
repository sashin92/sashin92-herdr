// The bar under the panes. Left: where the shown space is (its machine, its
// branch) and the agents. Right, as tmux's status line had them: that machine's
// CPU and memory in use and its clock, then the command palette's key.
//
// The numbers are read every few seconds from this computer and from each
// machine a space is on, so they are there the moment a space is shown. On
// Linux from /proc, on macOS from ps and vm_stat; a machine that answers
// neither (Windows, one that is away) shows only this computer's own clock.
// Made from Herdr's workspace-status mod.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, exec, checking, window, keys } from "herdr";

// How often the machines are read (ms), and the one script that reads them
// wherever there is a POSIX shell: the clock (seconds since 1970 and the
// offset from UTC), then Linux's /proc lines, or on macOS the core count,
// memory size, every process's CPU share and vm_stat.
const EVERY = 10000;
const STATS = `echo "time $(date +%s) $(date +%z)"; if [ -r /proc/stat ]; then head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; else echo "mac $(sysctl -n hw.ncpu) $(sysctl -n hw.memsize)"; ps -A -o %cpu= | awk '{ s += $1 } END { print "cpusum", s }'; vm_stat; fi`;

// What STATS printed: { cpu, mem } in percent (null where it can't say yet),
// the clock as { skew, zone } (ms ahead of this computer's clock, minutes east
// of UTC), and Linux's CPU counters for the next reading. Linux counts CPU time
// since boot: the share in use is the change since the last reading (prev), so
// the first reading has none.
function readStats(out, prev, now) {
  const lines = out.split("\n");
  const find = (re) => { for (const l of lines) { const m = re.exec(l); if (m) return m; } return null; };
  const num = (re) => { const m = find(re); return m ? Number(m[1]) : null; };
  const time = find(/^time (\d+) ([+-])(\d\d)(\d\d)/);
  const clock = time ? { skew: Number(time[1]) * 1000 - now, zone: (time[2] === "-" ? -1 : 1) * (Number(time[3]) * 60 + Number(time[4])) } : null;
  const mac = find(/^mac (\d+) (\d+)/);
  if (mac) {
    const page = num(/page size of (\d+) bytes/) ?? 4096;
    const used = ((num(/^Pages active:\s+(\d+)/) ?? 0) + (num(/^Pages wired down:\s+(\d+)/) ?? 0) + (num(/^Pages occupied by compressor:\s+(\d+)/) ?? 0)) * page;
    const sum = num(/^cpusum ([\d.]+)/);
    return { cpu: sum == null ? null : Math.min(100, sum / Number(mac[1])), mem: Number(mac[2]) ? (used / Number(mac[2])) * 100 : null, clock, sample: null };
  }
  const cpu = find(/^cpu\s+(.*)$/);
  if (!cpu) return clock ? { cpu: null, mem: null, clock, sample: null, bare: true } : null;
  const f = cpu[1].trim().split(/\s+/).slice(0, 8).map(Number);
  const sample = { total: f.reduce((a, b) => a + b, 0), idle: (f[3] ?? 0) + (f[4] ?? 0) };
  const span = prev ? sample.total - prev.total : 0;
  const total = num(/^MemTotal:\s+(\d+)/);
  const free = num(/^MemAvailable:\s+(\d+)/);
  return {
    cpu: span > 0 ? ((span - (sample.idle - prev.idle)) / span) * 100 : null,
    mem: total && free != null ? ((total - free) / total) * 100 : null,
    clock,
    sample,
  };
}

// "11/17 18:05" on that machine's clock, or this computer's when it gave none.
function clockText(clock) {
  const at = Date.now() + (clock?.skew ?? 0);
  const zone = clock ? clock.zone : -new Date(at).getTimezoneOffset();
  const d = new Date(at + zone * 60000);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

export default class StatusBar extends View {
  init(_props, cx) {
    // By machine name ("" is this computer): what to show, and Linux's last CPU counters.
    this.stats = {};
    this.samples = {};
    this.shownClock = "";
    this.refresh(cx);
    cx.timer.every(EVERY, (cx) => this.refresh(cx));
  }

  shownMachine() {
    return spaces().find((s) => s.active)?.machine ?? "";
  }

  // Reads every machine; redraws when what the bar shows changed, the minute too.
  refresh(cx) {
    if (clockText(this.stats[this.shownMachine()]?.clock) !== this.shownClock) cx.notify();
    if (checking()) return;
    const names = ["", ...new Set(spaces().map((s) => s.machine).filter(Boolean))];
    for (const key of Object.keys(this.stats)) if (!names.includes(key)) delete this.stats[key];
    for (const key of names) {
      if (!key && window()?.platform === "windows") continue;
      cx.spawn(async (cx) => {
        let next = null;
        try {
          const now = Date.now();
          const r = await exec("sh", ["-c", STATS], { on: key || null, timeout: 8000 });
          const read = r.code === 0 ? readStats(r.stdout, this.samples[key], now) : null;
          if (read) {
            if (read.sample) this.samples[key] = read.sample;
            next = { cpu: read.cpu == null ? null : Math.round(read.cpu), mem: read.mem == null ? null : Math.round(read.mem), clock: read.clock, bare: Boolean(read.bare) };
          }
        } catch {}
        const old = this.stats[key];
        if (next) this.stats[key] = next;
        else delete this.stats[key];
        const same = Boolean(old) === Boolean(next) && old?.cpu === next?.cpu && old?.mem === next?.mem && clockText(old?.clock) === clockText(next?.clock);
        if (!same && key === this.shownMachine()) cx.notify();
      });
    }
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const st = this.stats[space?.machine ?? ""];
    this.shownClock = clockText(st?.clock);
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    // tmux's pills: an icon and a value on a raised ground, blue for CPU, yellow for memory.
    const pill = (icon, color, text) => h_flex().h(18).px(7).gap(5).flex_none().items_center().rounded(5).bg(t.raised).text_size(11).font_medium().text_color(color)
      .child(svg(icon).size(12).flex_none())
      .child(text);
    const percent = (v) => (v == null ? "–" : `${v}%`);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(h_flex().gap(6).flex_none().items_center()
        .when(Boolean(st) && !st.bare, (el) => el
          .child(pill("mods/status-bar/cpu.svg", t.ansi4, percent(st.cpu)))
          .child(pill("mods/status-bar/memory.svg", t.ansi3, percent(st.mem))))
        .child(pill("mods/workspace-chrome/clock.svg", t.muted, this.shownClock)))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint()));
  }
}
