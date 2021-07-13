#!/bin/bash

# This script extracts all function signatures from contracts on a repo.
# It's meant to run on Linux from the repo base folder like this:
# cd Sovryn-smart-contracts/
# ./scripts/functionSignatures.sh

find . -type f -name '*.sol' ! -path '*node_modules/*' -print0 | xargs -0 sed -z "s/\/\/[^\n]*\n//g" | awk '/function/,/{/' | awk '/function/,/;/' | sed "s/[[:space:]]+function/function/" | sed -z "s/\n[\t ]*//g" | sed -z "s/{/\n/g" | sed -z "s/;/\n/g" | egrep --text "^function " | egrep --text " (public|external) " | sed -E "s/(address|u*int[0-9]+|bytes[0-9]*|bool|string)(\[[0-9]*\])* [^,\)]+/\1/g" | sed "s/function //" | sed -r "s/ (public|external).*$//" | sed -r "s/\s+//g"


