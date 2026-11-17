// The bar under the panes. Left: where the shown space is (its machine, and
// whether that machine is connected; its branch) and the pane with the
// keyboard (its terminal's address). Right, as tmux's status line
// had them: that machine's CPU, memory and disk in use, its network traffic
// and its clock.
//
// The numbers are read every few seconds from this computer and from each
// machine a space is on, so they are there the moment a space is shown. On
// Linux from /proc, on macOS from ps, vm_stat and netstat; a machine
// that answers neither (Windows, one that is away) shows only this computer's
// own clock. Made from Herdr's workspace-status mod.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, focused, theme, exec, hc, checking, window } from "herdr";

// How often the machines are read (ms).
const EVERY = 10000;

// The one script that reads a machine wherever there is a POSIX shell. Every
// line it prints starts with what it is:
//   time   seconds since 1970 and the offset from UTC
//   disk   how full the volume with the home folder is
//   Linux  /proc/stat's cpu line, MemTotal and MemAvailable, "net" bytes in
//          and out so far (wired and wireless interfaces only: bridges,
//          containers and tunnels would count the same bytes again)
//   macOS  "mac" with the core count and memory size, "cpusum" (every
//          process's CPU share added up), vm_stat, "net" as above
const STATS = String.raw`
echo "time $(date +%s) $(date +%z)"
echo "disk $(df -P "$HOME" 2>/dev/null | awk 'NR == 2 { print $5 }')"
if [ -r /proc/stat ]; then
  head -1 /proc/stat
  grep -E '^(MemTotal|MemAvailable):' /proc/meminfo
  awk 'NR > 2 { sub(/^ +/, ""); split($0, a, /[: ]+/); if (a[1] ~ /^(en|eth|wl)/) { rx += a[2]; tx += a[10] } } END { printf "net %.0f %.0f\n", rx, tx }' /proc/net/dev
else
  echo "mac $(sysctl -n hw.ncpu) $(sysctl -n hw.memsize)"
  ps -A -o %cpu= | awk '{ s += $1 } END { print "cpusum", s }'
  vm_stat
  netstat -ibn | awk '$1 ~ /^en/ && $3 ~ /^<Link/ { if (NF >= 11) { rx += $7; tx += $10 } else { rx += $6; tx += $9 } } END { printf "net %.0f %.0f\n", rx, tx }'
fi
`;

// What STATS printed, as what the bar shows: cpu, mem and disk in percent, rx
// and tx in bytes a second (each null where it can't say yet),
// the clock as { skew, zone } (ms ahead of this computer's clock, minutes east
// of UTC), and the counters the next reading compares with. Linux's CPU time
// and both systems' network bytes count up from boot: what is in use now is
// the change since the last reading (prev), so the first reading has none.
function readStats(out, prev, now) {
  const lines = out.split("\n");
  const find = (re) => { for (const l of lines) { const m = re.exec(l); if (m) return m; } return null; };
  const num = (re) => { const m = find(re); return m ? Number(m[1]) : null; };
  const time = find(/^time (\d+) ([+-])(\d\d)(\d\d)/);
  if (!time) return null;
  const at = Number(time[1]);
  const read = {
    cpu: null, mem: null, rx: null, tx: null,
    disk: num(/^disk (\d+)%/),
    clock: { skew: at * 1000 - now, zone: (time[2] === "-" ? -1 : 1) * (Number(time[3]) * 60 + Number(time[4])) },
    sample: { at },
  };
  const net = find(/^net (\d+) (\d+)/);
  if (net) {
    read.sample.rx = Number(net[1]);
    read.sample.tx = Number(net[2]);
    const span = prev?.rx == null ? 0 : at - prev.at;
    if (span > 0) {
      read.rx = Math.max(0, (read.sample.rx - prev.rx) / span);
      read.tx = Math.max(0, (read.sample.tx - prev.tx) / span);
    }
  }
  const mac = find(/^mac (\d+) (\d+)/);
  if (mac) {
    const page = num(/page size of (\d+) bytes/) ?? 4096;
    const used = ((num(/^Pages active:\s+(\d+)/) ?? 0) + (num(/^Pages wired down:\s+(\d+)/) ?? 0) + (num(/^Pages occupied by compressor:\s+(\d+)/) ?? 0)) * page;
    const sum = num(/^cpusum ([\d.]+)/);
    read.cpu = sum == null ? null : Math.min(100, sum / Number(mac[1]));
    read.mem = Number(mac[2]) ? (used / Number(mac[2])) * 100 : null;
    return read;
  }
  const cpu = find(/^cpu\s+(.*)$/);
  if (!cpu) return { ...read, bare: true };
  const f = cpu[1].trim().split(/\s+/).slice(0, 8).map(Number);
  read.sample.total = f.reduce((a, b) => a + b, 0);
  read.sample.idle = (f[3] ?? 0) + (f[4] ?? 0);
  const span = prev?.total == null ? 0 : read.sample.total - prev.total;
  if (span > 0) read.cpu = ((span - (read.sample.idle - prev.idle)) / span) * 100;
  const total = num(/^MemTotal:\s+(\d+)/);
  const free = num(/^MemAvailable:\s+(\d+)/);
  if (total && free != null) read.mem = ((total - free) / total) * 100;
  return read;
}

