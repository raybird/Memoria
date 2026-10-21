#!/bin/bash
# test-bootstrap.sh
# Simulates AI agent self-installation of Memoria (Phase 1.5 verification)
# Tests: preflight --json, setup --json, setup --serve --json, SDK health poll

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CLI="$ROOT_DIR/cli"

echo "[bootstrap] Step 1: preflight --json"
PREFLIGHT_OUTPUT=$(MEMORIA_HOME="$TMP" "$CLI" preflight --json)
echo "$PREFLIGHT_OUTPUT"
OK=$(echo "$PREFLIGHT_OUTPUT" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r).ok ? 0 : 1)" 2>/dev/null) || {
  echo "✗ preflight --json: ok != true"
  exit 1
}
echo "✓ preflight --json passed"

echo ""
echo "[bootstrap] Step 2: setup --json (no serve)"
PASS_COUNT=0
FAIL_COUNT=0
while IFS= read -r line; do
  STEP=$(echo "$line" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); const o=JSON.parse(r.trim()); process.stdout.write(o.step||'')" 2>/dev/null || true)
  STEP_OK=$(echo "$line" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r.trim()).ok ? 0 : 1)" 2>/dev/null && echo "yes" || echo "no")
  if [ "$STEP_OK" = "yes" ]; then
    echo "  ✓ step[$STEP]"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ✗ step[$STEP] FAILED: $line"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done < <(MEMORIA_HOME="$TMP" "$CLI" setup --json 2>&1)

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "✗ setup --json: $FAIL_COUNT step(s) failed"
  exit 1
fi
echo "✓ setup --json: $PASS_COUNT steps passed"

echo ""
echo "[bootstrap] Step 3: verify database created"
if [ ! -f "$TMP/.memory/sessions.db" ]; then
  echo "✗ sessions.db was not created"
  exit 1
fi
echo "✓ sessions.db exists"

echo ""
echo "[bootstrap] Step 3b: verify deployed skill"
if [ ! -f "$TMP/.agents/skills/memoria/SKILL.md" ]; then
  echo "✗ deployed skill missing"
  exit 1
fi
if [ ! -f "$TMP/.agents/skills/memoria/REFERENCE.md" ]; then
  echo "✗ deployed skill reference missing"
  exit 1
fi
if grep -q './cli\|bash skills/\|node skills/\|git clone' "$TMP/.agents/skills/memoria/SKILL.md"; then
  echo "✗ deployed SKILL.md still contains repo-only guidance"
  exit 1
fi
if ! grep -q '^name: memoria$' "$TMP/.agents/skills/memoria/SKILL.md"; then
  echo "✗ deployed SKILL.md must expose 'name: memoria' for active_skills discovery"
  exit 1
fi
if ! grep -q 'homeSource' "$TMP/.agents/skills/memoria/SKILL.md"; then
  echo "✗ deployed SKILL.md missing fail-closed guidance (doctor homeSource check)"
  exit 1
fi
if ! grep -q 'memoria setup\|memoria" setup\|MEMORIA_BIN" setup' "$TMP/.agents/skills/memoria/SKILL.md"; then
  echo "✗ deployed SKILL.md missing new-folder setup guidance"
  exit 1
fi
MEMORIA_BIN="$CLI" bash "$TMP/.agents/skills/memoria/scripts/run-sync.sh" "$ROOT_DIR/examples/session.sample.json" "$TMP" >/dev/null
echo "✓ deployed skill works"

echo ""
echo "[bootstrap] Step 3c: host agent skill deployment (issue-22) — isolated HOME"
TEMPLATE="$ROOT_DIR/skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md"
HOST_SKILL_REL=".claude/skills/memoria/SKILL.md"
# A corepack-shimmed pnpm keeps its cache under $HOME; pin it before HOME is swapped, or preflight fails.
export COREPACK_HOME="${COREPACK_HOME:-$HOME/.cache/node/corepack}"

# SCN-006 (primary): a hand-written skill without the setup marker is never overwritten.
H6="$TMP/home-scn6"; mkdir -p "$H6/.claude/skills/memoria"
printf -- '---\nname: memoria\ndescription: hand-written by the user\n---\n\nmine\n' > "$H6/$HOST_SKILL_REL"
cp "$H6/$HOST_SKILL_REL" "$TMP/hand-written.md"
if HOME="$H6" MEMORIA_HOME="$TMP/data-scn6" "$CLI" setup --agent claude-code >"$TMP/scn6.out" 2>&1; then
  echo "✗ SCN-006: setup overwrote a hand-written skill (exit 0)"; exit 1
