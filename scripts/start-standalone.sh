#!/usr/bin/env sh

set -eu

mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -R .next/static .next/standalone/.next/static

export HOSTNAME="${HOSTNAME:-0.0.0.0}"

exec node .next/standalone/server.js
