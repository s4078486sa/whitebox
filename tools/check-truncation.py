#!/usr/bin/env python3
"""Fail the build if any output value would be visually truncated.

Why this exists: the key-value row layout that fixed /t/hash's height problem
(718px -> 252px) introduced `text-overflow: ellipsis`, which hid 240px of a
1039px SHA-512. Five of seven hashes were cut off on screen. Every DOM test
passed — the clipboard still held the full value, `textContent` was complete,
and `title` matched. Only a *screenshot* showed the defect.

So the rule is structural: a value the user is meant to read must not be
clipped. Grep the stylesheet for the combination that clips (`nowrap` +
`overflow:hidden`/`ellipsis`) on the selectors that carry payload text.

This cannot catch every visual bug — it catches this one, permanently.
"""
import re
import sys
from pathlib import Path

CSS = Path(__file__).resolve().parent.parent / "src/styles/app.css"

# Selectors whose content is data the user came here to read and copy.
PAYLOAD_SELECTORS = (".kv-val", ".out-text", ".result", "code")

# Top-level containers must share one width. They were three separate literals
# and drifted: main went to 1360px while footer stayed at 1180px, leaving the
# footer rule inset 82px from every other element. Only a screenshot showed it.
CONTAINER_SELECTORS = ("main", "footer")


def rules(text: str):
    """Yield (selector_list, body) for each rule, comments stripped."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        yield m.group(1).strip(), m.group(2)


def main() -> int:
    css = CSS.read_text(encoding="utf-8")
    problems = []

    for sel, body in rules(css):
        if not any(p in sel for p in PAYLOAD_SELECTORS):
            continue
        b = body.replace(" ", "")
        clips = "overflow:hidden" in b or "text-overflow:ellipsis" in b
        nowrap = "white-space:nowrap" in b
        if clips and nowrap:
            problems.append(
                f"{sel}: clips payload text "
                f"(white-space:nowrap + overflow hidden/ellipsis).\n"
                f"      A value the user must read may be cut off on screen "
                f"even though the clipboard is correct.\n"
                f"      Use `white-space: pre-wrap; overflow-wrap: anywhere;` "
                f"instead."
            )

    # Container widths must come from the shared token, not a literal.
    for sel, body in rules(css):
        name = sel.strip()
        if name not in CONTAINER_SELECTORS:
            continue
        m = re.search(r"max-width:\s*([^;]+);", body)
        if m and "--page-w" not in m.group(1):
            problems.append(
                f"{name}: max-width is the literal `{m.group(1).strip()}` "
                f"instead of var(--page-w).\n"
                f"      Separate literals drift; that is how the footer ended "
                f"up 82px narrower than main."
            )

    if problems:
        print("payload text would be visually truncated:\n")
        for p in problems:
            print("  " + p)
        return 1

    print(f"no clipped payload selectors ({', '.join(PAYLOAD_SELECTORS)}); "
          f"containers share var(--page-w)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
