// Asks before closing the focused tab: keys can only run commands, so the
// key opens this mod as an unseen window; it opens the `confirm-choice` dialog
// (←/→ pick, Enter takes it, Esc cancels) for what has the keyboard right now,
// then closes itself.

import { View, div } from "gpui-kit";
import { focused, panes, spaces, openOverlay, closeOverlay, props, checking } from "herdr";

// Home as "~", on other machines too (their home isn't known here).
const folder = (cwd) => (cwd ?? "").replace(/^\/(home|Users)\/[^/]+(?=\/|$)/, "~");

function ask() {
  const cur = focused();
  const space = spaces().find((s) => s.id === cur?.space);
  const tab = space?.tabs.find((x) => x.id === cur?.tab);
  if (!tab) return null;
  const last = space.tabs.length === 1;
  return {
    title: "Close tab?",
    detail: `${tab.named ? tab.name : `tab ${tab.name}`} of ${space.name}: ${tab.panes} pane${tab.panes === 1 ? "" : "s"}. The programs running in it end.${last ? " It is the last tab, so the space closes too." : ""}`,
    command: { name: "tab.close", args: { id: tab.id, confirmed: true } },
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
