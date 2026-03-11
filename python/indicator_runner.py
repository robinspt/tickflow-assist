#!/usr/bin/env python3
"""
Bridge process for JS/TS -> Python indicator calculation.

Input: stdin JSON array with OHLCV rows
Output: stdout JSON array with indicator rows
"""

import json
import sys

import pandas as pd

from indicators import calculate_all_indicators


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"error": "empty stdin"}))
        return 1

    rows = json.loads(raw)
    df = pd.DataFrame(rows)
    result = calculate_all_indicators(df)
    sys.stdout.write(result.to_json(orient="records", force_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
