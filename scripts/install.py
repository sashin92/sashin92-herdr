#!/usr/bin/env python3
"""Puts this repo's Herdr setup into a Herdr home (macOS and Linux).

Safe to run again: every step looks at what is there first and changes only
what differs, so a second run reports nothing to do.

  files     home/mods, home/layouts, home/themes are copied over when a file
            is missing or differs. A file it replaces is kept under
            <home>/.sashin92-herdr-backup/<time>/ first.
  keys      home/keys.json is merged into the home's keys.json: its keys are
            set, the rest stay. Whatever key closes a tab asks first from now
            on, and a key this sets is taken out of the more specific
            "terminal" section, where it would win over "global".
  settings  home/settings.json is merged into the home's settings.json.
  app       with Herdr running: each mod is checked, the two always-on mods
            are opened once per layout, the theme is picked and the layout
            is shown. Without Herdr running these are skipped: run it again.

Backups:

  --backups            lists the backups in the home, newest last.
  --restore            puts the files of the newest backup back (--backup NAME
                       picks another). Only files that differ are touched, and
                       what it replaces is kept as a new backup, so a restore
                       can be undone the same way. Files a run added (there
                       was nothing to keep) stay where they are.
"""

import argparse
import filecmp
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

BACKUPS = ".sashin92-herdr-backup"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(REPO, "home")
COPIED = ("mods", "layouts", "themes")
# An action a key already has, and what that key does instead.
REPLACED_ACTIONS = {"tab.close": "mod.open:confirm-close-tab"}
# Settings only one platform reads.
PLATFORM_SETTINGS = {"option_as_alt": "macos"}
LAYOUT = "main-gap0"
THEME = "tomorrow-night"
# Mods that live as kept, unseen windows: opened once per layout, they come back on every start.
KEPT = ("zoom-badge", "agent-jump")
KEPT_LAYOUTS = ("main", LAYOUT)


class Run:
    def __init__(self, home, platform, dry):
        self.home = home
        self.platform = platform
        self.dry = dry
        self.changes = 0
        # A folder of its own: a run in the same second as another (a restore right after
        # an install) must not keep its files in the backup it is reading from.
        stamp = time.strftime("%Y%m%d-%H%M%S")
        name, n = stamp, 1
        while os.path.exists(os.path.join(home, BACKUPS, name)):
            n += 1
            name = f"{stamp}-{n}"
        self.backup_dir = os.path.join(home, BACKUPS, name)

    def say(self, mark, text):
        print(f"  {mark} {text}")

    def changed(self, text):
        self.changes += 1
        self.say("~" if self.dry else "+", text)

    def backup(self, path):
        """Keeps the file a step is about to replace."""
        if self.dry or not os.path.exists(path):
            return
        kept = os.path.join(self.backup_dir, os.path.relpath(path, self.home))
        os.makedirs(os.path.dirname(kept), exist_ok=True)
        shutil.copy2(path, kept)

    def write_json(self, path, value):
        if self.dry:
            return
        folder = os.path.dirname(path)
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".tmp-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def copy_files(run):
    print("files")
    same = 0
    for top in COPIED:
        for folder, _dirs, names in os.walk(os.path.join(SOURCE, top)):
            for name in sorted(names):
                src = os.path.join(folder, name)
                rel = os.path.relpath(src, SOURCE)
                dst = os.path.join(run.home, rel)
                if os.path.exists(dst) and filecmp.cmp(src, dst, shallow=False):
                    same += 1
                    continue
                run.changed(f"{rel} ({'replaced' if os.path.exists(dst) else 'new'})")
                run.backup(dst)
                if not run.dry:
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copyfile(src, dst)
    run.say("=", f"{same} files already the same")


def merge_keys(run):
    print("keys")
    path = os.path.join(run.home, "keys.json")
    keys = read_json(path)
    wanted = read_json(os.path.join(SOURCE, "keys.json"))
    before = json.dumps(keys, sort_keys=True)
    for section, binds in wanted.items():
        mine = keys.setdefault(section, {})
        for key, action in binds.items():
            if mine.get(key) != action:
                run.say(".", f"{section}: {key} -> {action}" + (f" (was {mine[key]})" if key in mine else ""))
                mine[key] = action
    for section, binds in keys.items():
        if not isinstance(binds, dict):
            continue
        for key, action in list(binds.items()):
            if isinstance(action, str) and action in REPLACED_ACTIONS:
                run.say(".", f"{section}: {key} -> {REPLACED_ACTIONS[action]} (was {action})")
                binds[key] = REPLACED_ACTIONS[action]
    # "terminal" wins over "global" while a terminal has the keyboard.
    for key in wanted.get("global", {}):
        if key in keys.get("terminal", {}):
            run.say(".", f"terminal: {key} removed (was {keys['terminal'][key]}): global has it now")
            del keys["terminal"][key]
    if json.dumps(keys, sort_keys=True) == before:
        run.say("=", "keys.json already has them")
        return
    run.changed("keys.json")
    run.backup(path)
    run.write_json(path, keys)


