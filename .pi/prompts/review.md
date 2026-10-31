---
description: Review the code in src/ for bugs and security issues
argument-hint: "[focus]"
---
Review every file under `src/`: list the folder, then read each file. Use only paths inside this project; never ask the user for input.
The review focus is: ${1:-correctness and security}. This is a topic, not a search term and not a path.
Check at least: off-by-one loop bounds, SQL built by string concatenation, shell commands built from input.
List each problem as `file:line - problem - fix`.
End with the VERDICT line.
