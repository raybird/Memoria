#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
RELEASE_DIR="$DIST_DIR/release"
INSTALL_DIR="$DIST_DIR/install"
VERSION="$(node -e "const fs=require('node:fs');const pkg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(pkg.version);" "$ROOT_DIR/package.json")"
PLATFORM="linux-x64"
ARTIFACT_BASENAME="memoria-${PLATFORM}-v${VERSION}"
STAGE_DIR="$RELEASE_DIR/$ARTIFACT_BASENAME"
ARTIFACT_TAR_PATH="$RELEASE_DIR/${ARTIFACT_BASENAME}.tar"
ARTIFACT_PATH="$RELEASE_DIR/${ARTIFACT_BASENAME}.tar.gz"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to package release artifacts" >&2
  exit 1
fi

rm -rf "$STAGE_DIR" "$ARTIFACT_TAR_PATH" "$ARTIFACT_PATH" "$INSTALL_DIR"
mkdir -p "$STAGE_DIR/bin" "$STAGE_DIR/lib" "$INSTALL_DIR"

pnpm --dir "$ROOT_DIR" run build

cp "$ROOT_DIR/dist/cli.mjs" "$STAGE_DIR/lib/cli.mjs"
cp "$ROOT_DIR/install.sh" "$STAGE_DIR/install.sh"
cp "$ROOT_DIR/package.json" "$STAGE_DIR/package.json"
cp "$ROOT_DIR/pnpm-lock.yaml" "$STAGE_DIR/pnpm-lock.yaml"

cat <<'EOF' > "$INSTALL_DIR/memoria"
#!/usr/bin/env bash

set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MEMORIA_HOME="${MEMORIA_HOME:-$RUNTIME_DIR}"
exec node "$RUNTIME_DIR/lib/cli.mjs" "$@"
EOF

chmod +x "$INSTALL_DIR/memoria" "$STAGE_DIR/install.sh"
cp "$INSTALL_DIR/memoria" "$STAGE_DIR/bin/memoria"
chmod +x "$STAGE_DIR/bin/memoria"

printf '%s\n' "$VERSION" > "$STAGE_DIR/VERSION"

pnpm install --prod --frozen-lockfile --dir "$STAGE_DIR"

node -e "const fs=require('node:fs');const pkg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const runtimePkg={name:pkg.name,version:pkg.version,private:true,type:pkg.type,bin:{memoria:'./bin/memoria'},engines:pkg.engines,dependencies:pkg.dependencies};fs.writeFileSync(process.argv[2],JSON.stringify(runtimePkg,null,2)+'\n');" "$ROOT_DIR/package.json" "$STAGE_DIR/package.json"

tar \
  --sort=name \
  --mtime='UTC 2024-01-01' \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -C "$RELEASE_DIR" \
  -cf "$ARTIFACT_TAR_PATH" \
  "$ARTIFACT_BASENAME"

gzip -n -f "$ARTIFACT_TAR_PATH"

for required_entry in \
  "$ARTIFACT_BASENAME/bin/memoria" \
  "$ARTIFACT_BASENAME/lib/cli.mjs" \
  "$ARTIFACT_BASENAME/install.sh" \
  "$ARTIFACT_BASENAME/package.json" \
  "$ARTIFACT_BASENAME/node_modules/better-sqlite3"; do
  if ! grep -Fxq "$required_entry" < <(tar -tf "$ARTIFACT_PATH"); then
    echo "missing required artifact entry: $required_entry" >&2
    exit 1
  fi
done

echo "release_stage=$STAGE_DIR"
echo "release_launcher=$INSTALL_DIR/memoria"
echo "release_artifact=$ARTIFACT_PATH"
echo "artifact_layout:"
echo "  $ARTIFACT_BASENAME/bin/memoria"
echo "  $ARTIFACT_BASENAME/lib/cli.mjs"
echo "  $ARTIFACT_BASENAME/install.sh"
echo "  $ARTIFACT_BASENAME/package.json"
echo "  $ARTIFACT_BASENAME/node_modules/better-sqlite3"
