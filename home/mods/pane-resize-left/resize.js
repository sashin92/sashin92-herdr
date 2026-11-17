// Moves a border of the focused pane, like tmux `resize-pane -L/-D/-U/-R`:
// the border after the pane in the nearest row (left/right) or column
// (up/down) it sits in, or the one before it when it is the last there.
// The splits and their weights come from the pane's machine's `herdr-app`
// document; `layout.resize` writes the two new weights.
//
// Keys can only run commands, so each direction is a mod opened as an unseen
// window that resizes once and closes itself (pane-resize-left/down/up/right).
// A mod can't import from another mod's folder: each of the four keeps its
// own identical copy of this file. Change all four together.

import { View, div } from "gpui-kit";
import { focused, exec, run, props, closeOverlay, checking, window as appWindow } from "herdr";

// One press moves the border by this share of the row or column; a pane keeps at least MIN of it.
const STEP = 0.03;
const MIN = 0.08;

// `hc connect` reads its requests from stdin, one per line, and exec() has no
// stdin to give: the platform's shell pipes them in.
function askCore(lines) {
  if (appWindow()?.platform === "windows") {
    const quoted = lines.map((l) => `'${l.replace(/'/g, "''")}'`).join(",");
    return exec("powershell", ["-NoProfile", "-Command", `${quoted} | hc connect`]);
  }
  return exec("sh", ["-c", 'printf "%s\\n" "$1" | hc connect', "sh", lines.join("\n")]);
}

function trailTo(node, id, trail) {
  const here = [...trail, node];
  if (node.id === id) return here;
  for (const k of node.children ?? []) {
    const found = trailTo(k, id, here);
    if (found) return found;
  }
  return null;
}

const weight = (k) => k.size?.weight ?? 1;

// The two weights to write, or null when the pane has no border that way.
function plan(root, pane, dir) {
  const want = dir === "left" || dir === "right" ? "row" : "column";
  const forward = dir === "right" || dir === "down";
  const trail = trailTo(root, pane, []);
  if (!trail) return null;
  for (let i = trail.length - 2; i >= 0; i--) {
    const kids = trail[i].children ?? [];
    if (trail[i].type !== want || kids.length < 2) continue;
    const at = kids.indexOf(trail[i + 1]);
    const [a, b] = at < kids.length - 1 ? [kids[at], kids[at + 1]] : [kids[at - 1], kids[at]];
    const sum = kids.reduce((s, k) => s + weight(k), 0);
    const pair = weight(a) + weight(b);
    const min = Math.min(MIN * sum, pair / 2);
    const next = Math.max(min, Math.min(pair - min, weight(a) + (forward ? STEP : -STEP) * sum));
    return [{ id: a.id, weight: next }, { id: b.id, weight: pair - next }];
  }
  return null;
}

async function move(dir) {
  const pane = focused()?.pane;
  if (!pane) return;
  // Another machine's ids carry "machine/"; its document doesn't.
  const cut = pane.lastIndexOf("/");
  const machine = cut < 0 ? null : pane.slice(0, cut);
  const prefix = machine ? `${machine}/` : "";
  const ask = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "doc.get", params: machine ? { name: "herdr-app", on: machine } : { name: "herdr-app" } });
  const r = await askCore([ask]);
  const doc = JSON.parse(r.stdout.split(/\r?\n/)[0]).result?.value;
  for (const s of doc?.spaces ?? []) {
    for (const tab of s.tabs ?? []) {
      const steps = tab.root && plan(tab.root, pane.slice(prefix.length), dir);
      if (!steps) continue;
      for (const st of steps) run("layout.resize", { id: prefix + st.id, weight: st.weight });
      return;
    }
  }
}

export function resizer(dir) {
  return class extends View {
    init(_props, cx) {
      if (checking()) return;
      const overlay = props()?.overlay;
      cx.spawn(async () => {
        try {
          await move(dir);
        } catch {}
        if (overlay) closeOverlay(overlay);
      });
    }

    render() {
      return div();
    }
  };
}
