#!/usr/bin/env bash
# Verify the privacy claims Whitebox makes about itself.
#
# The point is falsifiability: each check below fails loudly if the claim
# stops being true. Two traps this script exists because of:
#
#   1. Cloudflare only injects its RUM beacon for *browser* User-Agents.
#      curl's default UA gets a clean response, so a naive grep "proves"
#      something that is false for every real visitor. Hence the explicit UA.
#   2. `grep | head` in a pipeline makes the criterion vacuously true. Every
#      check here asserts on a count and exits non-zero.
#
# Usage: tools/verify-privacy.sh [base-url]
set -uo pipefail

BASE="${1:-https://whitebox.judy2006969.me}"
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
fail=0

say() { printf '%-46s %s\n' "$1" "$2"; }
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then say "$1" "OK  ($2)"; else say "$1" "FAIL got=$2 want=$3"; fail=1; fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -sS --max-time 25 -A "$UA" -D "$tmp/h" -o "$tmp/b" "$BASE/" || { echo "fetch failed"; exit 2; }

echo "=== $BASE ==="

# 1. No Cloudflare analytics beacon injected at the edge.
n=$(grep -c 'cloudflareinsights' "$tmp/b" || true)
check "no cloudflareinsights beacon" "$n" "0"

# 2. no-transform present, which is what forbids the injection.
n=$(grep -ci 'no-transform' "$tmp/h" || true)
[ "$n" -ge 1 ] && say "cache-control: no-transform" "OK  ($n)" || { say "cache-control: no-transform" "FAIL absent"; fail=1; }

# 3. CSP forbids third-party script and any outbound connection.
if grep -qi "content-security-policy.*connect-src 'none'" "$tmp/h"; then
  say "CSP connect-src 'none'" "OK"
else
  say "CSP connect-src 'none'" "FAIL"; fail=1
fi
if grep -qi "content-security-policy.*script-src 'self'" "$tmp/h"; then
  say "CSP script-src 'self'" "OK"
else
  say "CSP script-src 'self'" "FAIL"; fail=1
fi

# 3b. The CSP must still permit WASM. hash-wasm supplies BLAKE3 / SHA3 /
# CRC32, and without 'wasm-unsafe-eval' those three hashes fail at runtime
# while the page looks completely fine — a locked-down CSP that silently
# breaks the product is not a win. (This exact regression shipped once.)
if grep -qi "content-security-policy.*wasm-unsafe-eval" "$tmp/h"; then
  say "CSP allows wasm (hash-wasm needs it)" "OK"
else
  say "CSP allows wasm (hash-wasm needs it)" "FAIL — BLAKE3/SHA3/CRC32 will break"; fail=1
fi

# 4. No external origins that the browser would actually FETCH.
#
# A plain <a href> to another site is not a request — nobody's data leaves the
# page because a link exists. What matters is anything the browser loads on its
# own: script/link/img/iframe/form targets. So allowlist by *purpose*, not by
# hostname string, or this check starts flagging the source link in the footer.
# (It did exactly that when the repo link moved from the private forge to
# GitHub — the gate was right to fire and the assertion was too broad.)
fetched=$(grep -oE '(src|href)="https?://[^"]+"' "$tmp/b" \
      | grep -vE 'rel="?(noopener|noreferrer)' \
      | grep -oE 'https?://[a-zA-Z0-9.-]+' \
      | grep -vE '(whitebox\.judy2006969\.me|www\.w3\.org)' \
      | sort -u || true)
# Links in the page body are fine; subresources are not. Isolate the tags that
# cause a load.
sub=$(grep -oE '<(script|link|img|iframe|source|form)[^>]+(src|href|action)="https?://[^"]+"' "$tmp/b" \
      | grep -oE 'https?://[a-zA-Z0-9.-]+' \
      | grep -vE '(whitebox\.judy2006969\.me|www\.w3\.org)' \
      | sort -u || true)
if [ -z "$sub" ]; then
  say "no third-party subresources" "OK"
  [ -n "$fetched" ] && echo "      (outbound links present, not loaded: $(echo "$fetched" | tr '\n' ' '))"
else
  say "no third-party subresources" "FAIL"; echo "$sub" | sed 's/^/      /'; fail=1
fi

# 5. Every tool page is reachable and carries the privacy pill.
missing=0
for slug in base64 url html-entities hex unicode jwt password uuid hash hmac \
            keypair totp qr json json-yaml-toml timestamp base-convert color \
            csv-json cron regex diff text-stats case cidr; do
  code=$(curl -sS --max-time 20 -A "$UA" -o "$tmp/p" -w '%{http_code}' "$BASE/t/$slug/")
  [ "$code" = "200" ] || { echo "      $slug -> HTTP $code"; missing=$((missing+1)); continue; }
  grep -q '纯本地运行' "$tmp/p" || { echo "      $slug -> no privacy pill"; missing=$((missing+1)); }
  grep -q 'cloudflareinsights' "$tmp/p" && { echo "      $slug -> BEACON INJECTED"; missing=$((missing+1)); }
done
check "25 tool pages clean" "$missing" "0"

echo
[ "$fail" -eq 0 ] && echo "all privacy claims hold" || echo "FAILURES PRESENT — the site's own claims are false"
exit "$fail"