// "11/17 18:05" on that machine's clock, or this computer's when it gave none.
function clockText(clock) {
  const at = Date.now() + (clock?.skew ?? 0);
  const zone = clock ? clock.zone : -new Date(at).getTimezoneOffset();
  const d = new Date(at + zone * 60000);
  const two = (n) => String(n).padStart(2, "0");
  return `${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

const percent = (v) => (v == null ? "–" : `${Math.round(v)}%`);

// Bytes a second, short: "0B", "840B", "12K", "1.4M", "2.1G".
function rate(v) {
  if (v == null) return "–";
  if (v < 1000) return `${Math.round(v)}B`;
  for (const unit of ["K", "M", "G"]) {
    v /= 1024;
    if (v < 999.5 || unit === "G") return `${v < 9.95 ? v.toFixed(1) : Math.round(v)}${unit}`;
  }
}

// Everything of a reading that reaches the screen, as one text: a change in it is a reason to redraw.
const shownText = (st) => (st ? [percent(st.cpu), percent(st.mem), percent(st.disk), rate(st.rx), rate(st.tx), clockText(st.clock), st.bare].join("|") : "");

export default class StatusBar extends View {
  init(_props, cx) {
    // By machine name ("" is this computer): what to show, the counters of the
    // last reading, and how `hc machine ls` says each other machine is.
    this.stats = {};
    this.samples = {};
    this.states = {};
    this.shown = "";
    this.refresh(cx);
    cx.timer.every(EVERY, (cx) => this.refresh(cx));
  }

  shownMachine() {
    return spaces().find((s) => s.active)?.machine ?? "";
  }

  // Reads every machine; redraws when what the bar shows changed, the minute too.
  refresh(cx) {
    if (shownText(this.stats[this.shownMachine()]) !== this.shown) cx.notify();
    if (checking()) return;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code !== 0) return;
        const states = Object.fromEntries((JSON.parse(r.stdout).machines ?? []).map((m) => [m.name, m.state]));
        if (JSON.stringify(states) === JSON.stringify(this.states)) return;
        this.states = states;
        cx.notify();
      } catch {}
    });
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
            this.samples[key] = read.sample;
            next = read;
          }
        } catch {}
        const before = shownText(this.stats[key]);
        if (next) this.stats[key] = next;
        else delete this.stats[key];
        if (shownText(next) !== before && key === this.shownMachine()) cx.notify();
      });
    }
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const machine = space?.machine ?? "";
    const st = this.stats[machine];
    this.shown = shownText(st);
    const pane = focused();
    const state = machine ? this.states[machine] : null;
    const label = (icon, text) => h_flex().gap(6).flex_none().items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13).flex_none()).child(text);
    // tmux's pills: an icon and a value on a raised ground, one color each.
    const pill = (icon, color, ...texts) => h_flex().h(18).px(7).gap(5).flex_none().items_center().rounded(5).bg(t.raised).text_size(11).font_medium().text_color(color)
      .child(svg(icon).size(12).flex_none())
      .children(texts.map((text) => div().child(text)));
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(machine ? "server" : "monitor", machine || "This computer")
        // Another machine: a dot while it is connected, else what it is instead ("unreachable", "needs login").
        .when(state === "connected", (el) => el.child(div().size(6).rounded(3).flex_none().bg(t.ansi2)))
        .when(Boolean(state) && state !== "connected", (el) => el.child(div().text_color(t.blocked).child(state.replace(/_/g, " ")))))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .when(Boolean(pane?.terminal), (el) => el.child(h_flex().gap(6).flex_none().items_center()
        .child(svg("mods/workspace-chrome/terminal.svg").size(13).flex_none())
        .child(div().flex_none().text_color(t.foreground).child(pane.terminal))))
      .child(div().flex_1())
      .child(h_flex().gap(6).flex_none().items_center()
        .when(Boolean(st) && !st.bare, (el) => el
          .child(pill("mods/status-bar/cpu.svg", t.ansi4, percent(st.cpu)))
          .child(pill("mods/status-bar/memory.svg", t.ansi3, percent(st.mem)))
          .child(pill("mods/status-bar/disk.svg", t.ansi5, percent(st.disk)))
          .child(pill("mods/status-bar/net.svg", t.ansi6, `↓${rate(st.rx)}`, `↑${rate(st.tx)}`)))
        .child(pill("mods/workspace-chrome/clock.svg", t.muted, clockText(st?.clock))));
  }
}