fi
cmp -s "$TMP/hand-written.md" "$H6/$HOST_SKILL_REL" || { echo "✗ SCN-006: hand-written SKILL.md changed"; exit 1; }
grep -qF "$H6/.claude/skills/memoria" "$TMP/scn6.out" || { echo "✗ SCN-006: refusal does not name the target path"; cat "$TMP/scn6.out"; exit 1; }
echo "✓ SCN-006: hand-written skill left byte-identical, non-zero exit names the path"

# SCN-003: without --agent, setup never touches the host agent directory.
H3="$TMP/home-scn3"; mkdir -p "$H3"
HOME="$H3" MEMORIA_HOME="$TMP/data-scn3" "$CLI" setup --json >/dev/null
[ ! -e "$H3/.claude" ] || { echo "✗ SCN-003: setup without --agent created ~/.claude"; exit 1; }
if HOME="$H3" MEMORIA_HOME="$TMP/data-scn3" "$CLI" setup --agent nope >"$TMP/scn3.out" 2>&1; then
  echo "✗ SCN-003: unknown --agent value accepted"; exit 1
fi
grep -q 'claude-code' "$TMP/scn3.out" || { echo "✗ SCN-003: unknown --agent error does not list the valid values"; exit 1; }
# Review 81bb75d S-2: an inherited property name is not a host agent either.
if (cd "$H3" && HOME="$H3" MEMORIA_HOME="$TMP/data-scn3-proto" "$CLI" setup --agent toString >"$TMP/scn3-proto.out" 2>&1); then
  echo "✗ SCN-003: --agent toString accepted"; exit 1
fi
[ ! -e "$H3/[object Object]" ] && [ ! -e "$TMP/data-scn3-proto" ] || { echo "✗ SCN-003: --agent toString wrote something"; exit 1; }
[ ! -e "$H3/.claude" ] || { echo "✗ SCN-003: rejected --agent still wrote ~/.claude"; exit 1; }
echo "✓ SCN-003: no --agent → ~/.claude untouched; unknown value rejected"

# SCN-004: --agent claude-code deploys the template where Claude Code looks.
H4="$TMP/home-scn4"; mkdir -p "$H4"
HOME="$H4" MEMORIA_HOME="$TMP/data-scn4" "$CLI" setup --agent claude-code --json >/dev/null
cmp -s "$TEMPLATE" "$H4/$HOST_SKILL_REL" || { echo "✗ SCN-004: deployed SKILL.md differs from the template"; exit 1; }
[ "$(cat "$H4/.claude/skills/memoria/DATA_ROOT")" = "$TMP/data-scn4" ] || { echo "✗ SCN-004: DATA_ROOT does not name the data root"; exit 1; }
[ -x "$H4/.claude/skills/memoria/bin/memoria" ] || { echo "✗ SCN-004: bin/memoria wrapper missing"; exit 1; }
echo "✓ SCN-004: ~/.claude/skills/memoria deployed from the template, bound to its data root"

# SCN-005: a copy setup wrote (marker present) is refreshed in place.
printf '\nstale line from an older deploy\n' >> "$H4/$HOST_SKILL_REL"
HOME="$H4" MEMORIA_HOME="$TMP/data-scn4" "$CLI" setup --agent claude-code >"$TMP/scn5.out" 2>&1
cmp -s "$TEMPLATE" "$H4/$HOST_SKILL_REL" || { echo "✗ SCN-005: marked copy not refreshed"; exit 1; }
grep -qF "previous copy backed up to $TMP/data-scn4/.agents/skill-backups/claude-code-" "$TMP/scn5.out" \
  || { echo "✗ SCN-005: text output does not name the backup path"; cat "$TMP/scn5.out"; exit 1; }
echo "✓ SCN-005: marked copy refreshed to the current template"

