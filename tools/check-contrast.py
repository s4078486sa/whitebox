#!/usr/bin/env python3
"""Verify every foreground/background token pair meets WCAG AA.

Run: python3 tools/check-contrast.py
Exits non-zero if any pair fails, so it can gate a build.
"""
import re
import sys
from pathlib import Path

CSS = Path(__file__).resolve().parent.parent / "src/styles/tokens.css"


def _lin(c: float) -> float:
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    r, g, b = (_lin(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg) -> float:
    l1, l2 = sorted((luminance(fg), luminance(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def hexrgb(h: str):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def parse_blocks(text: str) -> dict:
    """Return {theme: {token: hex}} for the dark and light blocks."""
    themes = {}
    for m in re.finditer(r"(/\*\s*THEME:(\w+)\s*\*/)\s*([^{]+)\{(.*?)\}", text, re.S):
        name = m.group(2)
        body = m.group(4)
        vals = dict(re.findall(r"(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;", body))
        themes.setdefault(name, {}).update(vals)
    return themes


# (foreground, background, minimum ratio, what it is)
PAIRS = [
    ("--text-primary", "--bg-app", 4.5, "body text on page"),
    ("--text-primary", "--bg-surface", 4.5, "body text on surface"),
    ("--text-primary", "--bg-surface-muted", 4.5, "output text"),
    ("--text-muted", "--bg-app", 4.5, "helper text on page"),
    ("--text-muted", "--bg-surface", 4.5, "helper text on surface"),
    ("--text-muted", "--bg-surface-muted", 4.5, "counts under panes"),
    ("--accent", "--bg-app", 4.5, "link on page"),
    ("--accent", "--bg-surface", 4.5, "link on surface"),
    ("--accent", "--bg-surface-elevated", 4.5, "link in popover"),
    ("--success", "--bg-app", 4.5, "success text"),
    ("--success", "--bg-surface", 4.5, "success text on surface"),
    ("--danger", "--bg-app", 4.5, "error text"),
    ("--danger", "--bg-surface", 4.5, "error text on surface"),
    ("--warning", "--bg-surface", 4.5, "warning text"),
    # Non-text: UI boundaries need 3:1 (WCAG 1.4.11)
    ("--border-strong", "--bg-surface", 3.0, "input border"),
    ("--border-focus", "--bg-app", 3.0, "focus ring on page"),
    ("--border-focus", "--bg-surface", 3.0, "focus ring on surface"),
    ("--accent", "--bg-surface", 3.0, "icon/glyph"),
]


def main() -> int:
    text = CSS.read_text(encoding="utf-8")
    themes = parse_blocks(text)
    if not themes:
        print(f"no THEME blocks found in {CSS}", file=sys.stderr)
        return 2

    failures = 0
    for theme, tokens in sorted(themes.items()):
        print(f"\n=== {theme} ===")
        for fg, bg, need, what in PAIRS:
            if fg not in tokens or bg not in tokens:
                print(f"  SKIP {fg} on {bg} (not defined in this theme)")
                continue
            r = contrast(hexrgb(tokens[fg]), hexrgb(tokens[bg]))
            ok = r >= need
            failures += not ok
            mark = "ok  " if ok else "FAIL"
            print(f"  {mark} {r:5.2f} (need {need})  {fg} on {bg}  — {what}")

    print()
    if failures:
        print(f"{failures} contrast failure(s)")
        return 1
    print("all contrast pairs pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