def same_value(a, b):
    """Whether a setting already is what we want. Herdr writes whole numbers
    back with a decimal point (1 becomes 1.0), which json tells apart from 1:
    comparing settings as text made every run replace settings.json."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same_value(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same_value(x, y) for x, y in zip(a, b))
    return a == b


def merge_settings(run):
    print("settings")
    path = os.path.join(run.home, "settings.json")
    settings = read_json(path) if os.path.exists(path) else {}
    wanted = read_json(os.path.join(SOURCE, "settings.json"))
    changed = False
    for key, value in wanted.items():
        if PLATFORM_SETTINGS.get(key, run.platform) != run.platform:
            continue
        if isinstance(value, dict) and isinstance(settings.get(key), dict):
            for inner, v in value.items():
                if inner in settings[key] and same_value(settings[key][inner], v):
                    continue
                settings[key][inner] = v
                changed = True
        elif key not in settings or not same_value(settings[key], value):
            settings[key] = value
            changed = True
    if not changed:
        run.say("=", "settings.json already has them")
        return
    run.changed("settings.json")
    run.backup(path)
    run.write_json(path, settings)


def backup_names(home):
    """The backups in the home, oldest first (their names are times)."""
    root = os.path.join(home, BACKUPS)
    if not os.path.isdir(root):
        return []
    def order(name):
        # "20261117-175203", then "20261117-175203-2", ... "-10": by time, then by number.
        parts = name.split("-")
        return ("-".join(parts[:2]), int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 1)

    return sorted((n for n in os.listdir(root) if os.path.isdir(os.path.join(root, n))), key=order)


def backup_files(home, name):
    root = os.path.join(home, BACKUPS, name)
    found = []
    for folder, _dirs, names in os.walk(root):
        found += [os.path.relpath(os.path.join(folder, n), root) for n in names]
    return sorted(found)


def list_backups(home):
    names = backup_names(home)
    if not names:
        print("No backups yet: one is made when a run replaces a file.")
        return
    print("backups (newest last)")
    for name in names:
        files = backup_files(home, name)
        print(f"  {name}  {len(files)} file(s): {', '.join(files)}")


def restore(run, name):
    """Puts a backup's files back; what they replace is kept as a new backup."""
    names = backup_names(run.home)
    if not names:
        sys.exit("No backups to restore from.")
    if name is None:
        name = names[-1]
    elif name not in names:
        sys.exit(f"No backup named {name}. There are: {', '.join(names)}")
    print(f"restore from {name}")
    root = os.path.join(run.home, BACKUPS, name)
    same = 0
    for rel in backup_files(run.home, name):
        src = os.path.join(root, rel)
        dst = os.path.join(run.home, rel)
        if os.path.exists(dst) and filecmp.cmp(src, dst, shallow=False):
            same += 1
            continue
        run.changed(f"{rel} ({'restored' if os.path.exists(dst) else 'put back'})")
        run.backup(dst)
        if not run.dry:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
    run.say("=", f"{same} file(s) already the same")


