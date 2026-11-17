// The head of the sidebar: only the search and fold buttons, on the right.
// The Herdr icon and name are left out, and the buttons are sized for the
// 30px row that lines up with the tab bar.
// Made from the header half of Herdr's workspace-chrome mod.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, window, shared, setShared, layout } from "herdr";

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

export default class SidebarHeader extends View {
  button(id, icon, action) {
    const t = theme();
    return div()
      .id(id)
      .size(22)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      // The row drags the window; a press on a button must not.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(action)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const mac = window()?.platform === "macos";
    return h_flex()
      .size_full()
      .bg(t.chrome)
      .pl(collapsed ? 6 : 14)
      .pr(10)
      .gap(4)
      .items_center()
      // Room for the traffic lights, which sit over this row in a window.
      .when(mac && !window()?.fullscreen && !collapsed, (el) => el.pl(76))
      .when(!collapsed, (el) => el.child(div().flex_1()))
      .when(!collapsed, (el) => el.child(this.button("search", "search", () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the footer's » unfolds it.
      .when(!(collapsed && mac), (el) => el.child(this.button("sidebar-toggle", "sidebar", toggleSidebar)));
  }
}