# Review 81bb75d M-1: the marks also sit in every copy someone cp'd from a deployed skill and then
# edited, so a marked target may hold the user's own work. It is backed up — outside the skills
# directory, where Claude Code would load it as a second "memoria" skill — before being replaced.
printf '\nmy own trigger notes\n' >> "$H4/$HOST_SKILL_REL"
echo "keep me" > "$H4/.claude/skills/memoria/NOTES.md"
cp "$H4/$HOST_SKILL_REL" "$TMP/edited-marked.md"
# The refresh above already left one backup; directory order is filesystem-dependent (ext4 hashes
# names), so take this run's backup from setup's own report, never from a listing.
count_backups() { find "$TMP/data-scn4/.agents/skill-backups" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l; }
BACKUPS_BEFORE=$(count_backups)
HOME="$H4" MEMORIA_HOME="$TMP/data-scn4" "$CLI" setup --agent claude-code --json >"$TMP/scn5b.out" 2>&1
BACKUP=$(node -e 'for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) { try { const r = JSON.parse(l); if (r.step === "agent-skill" && r.backup) console.log(r.backup) } catch {} }' "$TMP/scn5b.out")
[ "$(count_backups)" -eq $((BACKUPS_BEFORE + 1)) ] || { echo "✗ SCN-005: expected exactly one new backup (before: $BACKUPS_BEFORE)"; exit 1; }
[ -n "$BACKUP" ] && [ -f "$BACKUP/NOTES.md" ] || { echo "✗ SCN-005: replaced copy was not backed up"; cat "$TMP/scn5b.out"; exit 1; }
case "$BACKUP" in "$TMP/data-scn4/.agents/skill-backups/"*) ;; *) echo "✗ SCN-005: backup outside the data root: $BACKUP"; exit 1 ;; esac
cmp -s "$TMP/edited-marked.md" "$BACKUP/SKILL.md" || { echo "✗ SCN-005: backup SKILL.md differs from what was replaced"; exit 1; }
[ ! -e "$H4/.claude/skills/memoria/NOTES.md" ] && cmp -s "$TEMPLATE" "$H4/$HOST_SKILL_REL" || { echo "✗ SCN-005: target not replaced after backup"; exit 1; }
echo "✓ SCN-005: an edited marked copy is backed up outside ~/.claude/skills, then replaced"

# Review 81bb75d S-4: anything short of both marks in the frontmatter of a SKILL.md in a directory is refused.
refuse_case() {
  local label="$1" home="$TMP/home-refuse-$2"
  if HOME="$home" MEMORIA_HOME="$TMP/data-refuse-$2" "$CLI" setup --agent claude-code >"$TMP/refuse-$2.out" 2>&1; then
    echo "✗ SCN-006: $label was overwritten (exit 0)"; exit 1
  fi
  [ ! -e "$TMP/data-refuse-$2" ] || { echo "✗ SCN-006: $label refusal still created the data root"; exit 1; }
}
mkdir -p "$TMP/home-refuse-one/.claude/skills/memoria"
printf -- '---\nname: memoria\ndeployment_mode: installed\n---\n' > "$TMP/home-refuse-one/$HOST_SKILL_REL"
refuse_case "a SKILL.md with only one mark" one
mkdir -p "$TMP/home-refuse-body/.claude/skills/memoria"
printf -- '---\nname: memoria\n---\n\ndeployment_mode: installed\nrepository: Memoria\n' > "$TMP/home-refuse-body/$HOST_SKILL_REL"
refuse_case "a SKILL.md with the marks only in its body" body
mkdir -p "$TMP/home-refuse-file/.claude/skills"
echo "not a dir" > "$TMP/home-refuse-file/.claude/skills/memoria"
refuse_case "a plain file at the target" file
mkdir -p "$TMP/home-refuse-link/.claude/skills" "$TMP/link-target"
cp "$TEMPLATE" "$TMP/link-target/SKILL.md"
ln -s "$TMP/link-target" "$TMP/home-refuse-link/.claude/skills/memoria"
refuse_case "a symlink at the target" link
echo "✓ SCN-006: one mark, marks in the body, a file, a symlink — all refused before any write"

# SCN-001: the deployed skill states WHEN to use it, with a command and a done criterion per moment.
DEPLOYED="$TMP/.agents/skills/memoria/SKILL.md"
DESCRIPTION=$(grep -m1 '^description:' "$DEPLOYED")
for trigger in "before starting work on an issue or feature" "after making a decision" "pitfall" "after a merge" "release"; do
  echo "$DESCRIPTION" | grep -qiF "$trigger" || { echo "✗ SCN-001: description lacks trigger '$trigger'"; exit 1; }
done
for cmd in ' recall "' ' feedback <recall_id>' ' remember "' ' repo sync <repo>' ' --submit '; do
  grep -qF -- "$cmd" "$DEPLOYED" || { echo "✗ SCN-001: body lacks command '$cmd'"; exit 1; }
