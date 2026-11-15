#!/usr/bin/env python3
"""Write a review of color precomputation results."""


import sys
from pathlib import Path

from scripts.precomputation_review import write_review

if __name__ == "__main__":
    write_review(Path(sys.argv[1]))