def app(*args):
    """Runs herdr-app; returns (ok, parsed JSON or text)."""
    exe = shutil.which("herdr-app") or os.path.expanduser("~/.local/bin/herdr-app")
    try:
        done = subprocess.run([exe, *args], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as err:
        return False, str(err)
    text = done.stdout.strip() or done.stderr.strip()
    try:
        value = json.loads(done.stdout)
    except ValueError:
        return done.returncode == 0, text
    return done.returncode == 0 and not (isinstance(value, dict) and "error" in value), value


def app_steps(run):
    print("app")
    ok, status = app("status")
    if not ok or not isinstance(status, dict):
        run.say("!", "Herdr isn't running (or herdr-app isn't on PATH): start Herdr and run this again to finish.")
        return False
    if run.dry:
        run.say("=", "skipped in a dry run")
        return True

    for mod in sorted(os.listdir(os.path.join(SOURCE, "mods"))):
        ok, out = app("check", os.path.join(run.home, "mods", mod))
        if not ok:
            run.say("!", f"{mod} doesn't pass `herdr-app check` on this Herdr: {str(out).splitlines()[0] if out else ''}")

    def kept():
        path = os.path.join(run.home, "windows.json")
        try:
            return read_json(path).get("kept", {})
        except (OSError, ValueError):
            return {}

    def shown():
        return app("status")[1]

    for layout in KEPT_LAYOUTS:
        missing = [m for m in KEPT if m not in kept().get(layout, {})]
        if not missing:
            continue
        if shown().get("layout") != layout:
            app("do", "layout.switch", "--name", layout)
        for mod in missing:
            # mod.open toggles: open it only when it isn't.
            if mod not in shown().get("overlays", []):
                app("do", "mod.open", "--name", mod)
            if mod in shown().get("overlays", []):
                run.changed(f"{mod} opened in the {layout} layout")
            else:
                run.say("!", f"{mod} didn't open in the {layout} layout")

    if shown().get("layout") != LAYOUT:
        ok, out = app("do", "layout.switch", "--name", LAYOUT)
        if ok:
            run.changed(f"showing the {LAYOUT} layout")
        else:
            run.say("!", f"couldn't show the {LAYOUT} layout: {out}")

    # The layout's dark theme, read from where Herdr keeps a layout's picks.
    try:
        picked = read_json(os.path.join(run.home, "layouts", ".state", f"{LAYOUT}.json")).get("theme")
    except (OSError, ValueError):
        picked = None
    dark = picked.get("dark") if isinstance(picked, dict) else picked
    if dark != THEME:
        ok, out = app("do", "app.theme", "--name", THEME)
        if ok:
            run.changed(f"theme {THEME}")
        else:
            run.say("!", f"couldn't pick the theme {THEME}: {out}")
    run.say("=", "app is set")
    return True


def main():
    parser = argparse.ArgumentParser(description="Install this Herdr setup. Safe to run again.")
    parser.add_argument("--home", help="the Herdr home (default: $HERDR_APP_HOME, else ~/.config/herdr-app)")
    parser.add_argument("--platform", choices=("macos", "linux"), default="macos" if sys.platform == "darwin" else "linux")
    parser.add_argument("--dry-run", action="store_true", help="say what would change, change nothing")
    parser.add_argument("--no-app", action="store_true", help="files, keys and settings only: don't talk to the running app")
    parser.add_argument("--backups", action="store_true", help="list the backups and stop")
    parser.add_argument("--restore", action="store_true", help="put the newest backup's files back instead of installing")
    parser.add_argument("--backup", metavar="NAME", help="with --restore: the backup to use (default: the newest)")
    args = parser.parse_args()
    if args.backup and not args.restore:
        parser.error("--backup goes with --restore")

    home = os.path.abspath(os.path.expanduser(args.home or os.environ.get("HERDR_APP_HOME") or "~/.config/herdr-app"))
    if not os.path.isfile(os.path.join(home, "keys.json")):
        sys.exit(f"{home} has no keys.json: start Herdr once so it makes its home, then run this again.")
    print(f"Herdr home: {home}" + ("  (dry run)" if args.dry_run else ""))

    if args.backups:
        list_backups(home)
        return

    run = Run(home, args.platform, args.dry_run)
    if args.restore:
        restore(run, args.backup)
        if not run.changes:
            print("Nothing to change.")
        elif args.dry_run:
            print(f"{run.changes} change(s) would be made.")
        else:
            print(f"{run.changes} change(s) made." + (f" What they replaced is kept in {run.backup_dir}" if os.path.isdir(run.backup_dir) else ""))
        return

    copy_files(run)
    merge_keys(run)
    merge_settings(run)
    finished = True if args.no_app else app_steps(run)

    if not run.changes:
        print("Nothing to change." if finished else "Files, keys and settings are already in place.")
    elif args.dry_run:
        print(f"{run.changes} change(s) would be made.")
    else:
        print(f"{run.changes} change(s) made." + (f" Replaced files are kept in {run.backup_dir}" if os.path.isdir(run.backup_dir) else ""))


if __name__ == "__main__":
    main()