done
[ "$(grep -c '^Done when:' "$DEPLOYED")" -ge 5 ] || { echo "✗ SCN-001: fewer than 5 done criteria"; exit 1; }
grep -qF -- 'recall "<issue id or topic>" --mode vector' "$DEPLOYED" || { echo "✗ SCN-001: recall example lacks --mode vector"; exit 1; }
echo "✓ SCN-001: triggers in description; recall/feedback/remember/repo sync each with a command and done criterion"

# SCN-002: the data-root line as written in the deployed skill — exported MEMORIA_HOME wins, else DATA_ROOT.
ROOT_LINE=$(grep -m1 '^MEMORIA_HOME="\${MEMORIA_HOME:-' "$DEPLOYED") || { echo "✗ SCN-002: deployed skill has no MEMORIA_HOME fallback line"; exit 1; }
SKILL_ROOT="$H4/.claude/skills/memoria"
RESOLVED=$(MEMORIA_HOME="/srv/shared-home" SKILL_ROOT="$SKILL_ROOT" bash -c "$ROOT_LINE"'; echo "$MEMORIA_HOME"')
[ "$RESOLVED" = "/srv/shared-home" ] || { echo "✗ SCN-002: exported MEMORIA_HOME not kept (got $RESOLVED)"; exit 1; }
RESOLVED=$(env -u MEMORIA_HOME SKILL_ROOT="$SKILL_ROOT" bash -c "$ROOT_LINE"'; echo "$MEMORIA_HOME"')
[ "$RESOLVED" = "$TMP/data-scn4" ] || { echo "✗ SCN-002: unset MEMORIA_HOME did not fall back to DATA_ROOT (got $RESOLVED)"; exit 1; }
echo "✓ SCN-002: exported MEMORIA_HOME wins; otherwise DATA_ROOT"

echo ""
echo "[bootstrap] Step 4: setup --serve --json (background)"
SERVE_PORT=13917
MEMORIA_HOME="$TMP" "$CLI" setup --serve --port "$SERVE_PORT" --json &
SERVE_PID=$!
trap 'rm -rf "$TMP"; kill "$SERVE_PID" 2>/dev/null || true' EXIT

# Wait for server to be ready (up to 10s)
echo "  Waiting for server on port $SERVE_PORT..."
READY=0
for i in $(seq 1 20); do
  if curl -sf "http://localhost:$SERVE_PORT/v1/health" > /dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 0 ]; then
  echo "✗ Server did not become ready within 10 seconds"
  exit 1
fi

echo ""
echo "[bootstrap] Step 5: GET /v1/health"
HEALTH=$(curl -sf "http://localhost:$SERVE_PORT/v1/health")
echo "$HEALTH" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); const o=JSON.parse(r); process.exit((o.ok && o.data && o.data.ok) ? 0 : 1)" 2>/dev/null || {
  echo "✗ /v1/health: response not ok"
  echo "  Response: $HEALTH"
  exit 1
}
echo "✓ /v1/health returned ok"

echo ""
echo "[bootstrap] Step 6: POST /v1/remember (sample session)"
SESSION_FILE="$ROOT_DIR/examples/session.sample.json"
REMEMBER=$(curl -sf -X POST "http://localhost:$SERVE_PORT/v1/remember" \
  -H "Content-Type: application/json" \
  -d "@$SESSION_FILE")
echo "$REMEMBER" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r).ok ? 0 : 1)" 2>/dev/null || {
  echo "✗ /v1/remember failed"
  echo "  Response: $REMEMBER"
  exit 1
}
SESSION_ID=$(echo "$REMEMBER" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.stdout.write(JSON.parse(r).data.sessionId||'')" 2>/dev/null || true)
echo "✓ /v1/remember ok (sessionId: $SESSION_ID)"

echo ""
echo "[bootstrap] Step 7: POST /v1/recall"
RECALL=$(curl -sf -X POST "http://localhost:$SERVE_PORT/v1/recall" \
  -H "Content-Type: application/json" \
  -d '{"query":"decision","top_k":3}')
echo "$RECALL" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r).ok ? 0 : 1)" 2>/dev/null || {
  echo "✗ /v1/recall failed"
  echo "  Response: $RECALL"
  exit 1
}
echo "✓ /v1/recall ok"

kill "$SERVE_PID" 2>/dev/null || true

