#!/bin/bash
set -e

# Change this to use a different model (provider/model).
MODEL="opencode-go/glm-5.3"

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

cd "$(dirname "$0")"
touch progress.txt

for ((i=1; i<=$1; i++)); do
  result=$(opencode run --auto --model "$MODEL" --file PRD.md --file progress.txt "$(cat PROMPT.md)")

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "PRD complete after $i iterations."
    exit 0
  fi
done
