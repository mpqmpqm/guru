#!/usr/bin/env python3
"""S+7: Replace a noun with the 7–77th noun after it in the dictionary."""
import random
import sys
from bisect import bisect_left
from pathlib import Path


def load_nouns():
    path = Path(__file__).parent / "nouns.txt"
    return path.read_text().splitlines()


def s7(noun: str, nouns: list[str]) -> str:
    idx = bisect_left(nouns, noun.lower())
    return nouns[(idx + random.randint(7, 77)) % len(nouns)]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python main.py <noun>", file=sys.stderr)
        sys.exit(1)

    print(s7(sys.argv[1], load_nouns()))