# issue-25: `setup --vector` installs the semantic-recall helper's dependencies into the user cache,
# keyed by the helper's lockfile, so a global `npm i -g` upgrade no longer wipes them. The stub
# provider needs only @libsql/client, so CI installs without dev dependencies and skips the model
# warm-up; the full local install is verified by hand (issue-25 S3).
echo ""
echo "[bootstrap] issue-25: setup --vector installs helper deps into the user cache"
HELPER="$ROOT_DIR/skills/memoria-vector"
VEC_HASH=$(node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(process.argv[1])).digest('hex').slice(0,16))" "$HELPER/package-lock.json")
XDG_OK="$TMP/xdg-ok"
# Runs a CLI call whose stdout the assertions parse. A failure inside VAR=$(...) ends the script under
# `set -e` before any message, and the command's own output is captured and lost with it; this names
# the call and shows that output on stderr, which is the only stream that still reaches the log.
cli_ok() {
  local label=$1 rc=0
  shift
  "$@" >"$TMP/cli-ok.out" 2>"$TMP/cli-ok.err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    { echo "✗ $label exited $rc"; cat "$TMP/cli-ok.out" "$TMP/cli-ok.err"; } >&2
    exit 1
  fi
  cat "$TMP/cli-ok.err" >&2
  cat "$TMP/cli-ok.out"
}
VEC_OUT=$(cli_ok "setup --vector (first install)" env XDG_CACHE_HOME="$XDG_OK" MEMORIA_EMBED_PROVIDER=stub MEMORIA_HOME="$TMP/data-vec" "$CLI" setup --vector --json)
VEC_DIR="$XDG_OK/memoria/vector/$VEC_HASH"
echo "$VEC_OUT" | node -e "
const steps=require('fs').readFileSync(0,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const s=steps.find(x=>x.step==='vector-deps');
if(!s||!s.ok) throw new Error('vector-deps step missing or failed: '+JSON.stringify(steps));
if(s.path!==process.argv[1]) throw new Error('vector-deps must report '+process.argv[1]+', got '+s.path);
if(s.provider!=='stub'||s.warmedUp!==false) throw new Error('stub provider must skip the warm-up, got '+JSON.stringify(s));
const sibling=require('fs').existsSync(process.argv[2]+'/node_modules');
if((s.shadowedBy??null)!==(sibling?process.argv[2]+'/node_modules':null)) throw new Error('shadowedBy must name a sibling node_modules exactly when one exists, got '+s.shadowedBy);
" "$VEC_DIR" "$HELPER"
[ -f "$VEC_DIR/.complete" ] || { echo "✗ setup --vector left no .complete"; exit 1; }
[ -d "$VEC_DIR/node_modules/@libsql/client" ] || { echo "✗ @libsql/client not installed in $VEC_DIR"; exit 1; }
[ ! -e "$VEC_DIR/node_modules/@huggingface/transformers" ] || { echo "✗ stub provider must not pull the ~700MB embedder"; exit 1; }
echo "✓ setup --vector: deps in \$XDG_CACHE_HOME/memoria/vector/<lock hash>, .complete written"

# A second run reuses the completed install instead of reinstalling it.
VEC_OUT2=$(cli_ok "setup --vector (reuse)" env XDG_CACHE_HOME="$XDG_OK" MEMORIA_EMBED_PROVIDER=stub MEMORIA_HOME="$TMP/data-vec" "$CLI" setup --vector --json)
echo "$VEC_OUT2" | node -e "
const s=require('fs').readFileSync(0,'utf8').trim().split('\n').map(l=>JSON.parse(l)).find(x=>x.step==='vector-deps');
if(!s||!s.ok||s.reused!==true) throw new Error('second run must reuse the install, got '+JSON.stringify(s));
"
echo "✓ setup --vector: second run reuses the completed install"

# SCN-006: a failed install exits non-zero and leaves nothing that reads as installed.
FAKEBIN="$TMP/fake-npm-bin"
mkdir -p "$FAKEBIN"
printf '#!/bin/sh\necho "simulated npm failure" >&2\nexit 1\n' > "$FAKEBIN/npm"
chmod +x "$FAKEBIN/npm"
XDG_FAIL="$TMP/xdg-fail"
if XDG_CACHE_HOME="$XDG_FAIL" MEMORIA_EMBED_PROVIDER=stub MEMORIA_HOME="$TMP/data-vec" PATH="$FAKEBIN:$PATH" "$CLI" setup --vector >"$TMP/vec-fail.out" 2>&1; then
  echo "✗ SCN-006: setup --vector exited 0 although npm failed"; cat "$TMP/vec-fail.out"; exit 1
fi
grep -q 'simulated npm failure' "$TMP/vec-fail.out" || { echo "✗ SCN-006: failure output does not carry npm's reason"; cat "$TMP/vec-fail.out"; exit 1; }
if [ -d "$XDG_FAIL/memoria/vector" ] && [ -n "$(ls -A "$XDG_FAIL/memoria/vector")" ]; then
  echo "✗ SCN-006: a failed install left files behind:"; ls -la "$XDG_FAIL/memoria/vector"; exit 1
fi
echo "✓ SCN-006: npm failure -> non-zero exit with npm's reason, nothing left in the cache"

# The local-provider warm-up, without downloading the real ~700MB embedder: a fake npm lays down an
# offline stand-in for @huggingface/transformers that logs where it was loaded from and which model
# cache it was handed, and can fail or hang on demand. Runs against an installed-shape copy of the
# package so whether this checkout's helper has a node_modules beside it cannot decide the outcome
# (review 1ffc3a2 S-2, S-4).
echo ""
echo "[bootstrap] issue-25: setup --vector warm-up (offline stand-in embedder)"
ISO="$(cd "$TMP" && pwd -P)/iso-pkg"
mkdir -p "$ISO/dist" "$ISO/skills/memoria-vector"
cp "$ROOT_DIR/dist/cli.mjs" "$ISO/dist/"
cp "$ROOT_DIR/package.json" "$ISO/"
ln -s "$ROOT_DIR/node_modules" "$ISO/node_modules"
cp "$HELPER"/*.mjs "$HELPER/package.json" "$HELPER/package-lock.json" "$ISO/skills/memoria-vector/"
cp -R "$ROOT_DIR/skills/memoria-memory-sync" "$ISO/skills/"
FAKE_TF="$TMP/fake-transformers"
mkdir -p "$FAKE_TF"
printf '{"name":"@huggingface/transformers","version":"0.0.0-fake","main":"index.cjs"}\n' > "$FAKE_TF/package.json"
cat > "$FAKE_TF/index.cjs" <<'EOF'
const fs = require('node:fs')
exports.env = {}
exports.pipeline = async () => {
  if (process.env.FAKE_TF_LOG) {
    fs.writeFileSync(process.env.FAKE_TF_LOG, JSON.stringify({ pid: process.pid, file: __filename, cacheDir: exports.env.cacheDir ?? null }))
  }
  if (process.env.FAKE_TF_MODE === 'fail') throw new Error('simulated model download failure: connect ECONNREFUSED')
  if (process.env.FAKE_TF_MODE === 'hang') await new Promise(() => setInterval(() => {}, 1000))
  if (process.env.FAKE_TF_MODE === 'noisy') console.log('transformers.js: loading model (stdout chatter)')
  return async (texts) => ({ dims: [texts.length, 384], data: new Float32Array(texts.length * 384) })
}
EOF
FAKE_NPM_BIN="$TMP/fake-npm-tf"
mkdir -p "$FAKE_NPM_BIN"
cat > "$FAKE_NPM_BIN/npm" <<'EOF'
#!/bin/sh
# Stand-in for `npm ci`: lays down the offline embedder, or fails the way a real network error does —
# the reason first, then a pile of noise that must not push it out of the error message.
[ "$1" = ci ] || exit 1
if [ "${FAKE_NPM_MODE:-}" = fail ]; then
  echo "npm error code ECONNREFUSED" >&2
  echo "npm error errno ECONNREFUSED" >&2
  # Frames ahead of the reason, so the reason survives only if frames are skipped (review b525453 N-E).
  i=0; while [ $i -lt 12 ]; do echo "npm error     at noise-frame-$i (node:internal/fake:1:1)" >&2; i=$((i+1)); done
  echo "npm error request to https://registry.npmjs.org/@libsql%2fclient failed, reason: connect ECONNREFUSED 127.0.0.1:9" >&2
  echo "npm error A complete log of this run can be found in: /nonexistent/_logs/debug.log" >&2
  exit 1
fi
if [ "${FAKE_NPM_MODE:-}" = lifecycle ]; then
  # What a failing postinstall really prints, taken from a real `npm ci` run (reviews 113c6de N-A and
  # b525453 N-A'): four lines naming the package and command, then Node's uncaught-exception source
  # excerpt, and only then the cause.
  echo "npm error code 1" >&2
  echo "npm error path /nonexistent/node_modules/onnxruntime-node" >&2
  echo "npm error command failed" >&2
  echo "npm error command sh -c node ./script/install" >&2
  echo "npm error Downloading \"https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.linux/1.24.3/microsoft.ml.onnxruntime.gpu.linux.1.24.3.nupkg\"..." >&2
  echo "npm error node:internal/process/promises:394" >&2
  echo "npm error     triggerUncaughtException(err, true /* fromPromise */);" >&2
  echo "npm error     ^" >&2
  echo "npm error" >&2
  echo "npm error [Error: Unknown system error -122: Unknown system error -122, write] {" >&2
  echo "npm error   errno: -122," >&2
  echo "npm error   code: 'Unknown system error -122'," >&2
  echo "npm error   syscall: 'write'" >&2
  echo "npm error }" >&2
  echo "npm error" >&2
  echo "npm error Node.js v22.20.0" >&2
  echo "npm error A complete log of this run can be found in: /nonexistent/_logs/debug.log" >&2
  exit 1
