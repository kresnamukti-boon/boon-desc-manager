#!/usr/bin/env bash
# Rebuild desc_loader.js — the standalone Description Builder add-on — after editing
# rw_descbuilder.js. This repo has a single source module; there is no base-workbench bundle.
set -euo pipefail
cd "$(dirname "$0")"

OUT=desc_loader.js

cat > "$OUT" <<'HEADER'
/* Boon Description Builder add-on — variable-input templates for label descriptions.
 * Usage: F12 -> Console -> paste this entire block -> Enter. Fully standalone: paste alongside
 * or without any other RW-family loader, in any order. Injects a small form above the host app's
 * own Description field, inside its real Create/Edit Label dialog. Nothing persists server-side
 * until you click the app's own Save. Paste again after each page navigation. */
(async function(){
  function ready(){
    // Soft requirement only: the label modal may be created lazily on first box draw, so this
    // never hard-blocks on it — the install-time body observer (see rw_descbuilder.js) handles
    // a modal that doesn't exist yet.
    return typeof annotationState !== 'undefined'
        && document.getElementById('annotation-canvas');
  }
  // wait for app (up to 30s) — safe to paste immediately on page load
  for (let i=0; i<60 && !ready(); i++) await new Promise(r=>setTimeout(r,500));
  if (!ready()){ console.warn('[RW] app not ready after 30s — try pasting again once the page renders'); return; }
  await new Promise(r=>setTimeout(r,600)); // let the canvas settle; also gives the modal time to appear

HEADER

echo "// ===== rw_descbuilder.js =====" >> "$OUT"
cat rw_descbuilder.js >> "$OUT"
printf '\n' >> "$OUT"

cat >> "$OUT" <<'FOOTER'

  console.log('[RW] Description Builder ready. Open a label\'s Create/Edit dialog to see it above Description.');
})()
FOOTER

node --check "$OUT" && echo "rebuilt $OUT ($(wc -c < "$OUT") bytes) — syntax OK"
