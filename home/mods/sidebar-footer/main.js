// The foot of the sidebar: Settings only (machines are added from Settings).
// On the macOS rail it also carries the » that unfolds the sidebar: there the
// traffic lights take the place of the top bar's own button, and the agents
// list that used to have the » is gone from this layout.
// Made from the footer half of Herdr's workspace-chrome mod.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, window, shared, setShared, updates, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class SidebarFooter extends View {
  render() {
    const t = theme();
    const collapsed = narrow();
    // A dot on Settings while an update is waiting to be installed.
    const ready = div().size(6).rounded_full().bg(t.accent);
    const settings = h_flex()
      .id("settings")
      .h(28)
      .px(8)
      .gap(9)
      .items_center()
      .rounded(8)
      .when(collapsed, (el) => el.relative().w(32).px(0).justify_center().tooltip("Settings"))
      .when(!collapsed, (el) => el.flex_1())
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .cursor_pointer()
      .on_click(() => run("app.settings"))
      .child(svg("mods/workspace-chrome/settings.svg").size(14))
      .when(!collapsed, (el) => el.child("Settings"))
      .when(Boolean(updates().app.ready), (el) => el.child(collapsed ? ready.absolute().top(5).right(6) : ready));
    const unfold = div()
      .id("sidebar-unfold")
      .w(28)
      .h(28)
      .flex()
      .items_center()
      .justify_center()
      .rounded(8)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .cursor_pointer()
      .tooltip("Show the sidebar")
      .on_click(toggleSidebar)
      .child("»");
    return h_flex()
      .size_full()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .px(8)
      .pt(4)
      .pb(8)
      .items_center()
      .text_size(13)
      .when(collapsed, (el) => el.px(0).gap(2).justify_center())
      .child(settings)
      .when(collapsed && window()?.platform === "macos", (el) => el.child(unfold));
  }
}