fi
mkdir -p node_modules/@huggingface && cp -R "$FAKE_TF_SRC" node_modules/@huggingface/transformers
EOF
chmod +x "$FAKE_NPM_BIN/npm"
iso_vec() { env FAKE_TF_SRC="$FAKE_TF" MEMORIA_EMBED_PROVIDER=local MEMORIA_HOME="$TMP/data-iso" PATH="$FAKE_NPM_BIN:$PATH" "$@" node "$ISO/dist/cli.mjs" setup --vector --json; }
no_marker_under() { [ -z "$(find "$1" -name .complete 2>/dev/null)" ] && [ -z "$(find "$1" -maxdepth 3 -name '*.partial-*' 2>/dev/null)" ]; }

XW1="$TMP/xdg-w1"
W1=$(cli_ok "setup --vector warm-up (W1)" iso_vec XDG_CACHE_HOME="$XW1" FAKE_TF_LOG="$TMP/w1.log")
node -e "
const s=require('fs').readFileSync(0,'utf8').trim().split('\n').map(l=>JSON.parse(l)).find(x=>x.step==='vector-deps');
const log=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));
const models=process.argv[1]+'/memoria/vector/models';
if(!s||!s.ok||s.warmedUp!==true) throw new Error('local warm-up must succeed, got '+JSON.stringify(s));
if(s.modelCacheDir!==models) throw new Error('reported modelCacheDir must be '+models+', got '+s.modelCacheDir);
if(log.cacheDir!==models) throw new Error('transformers env.cacheDir must be '+models+', got '+log.cacheDir);
if(!log.file.startsWith(process.argv[1]+'/memoria/vector/')) throw new Error('warm-up must load the embedder from the cache install, got '+log.file);
" "$XW1" "$TMP/w1.log" <<<"$W1"
[ -f "$XW1/memoria/vector/$VEC_HASH/.complete" ] || { echo "✗ warm-up succeeded but no .complete"; exit 1; }
echo "✓ local warm-up: embedder loaded from the cache install, model cache = \$XDG_CACHE_HOME/memoria/vector/models"

