// Goes to the Nth agent, counted the way the Agents sidebar lists them:
// keys.json binds ctrl-1..9 to "agent-jump.1".."agent-jump.9".
//
// A key can only name a command, and a mod hears its commands only while it
// is shown, so this lives as a kept, frameless window that draws nothing
// (open it once per layout: `herdr-app do mod.open --name agent-jump`; it
// comes back on every start).
//
// The order copies the sidebar's: pinned first; a sub-agent with a pane sits
// under its parent, not on a row of its own; then by space ("grouped") or by
// urgency ("priority"). In priority the sidebar breaks ties by its own record
// of when each agent last changed, which another mod can't read: `seq` stands
// in for it, so equal agents may be numbered differently there.

import { View, div } from "gpui-kit";
import { agents, terminals, shared, run, nextCommand, checking } from "herdr";

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

function ordered() {
  let list = agents();
  const all = terminals();
  const parent = new Map(all.map((t) => [t.address, t.parent]));
  const listed = new Set(list.map((a) => a.address));
  const nested = (a) => {
    for (let p = parent.get(a.address), n = 0; p && n < 50; p = parent.get(p), n++) if (listed.has(p)) return true;
    return false;
  };
  list = list.filter((a) => a.pinned || !nested(a));
  if ((shared("agents.sort") ?? "priority") !== "grouped") {
    const kids = (addr, n = 0) => (n > 50 ? [] : all.filter((t) => t.parent === addr).flatMap((t) => [t, ...kids(t.address, n + 1)]));
    const urgency = new Map(list.map((a) => [a.address, Math.max(RANK[a.status] ?? 0, ...kids(a.address).map((t) => RANK[t.status] ?? 0))]));
    list = [...list].sort((x, y) => urgency.get(y.address) - urgency.get(x.address) || y.seq - x.seq);
  }
  return [...list.filter((a) => a.pinned), ...list.filter((a) => !a.pinned)];
}

export default class AgentJump extends View {
  init(_props, cx) {
    if (checking()) return;
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        const agent = ordered()[Number(command) - 1];
        if (agent) run("agent.focus", { terminal: agent.address });
      }
    });
  }

  render() {
    return div();
  }
}
