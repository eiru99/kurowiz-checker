#!/usr/bin/env python3
"""Supabase カタログを data/spirits.json にエクスポートする。"""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMPORT_SCRIPT = ROOT / "scripts" / "import-all-gamewith-events.py"

spec = importlib.util.spec_from_file_location("import_all_gamewith_events", IMPORT_SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

if __name__ == "__main__":
    out_path = ROOT / "data" / "spirits.json"
    module.export_catalog_json(out_path)
    print(f"exported -> {out_path}")