XW2="$TMP/xdg-w2"
if W2=$(iso_vec XDG_CACHE_HOME="$XW2" FAKE_TF_MODE=fail 2>&1); then
  echo "✗ warm-up failure must exit non-zero"; echo "$W2"; exit 1
fi
echo "$W2" | grep -q 'simulated model download failure' || { echo "✗ warm-up failure lost its reason: $W2"; exit 1; }
no_marker_under "$XW2" || { echo "✗ failed warm-up left an install behind:"; find "$XW2"; exit 1; }
echo "✓ warm-up failure -> non-zero with the embedder's reason, nothing that reads as installed"

# Review 1ffc3a2 M-1: an interrupted warm-up (Ctrl-C, OOM kill) must not leave a marker behind either.
XW3="$TMP/xdg-w3"
iso_vec XDG_CACHE_HOME="$XW3" FAKE_TF_MODE=hang FAKE_TF_LOG="$TMP/w3.log" >/dev/null 2>&1 &
W3_PID=$!
for _ in $(seq 1 100); do [ -s "$TMP/w3.log" ] && break; sleep 0.2; done
[ -s "$TMP/w3.log" ] || { echo "✗ hanging warm-up never started"; kill -9 "$W3_PID" 2>/dev/null; exit 1; }
kill -9 "$W3_PID" 2>/dev/null || true
kill -9 "$(node -p "JSON.parse(require('fs').readFileSync('$TMP/w3.log','utf8')).pid")" 2>/dev/null || true
wait "$W3_PID" 2>/dev/null || true
[ -z "$(find "$XW3" -name .complete 2>/dev/null)" ] || { echo "✗ M-1: a warm-up killed mid-way left .complete:"; find "$XW3" -name .complete; exit 1; }
echo "✓ warm-up killed mid-way -> no .complete anywhere"

