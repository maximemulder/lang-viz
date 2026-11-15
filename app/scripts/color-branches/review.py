#!/usr/bin/env python3
"""Write a review of branch color results."""


import sys
from pathlib import Path

from scripts.branch_review import write_review

if __name__ == "__main__":
    write_review(Path(sys.argv[1]))
