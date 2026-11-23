// The menu a machine's title opens in the sidebar (spaces-agents, right-click):
// props { machine }. ↑/↓ move, Enter runs, Esc closes. Made like Herdr's menu mod.
//
// "Rename" hands the name to the sidebar (shared "machine.rename", then its
// "rename" command), which turns the title into a text box and renames with
// `hc machine rename`, as Settings > Machines does.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, setShared, theme } from "herdr";

const ITEMS = [
  ["Rename", "square-pen", (machine) => { setShared("machine.rename", machine); run("spaces-agents.rename"); }],
];

export default class MachineMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const p = props();
    closeOverlay(p.overlay);
    ITEMS[i]?.[2](p.machine);
  }

  render() {
    const t = theme();
    return v_flex()
      .id("machine-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % ITEMS.length;
        else if (e.key === "up") this.at = (this.at + ITEMS.length - 1) % ITEMS.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        ITEMS.map(([label, icon], i) =>
          h_flex()
            .id(`mm-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click(() => this.choose(i))
            .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(label)),
        ),
      );
  }
}
