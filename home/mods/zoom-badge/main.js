// A red ZOOM badge while the shown tab has a zoomed pane, like tmux's flag on
// the pane border. It floats over the layout as a kept, frameless window (open
// it once: `herdr-app do mod.open --name zoom-badge`; it comes back on every
// start), so the shipped layout and pane header stay untouched. mod.json puts
// it right of the sidebar, on the zoomed pane's top border where the panes
// start straight under the tab bar (main-gap0); a layout that pads its panes
// (main: 8) gets it that much lower. It draws nothing unless zoomed. Drag it
// to move it; the spot is remembered.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, theme, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class ZoomBadge extends View {
  render() {
    const tab = spaces().find((s) => s.active)?.tabs.find((x) => x.active);
    if (!tab?.zoomed) return div();
    // The space the layout leaves between the tab bar and its panes.
    const pad = find(layout(), "work-body")?.padding;
    return div().pt(typeof pad === "number" && pad > 0 ? 5 : 0).child(h_flex()
      .h(18)
      .px(8)
      .items_center()
      .rounded(5)
      .bg(theme().ansi1 ?? "#f38ba8")
      .text_size(10.5)
      .font_bold()
      .text_color("#ffffff")
      .child("⤢ ZOOM"));
  }
}
