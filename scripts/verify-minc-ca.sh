#!/usr/bin/env bash
# Checks the Ministry of Digital Development trust anchors are wired end to end.
# Usage: scripts/verify-minc-ca.sh [path/to/app.apk]
set -euo pipefail

RAW=android/app/src/main/res/raw
XML=android/app/src/main/res/xml/network_security_config.xml
PATCH="patches/@mattermost+react-native-network-client+1.11.2.patch"
TM=node_modules/@mattermost/react-native-network-client/android/src/main/java/com/mattermost/networkclient/helpers/TrustManagerHelper.kt

fail() { echo "FAIL: $*" >&2; exit 1; }

# The anchors are real certificates and the sub really chains to the root.
openssl verify -CAfile "$RAW/russian_trusted_root_ca.cer" "$RAW/russian_trusted_sub_ca.cer" >/dev/null \
  || fail "sub CA does not chain to root CA"

# The network security config points at both of them.
for n in russian_trusted_root_ca russian_trusted_sub_ca; do
  grep -q "@raw/$n" "$XML" || fail "$XML does not reference @raw/$n"
done

# Without this the config above is ignored for every API and WebSocket request.
grep -q "AndroidCAStore" "$PATCH" || fail "$PATCH is missing"
if [ -f "$TM" ]; then
  grep -q "init(null as KeyStore?)" "$TM" || fail "TrustManagerHelper unpatched -- run: npx patch-package"
fi

# And, given an APK, the anchors actually survived into the artifact.
if [ $# -ge 1 ]; then
  snippet=$(sed -n '2p' "$RAW/russian_trusted_root_ca.cer" | tr -d '\r' | cut -c1-40)
  # aapt2 renames res/raw files in release builds, so match on content, not on name.
  # grep -c rather than -q: -q closes the pipe early and pipefail then fails the check.
  unzip -p "$1" 'res/*' 2>/dev/null | grep -cF "$snippet" >/dev/null || fail "no bundled root CA in $1"
fi

echo "OK: anchors wired${1:+, present in $1}"