# A dead run's partial directory is reclaimed by the next run instead of piling up (~720MB each).
XW5="$TMP/xdg-w5"
mkdir -p "$XW5/memoria/vector/$VEC_HASH.partial-2147483646/node_modules"
cli_ok "setup --vector (W5, after a dead partial)" iso_vec XDG_CACHE_HOME="$XW5" >/dev/null
[ ! -e "$XW5/memoria/vector/$VEC_HASH.partial-2147483646" ] || { echo "✗ a dead run's partial dir was left in place"; exit 1; }
echo "✓ partial dir of a dead run -> reclaimed"

# Review 1ffc3a2 S-2: a node_modules beside the helper must not hijack the warm-up of the cache install.
mkdir -p "$ISO/skills/memoria-vector/node_modules"
XW4="$TMP/xdg-w4"
W4=$(cli_ok "setup --vector beside a sibling node_modules (W4)" iso_vec XDG_CACHE_HOME="$XW4" FAKE_TF_LOG="$TMP/w4.log")
node -e "
const s=require('fs').readFileSync(0,'utf8').trim().split('\n').map(l=>JSON.parse(l)).find(x=>x.step==='vector-deps');
const log=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));
if(!s||!s.ok||s.warmedUp!==true) throw new Error('warm-up must succeed despite a sibling node_modules, got '+JSON.stringify(s));
if(s.shadowedBy!==process.argv[3]) throw new Error('shadowedBy must name '+process.argv[3]+', got '+s.shadowedBy);
if(!log.file.startsWith(process.argv[1]+'/memoria/vector/')) throw new Error('warm-up must load the cache install, not the sibling, got '+log.file);
" "$XW4" "$TMP/w4.log" "$ISO/skills/memoria-vector/node_modules" <<<"$W4"
rm -rf "$ISO/skills/memoria-vector/node_modules"
echo "✓ sibling node_modules present -> warm-up still exercises the cache install, shadowedBy reported"

# Review 1ffc3a2 S-1: a real npm failure buries its reason under noise; the reason must survive.
if WF=$(iso_vec XDG_CACHE_HOME="$TMP/xdg-wf" FAKE_NPM_MODE=fail 2>&1); then
  echo "✗ npm failure must exit non-zero"; exit 1
fi
echo "$WF" | grep -q 'ECONNREFUSED 127.0.0.1:9' || { echo "✗ npm failure lost its reason: $WF"; exit 1; }
! echo "$WF" | grep -q 'noise-frame' || { echo "✗ npm failure message still carries stack frames: $WF"; exit 1; }
echo "✓ noisy npm failure -> the reason line survives"

if WL=$(iso_vec XDG_CACHE_HOME="$TMP/xdg-wl" FAKE_NPM_MODE=lifecycle 2>&1); then
  echo "✗ npm lifecycle failure must exit non-zero"; exit 1
fi
echo "$WL" | grep -q 'Unknown system error -122, write' || { echo "✗ npm lifecycle failure lost its cause: $WL"; exit 1; }
echo "$WL" | grep -q 'onnxruntime-node' || { echo "✗ npm lifecycle failure lost the failing package: $WL"; exit 1; }
# The excerpt, its caret and blank lines carry no cause; each one left in costs a line of the budget.
for noise in 'node:internal/process/promises:394' 'triggerUncaughtException' 'npm error     ^' 'npm error |'; do
  ! echo "$WL" | grep -qF "$noise" || { echo "✗ npm lifecycle failure message still carries noise '$noise': $WL"; exit 1; }
done
echo "✓ npm postinstall failure -> both the failing package and its cause survive"

# Review 113c6de N-B: anything the embedder prints to stdout must not turn a successful warm-up into a failure.
XWN="$TMP/xdg-wn"
WN=$(iso_vec XDG_CACHE_HOME="$XWN" FAKE_TF_MODE=noisy) || { echo "✗ warm-up with stdout chatter was reported as failed: $WN"; exit 1; }
[ -f "$XWN/memoria/vector/$VEC_HASH/.complete" ] || { echo "✗ warm-up with stdout chatter left no .complete"; exit 1; }
echo "✓ embedder chatter on stdout -> warm-up still succeeds"

echo ""
echo "[bootstrap] ok"
