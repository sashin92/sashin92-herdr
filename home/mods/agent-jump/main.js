// Goes to the Nth agent, counted the way the sidebar lists them:
// keys.json binds ctrl-1..9 to "agent-jump.1".."agent-jump.9". And to the next
// agent waiting for you (alt-a, "agent-jump.next"): those that need you, then
// those that finished, each in that same order; the Dock icon's badge counts them.
//
// A key can only name a command, and a mod hears its commands only while it
// is shown, so this lives as a kept, frameless window that draws nothing
// (open it once per layout: `herdr-app do mod.open --name agent-jump`; it
// comes back on every start).
//
// The order copies this layout's sidebar (spaces-agents), top to bottom: this
// computer's spaces first, then each other machine's by name; within a machine
// the spaces as spaces() has them; within a space the agents as agents() has
// them. A sub-agent with a pane sits under its parent there, not on a row of
// its own, so it has no number. Folded spaces and machines still count: the
// sidebar keeps its folds to itself.

import { View, div } from "gpui-kit";
import { agents, terminals, spaces, run, nextCommand, checking, notify, setBadge } from "herdr";

function ordered() {
  const byAddress = new Map(terminals().map((t) => [t.address, t]));
  const list = agents();
  const listed = new Set(list.map((a) => a.address));
  // Under a listed agent through live terminals only, as the sidebar's tree is built.
  const nested = (a) => {
    for (let t = byAddress.get(a.address), n = 0; t?.state === "live" && t.parent && n < 50; t = byAddress.get(t.parent), n++) {
      if (listed.has(t.parent)) return true;
    }
    return false;
  };
  const rows = list.filter((a) => !nested(a));
  const sp = spaces();
  const machines = [null, ...[...new Set(sp.map((s) => s.machine).filter(Boolean))].sort()];
  return machines.flatMap((m) => sp.filter((s) => (s.machine ?? null) === m).flatMap((s) => rows.filter((a) => a.space === s.id)));
}

// The agents waiting for you: those that need you before those that finished.
function waiting() {
  const list = ordered();
  return [...list.filter((a) => a.status === "blocked"), ...list.filter((a) => a.status === "done")];
}

export default class AgentJump extends View {
  init(_props, cx) {
    if (checking()) return;
    // On a timer, not in render: nothing is drawn while the window is behind
    // another app's, which is when the badge is looked at.
    const count = () => {
      const badge = String(waiting().length || "");
      if (badge !== this.badge) setBadge((this.badge = badge));
    };
    count();
    cx.timer.every(2000, count);
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command === "next") {
          // From the one you're on to the one after it, around.
          const list = waiting();
          const agent = list[(list.findIndex((a) => a.focused) + 1) % list.length];
          if (agent) run("agent.focus", { terminal: agent.address });
          else notify({ title: "No agent is waiting" });
          continue;
        }
        const agent = ordered()[Number(command) - 1];
        if (agent) run("agent.focus", { terminal: agent.address });
      }
    });
  }

  render() {
    return div();
  }
}
