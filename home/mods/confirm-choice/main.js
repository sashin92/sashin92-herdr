// Herdr's `confirm` dialog with a choice you can move: ←/→ (or Tab, h/l) pick
// Cancel or Confirm, Enter takes the picked one; y confirms and n or Esc
// cancels at once. Opens on Confirm, so Enter alone still confirms.
// Opened as a dialog with props { title, detail, command: { name, args } }.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";

export default class ConfirmChoice extends View {
  init(_props, cx) {
    this.yes = true;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  take(yes) {
    const p = props();
    closeOverlay(p.overlay);
    if (yes) run(p.command.name, p.command.args ?? {});
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    // The picked button wears an accent ring; the other keeps the same size with a clear one.
    const button = (id, label, yes, bg, fg) =>
      h_flex()
        .id(id)
        .rounded(10)
        .border_2()
        .border_color(this.yes === yes ? t.accent : "#00000000")
        .p(2)
        .cursor_pointer()
        .on_click(() => this.take(yes))
        .child(h_flex().h(30).px(14).items_center().rounded(7).border_1().border_color(yes ? bg : t.input).bg(bg).text_color(fg).child(label));
    return v_flex()
      .id("confirm-choice")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "enter") this.take(this.yes);
        else if (k === "escape" || k === "n") this.take(false);
        else if (k === "y") this.take(true);
        else if (k === "left" || k === "h") this.yes = false;
        else if (k === "right" || k === "l") this.yes = true;
        else if (k === "tab") this.yes = !this.yes;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .rounded(8)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(p.title ?? "Are you sure?")).child(div().text_size(11).text_color(t.dim).child("←/→ · Enter · Esc")))
      .child(div().flex_1().min_h(0).overflow_y_scrollbar().text_color(t.muted).child(p.detail ?? ""))
      .child(
        h_flex()
          .justify_end()
          .gap(4)
          .text_size(12)
          .child(button("no", "Cancel", false, t.raised, t.foreground))
          .child(button("yes", "Confirm", true, t.solid, t.solid_foreground)),
      );
  }
}
