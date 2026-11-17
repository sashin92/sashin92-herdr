// Asks before closing the focused pane: keys can only run commands, so the
// key opens this mod as an unseen window; it opens the `confirm-choice` dialog
// (←/→ pick, Enter takes it, Esc cancels) for what has the keyboard right now,
// then closes itself.

import { View, div } from "gpui-kit";
import { focused, panes, spaces, openOverlay, closeOverlay, props, checking } from "herdr";

// Home as "~", on other machines too (their home isn't known here).
const folder = (cwd) => (cwd ?? "").replace(/^\/(home|Users)\/[^/]+(?=\/|$)/, "~");

function ask() {
  const p = panes().find((x) => x.pane === focused()?.pane);
  if (!p) return null;
  const name = p.terminal ? (p.program?.name ?? "terminal") : (p.mod ?? "mod");
  const where = [folder(p.cwd), p.terminal && `(${p.terminal})`].filter(Boolean).join(" ");
  return {
    title: "Close pane?",
    detail: `${name}${where ? ` in ${where}` : ""}. The program running in it ends.`,
    command: { name: "pane.close", args: { pane: p.pane } },
  };
}

export default class extends View {
  init(_props, cx) {
    if (checking()) return;
    const overlay = props()?.overlay;
    cx.spawn(async () => {
      try {
        const spec = ask();
        if (spec) openOverlay({ mod: "confirm-choice", kind: "dialog", width: 440, height: 180, props: spec });
      } catch {}
      if (overlay) closeOverlay(overlay);
    });
  }

  render() {
    return div();
  }
}
