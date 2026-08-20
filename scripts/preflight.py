#!/usr/bin/env python3
from __future__ import annotations

import os
import socket
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = [
    "package.json",
    "package-lock.json",
    ".gitignore",
    "README.md",
    "PRE-FLIGHT.md",
    "DEPLOYMENT.md",
    "server/app.js",
    "server/config.js",
    "server/protocol.js",
    "server/validators.js",
    "server/session-manager.js",
    "server/game-engine.js",
    "server/room-manager.js",
    "server/socket-gateway.js",
    "server/logger.js",
    "public/index.html",
    "public/shared/socket.js",
    "public/shared/ui.css",
    "public/host/index.html",
    "public/host/host.js",
    "public/tv/index.html",
    "public/tv/tv.js",
    "public/play/index.html",
    "public/play/play.js",
    "tests/multiplayer.integration.test.js",
    "tests/protocol.test.js",
    "tests/routes.test.js",
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
REQUIRED_DEMO_DOM_IDS = [
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
    missing = [path for path in REQUIRED_FILES if not (ROOT / path).is_file()]
    if missing:
        fail("Missing required files: " + ", ".join(missing))
    empty = [path for path in REQUIRED_FILES if (ROOT / path).stat().st_size == 0]
    if empty:
        fail("Empty required files: " + ", ".join(empty))
    ok(f"Required multiplayer file set present ({len(REQUIRED_FILES)} files)")


def validate_svg_files() -> None:
    svgs = sorted((ROOT / "assets").rglob("*.svg"))
    if len(svgs) < 9:
        fail(f"Expected at least 9 SVG assets, found {len(svgs)}")
    for path in svgs:
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError as exc:
            fail(f"Invalid SVG XML: {path.relative_to(ROOT)}: {exc}")
        if not root.tag.lower().endswith("svg"):
            fail(f"Unexpected SVG root element: {path.relative_to(ROOT)}")
    ok(f"SVG/XML validation passed ({len(svgs)} files)")


def validate_demo_html() -> None:
    html = (ROOT / "public/index.html").read_text(encoding="utf-8")
    for dom_id in REQUIRED_DEMO_DOM_IDS:
        if f'id="{dom_id}"' not in html and f"id='{dom_id}'" not in html:
            fail(f"Demo missing required DOM id: {dom_id}")
    for character_id in REQUIRED_CHARACTER_IDS:
        if f"id:'{character_id}'" not in html and f'id:"{character_id}"' not in html:
            fail(f"Demo missing character definition: {character_id}")
    for marker in [
        "function newPattern()", "function buildBridge()", "function syncLocks()",
        "function start()", "function choose(", "function finish(",
        "tile.classList.contains('broken')", "Array.from({length:10}",
    ]:
        if marker not in html:
            fail(f"Demo missing game-logic marker: {marker}")
    ok("Preserved standalone demo integrity passed")


def validate_multiplayer_surfaces() -> None:
    expected = {
        "public/host/index.html": ["Create room", "Start round", "Close room"],
        "public/tv/index.html": ["Frostbridge · TV", "roomCode", "bridge"],
        "public/play/index.html": ["Join Frostbridge", "LEFT", "RIGHT"],
    }
    for path, markers in expected.items():
        text = (ROOT / path).read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                fail(f"{path} missing marker: {marker}")
    player_js = (ROOT / "public/play/play.js").read_text(encoding="utf-8")
    host_js = (ROOT / "public/host/host.js").read_text(encoding="utf-8")
    tv_js = (ROOT / "public/tv/tv.js").read_text(encoding="utf-8")
    if "frostbridge:player:${code}" not in player_js:
        fail("Player credential storage contract missing")
    if "frostbridge:host:${code}" not in host_js:
        fail("Host credential storage contract missing")
    if "localStorage" in tv_js:
        fail("TV surface must not persist credentials")
    ok("Host/TV/player surface contracts passed")


def validate_private_dependency_boundary() -> None:
    forbidden = [
        "mrfantest2/Fantest_Party_Platform",
        "raw.githubusercontent.com/mrfantest2/Fantest_Party_Platform",
    ]
    runtime_files = list((ROOT / "server").rglob("*.js")) + list((ROOT / "public").rglob("*.js")) + list((ROOT / "public").rglob("*.html"))
    for path in runtime_files:
        text = path.read_text(encoding="utf-8").lower()
        for marker in forbidden:
            if marker.lower() in text:
                fail(f"Private monorepo dependency found in {path.relative_to(ROOT)}: {marker}")
    ok("Runtime has no private Fantest Party dependency")


def validate_javascript_syntax() -> None:
    files = sorted((ROOT / "server").rglob("*.js")) + sorted((ROOT / "public").rglob("*.js"))
    for path in files:
        result = subprocess.run(
            ["node", "--check", str(path)],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        if result.returncode != 0:
            print(result.stdout)
            fail(f"JavaScript syntax validation failed: {path.relative_to(ROOT)}")
    ok(f"JavaScript syntax validation passed ({len(files)} runtime files)")


def validate_package_contract() -> None:
    package = (ROOT / "package.json").read_text(encoding="utf-8")
    lock = (ROOT / "package-lock.json").read_text(encoding="utf-8")
    for marker in ['"node": ">=22"', '"express"', '"socket.io"', '"socket.io-client"']:
        if marker not in package:
            fail(f"package.json missing runtime contract: {marker}")
    if '"lockfileVersion"' not in lock:
        fail("package-lock.json is not a valid npm lockfile")
    ok("Node/runtime dependency contract passed")


def validate_documentation_contract() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    preflight = (ROOT / "PRE-FLIGHT.md").read_text(encoding="utf-8")
    deployment = (ROOT / "DEPLOYMENT.md").read_text(encoding="utf-8")
    for marker in ["/host/", "/tv/?room=ABCDE", "/play/?room=ABCDE", "assets/mockups/tv-gameplay.svg"]:
        if marker not in readme:
            fail(f"README missing production documentation marker: {marker}")
    for marker in ["npm ci", "npm test", "python scripts/preflight.py", "frostbridge-multiplayer-"]:
        if marker not in preflight:
            fail(f"PRE-FLIGHT.md missing canonical gate marker: {marker}")
    for marker in ["Node.js 22", "MAX_ROOMS", "WebSocket", "single", "90 seconds"]:
        if marker not in deployment:
            fail(f"DEPLOYMENT.md missing operational marker: {marker}")
    ok("Production documentation contract passed")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def request(path: str, port: int) -> tuple[int, bytes]:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
        return int(response.status), response.read()


def smoke_node_server() -> None:
    port = free_port()
    env = os.environ.copy()
    env["PORT"] = str(port)
    server = subprocess.Popen(
        ["node", "server/app.js"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.time() + 10
        last_error: Exception | None = None
        while time.time() < deadline:
            if server.poll() is not None:
                output = server.stdout.read() if server.stdout else ""
                fail(f"Node server exited during smoke test ({server.returncode}): {output}")
            try:
                status, body = request("/readyz", port)
                if status == 200 and b"protocolVersion" in body:
                    break
            except Exception as exc:
                last_error = exc
                time.sleep(0.2)
        else:
            fail(f"Node server did not become ready: {last_error}")

        checks = [
            ("/healthz", b"frostbridge"),
            ("/readyz", b"protocolVersion"),
            ("/", b"Rushline Rebels"),
            ("/host/", b"Frostbridge Host"),
            ("/tv/?room=ABCDE", b"Frostbridge TV"),
            ("/play/", b"Frostbridge Player"),
            ("/assets/characters/dana.svg", b"<svg"),
        ]
        for path, marker in checks:
            status, body = request(path, port)
            if status != 200:
                fail(f"HTTP smoke returned {status} for {path}")
            if marker not in body:
                fail(f"HTTP smoke returned unexpected body for {path}")
        ok(f"Real Node/Socket.IO HTTP smoke passed ({len(checks)} routes)")
    finally:
        server.terminate()
        try:
            server.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server.kill()


def main() -> None:
    print("=== RUSHLINE REBELS: FROSTBRIDGE MULTIPLAYER PRE-FLIGHT ===")
    validate_required_files()
    validate_svg_files()
    validate_demo_html()
    validate_multiplayer_surfaces()
    validate_private_dependency_boundary()
    validate_javascript_syntax()
    validate_package_contract()
    validate_documentation_contract()
    smoke_node_server()
    print("=== MULTIPLAYER PRE-FLIGHT PASS ===")


if __name__ == "__main__":
    main()
