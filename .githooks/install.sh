#!/bin/sh
# Points this repo's git hooks at .githooks/ so the commit-msg naming check
# in .githooks/commit-msg runs automatically. Run once per clone:
#   ./.githooks/install.sh
set -e
git config core.hooksPath .githooks
echo "core.hooksPath set to .githooks"
