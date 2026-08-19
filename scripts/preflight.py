#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = [
    "README.md",
    "index.html",
    "assets/characters/nadir.svg",
    "assets/characters/zayd.svg",
    "assets/characters/jolyne.svg",
    "assets/characters/dana.svg",
    "assets/characters/sami.svg",
    "assets/characters/rami.svg",
    "assets/mockups/tv-gameplay.svg",
    "assets/mockups/phone-controller.svg",
    "assets/mockups/character-select.svg",
]

REQUIRED_CHARACTER_IDS = ["nadir", "zayd", "jolyne", "dana", "sami", "rami"]
REQUIRED_DOM_IDS = [
    "livesHud", "timeHud", "stageHud", "roster", "bridge", "portrait",
    "runnerImg", "runner", "distance", "progressBar", "startBtn",
    "shuffleBtn", "modal", "modalTitle", "modalText", "againBtn",
]


def fail(message: str) -> None:
    print(f"[FAIL] {message}")
    raise SystemExit(1)


def ok(message: str) -> None:
    print(f"[OK] {message}")


def validate_required_files() -> None:
    missing = [p for p in REQUIRED_FILES if not (ROOT / p).is_file()]
    if missing:
        fail("Missing required files: " + ", ".join(missing))
    empty = [p for p in REQUIRED_FILES if (ROOT / p).stat().st_size == 0]
    if empty:
        fail("Empty required files: " + ", ".join(empty))
    ok(f"Required file set present ({len(REQUIRED_FILES)} files)")


def validate_svg_files() -> None:
    svgs = sorted((ROOT / "assets").rglob("*.svg"))
    if len(svgs) < 9:
        fail(f"Expected at least 9 SVG assets, found {len(svgs)}")
    for path in svgs:
        try:
            tree = ET.parse(path)
            root = tree.getroot()
        except ET.ParseError as exc:
            fail(f"Invalid SVG XML: {path.relative_to(ROOT)}: {exc}")
        if not root.tag.lower().endswith("svg"):
            fail(f"Unexpected SVG root element: {path.relative_to(ROOT)}")
    ok(f"SVG/XML validation passed ({len(svgs)} files)")


def validate_html() -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    for dom_id in REQUIRED_DOM_IDS:
        if f'id="{dom_id}"' not in html and f"id='{dom_id}'" not in html:
            fail(f"Missing required DOM id: {dom_id}")

    for character_id in REQUIRED_CHARACTER_IDS:
        if f"id:'{character_id}'" not in html and f'id:"{character_id}"' not in html:
            fail(f"Missing character definition: {character_id}")

    required_logic = [
        "function newPattern()",
        "function buildBridge()",
        "function syncLocks()",
        "function start()",
        "function choose(",
        "function sync()",
        "function finish(",
        "tile.classList.contains('broken')",
        "Array.from({length:10}",
        "time=45",
        "lives=3",
    ]
    for marker in required_logic:
        if marker not in html:
            fail(f"Missing game-logic marker: {marker}")

    forbidden = [
        "mrfantest2/Fantest_Party_Platform",
        "raw.githubusercontent.com/mrfantest2/Fantest_Party_Platform",
        "javascript:",
    ]
    lowered = html.lower()
    for marker in forbidden:
        if marker.lower() in lowered:
            fail(f"Forbidden/private dependency found in index.html: {marker}")

    refs = re.findall(r'''(?:src|href)=["']([^"']+)["']''', html, flags=re.I)
    checked = 0
    for ref in refs:
        # Template expressions such as ${c.img} are dynamic JS-generated markup.
        # Their concrete character paths are validated through REQUIRED_FILES.
        if "${" in ref:
            continue
        if ref.startswith(("http://", "https://", "#", "mailto:", "tel:")):
            continue
        target = (ROOT / ref.split("?", 1)[0].split("#", 1)[0]).resolve()
        try:
            target.relative_to(ROOT.resolve())
        except ValueError:
            fail(f"Asset reference escapes repository root: {ref}")
        if not target.exists():
            fail(f"Broken local asset reference: {ref}")
        checked += 1

    ok(f"HTML/game integrity passed ({checked} concrete local asset links checked)")
    return html


def validate_readme() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for path in [
        "assets/mockups/tv-gameplay.svg",
        "assets/mockups/phone-controller.svg",
        "assets/mockups/character-select.svg",
    ]:
        if path not in readme:
            fail(f"README does not expose design image: {path}")
    ok("README exposes all design boards")


def validate_javascript(html: str) -> None:
    scripts = re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>", html, flags=re.I | re.S)
    if not scripts:
        fail("No inline JavaScript found")
    js = "\n".join(scripts)
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as handle:
        handle.write(js)
        js_path = Path(handle.name)
    try:
        node = subprocess.run(
            ["node", "--check", str(js_path)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
    finally:
        js_path.unlink(missing_ok=True)
    if node.returncode != 0:
        print(node.stdout)
        fail("JavaScript syntax validation failed")
    ok("JavaScript syntax validation passed")


def smoke_http() -> None:
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8765", "--bind", "127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        import time
        deadline = time.time() + 8
        last_error: Exception | None = None
        while time.time() < deadline:
            try:
                with urllib.request.urlopen("http://127.0.0.1:8765/index.html", timeout=2) as response:
                    body = response.read().decode("utf-8")
                    if response.status != 200:
                        fail(f"HTTP smoke returned status {response.status}")
                    if "Rushline Rebels" not in body or "FROST" not in body:
                        fail("HTTP smoke returned unexpected page content")
                    ok("Local HTTP smoke test passed")
                    return
            except Exception as exc:  # server may still be starting
                last_error = exc
                time.sleep(0.2)
        fail(f"HTTP smoke test failed: {last_error}")
    finally:
        server.terminate()
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server.kill()


def main() -> None:
    print("=== RUSHLINE REBELS: FROSTBRIDGE PRE-FLIGHT ===")
    validate_required_files()
    validate_svg_files()
    html = validate_html()
    validate_readme()
    validate_javascript(html)
    smoke_http()
    print("=== PRE-FLIGHT PASS ===")


if __name__ == "__main__":
    main()
