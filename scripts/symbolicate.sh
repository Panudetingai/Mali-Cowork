#!/usr/bin/env bash
#
# symbolicate.sh — แปลง stack address จาก crash log ของ Mali ให้เป็นชื่อฟังก์ชัน + บรรทัด
#
#   ./scripts/symbolicate.sh -d <path/to/Mali.dSYM> -l 0x102bd8000 0x10341b5ac 0x103417fc0 ...
#   ./scripts/symbolicate.sh -d <dSYM> -l 0x102bd8000 -f addresses.txt
#
# ถ้าไม่ระบุ -d จะไปหา dSYM ใน src-tauri/target/release/ และ ~/Library/Developer/Xcode/Archives ให้เอง
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DSYM=""
LOAD_ADDR=""
ARCH=""
ADDR_FILE=""
ADDRS=()

usage() {
  cat <<'USAGE'
usage: symbolicate.sh [-d DSYM] -l LOAD_ADDRESS [-a ARCH] [-f FILE] [ADDR ...]

  -d DSYM   ไฟล์ .dSYM หรือ binary ที่มี symbol (ถ้าเว้นไว้จะค้นหาอัตโนมัติ)
  -l ADDR   Base / load address ของ image จาก crash log เช่น 0x102bd8000  (บังคับ)
  -a ARCH   arm64 (default) หรือ x86_64
  -f FILE   อ่าน address จากไฟล์ (บรรทัดละ 1 ตัว หรือวาง crash log ทั้งก้อนก็ได้)
  ADDR ...  stack address ที่ต้องการ symbolicate

ตัวอย่าง:
  ./scripts/symbolicate.sh -l 0x102bd8000 \
      0x10341b5ac 0x103417fc0 0x103174230 0x102bece54 0x103019d44
USAGE
}

while getopts ":d:l:a:f:h" opt; do
  case "$opt" in
    d) DSYM="$OPTARG" ;;
    l) LOAD_ADDR="$OPTARG" ;;
    a) ARCH="$OPTARG" ;;
    f) ADDR_FILE="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
ADDRS=("$@")

# ดึง address จากไฟล์/stdin ได้ด้วย — กรองเอาเฉพาะ hex ที่หน้าตาเหมือน address
if [[ -n "$ADDR_FILE" ]]; then
  while read -r a; do ADDRS+=("$a"); done < <(grep -oE '0x[0-9a-fA-F]{6,16}' "$ADDR_FILE")
fi

if [[ -z "$LOAD_ADDR" || ${#ADDRS[@]} -eq 0 ]]; then
  usage >&2
  exit 2
fi

# ---------- หา dSYM ----------
find_dsym() {
  local candidates=()
  while IFS= read -r line; do candidates+=("$line"); done < <(
    find "$ROOT/src-tauri/target/release" -maxdepth 3 -name '*.dSYM' 2>/dev/null
    find "$ROOT/src-tauri/target/release/bundle" -maxdepth 6 -name '*.dSYM' 2>/dev/null
    find "$HOME/Library/Developer/Xcode/Archives" -maxdepth 6 -name 'Mali*.dSYM' 2>/dev/null
  )
  [[ ${#candidates[@]} -gt 0 ]] && printf '%s\n' "${candidates[0]}"
}

if [[ -z "$DSYM" ]]; then
  DSYM="$(find_dsym || true)"
fi

if [[ -z "$DSYM" || ! -e "$DSYM" ]]; then
  cat >&2 <<'ERR'
ไม่พบไฟล์ .dSYM

Mali build ปัจจุบันตั้ง `strip = true` และไม่ได้ตั้ง `debug` ใน [profile.release]
=> cargo ไม่ได้สร้าง dSYM ออกมาเลย ดังนั้น binary ของ 0.1.2 ที่ปล่อยไปแล้ว
   symbolicate ไม่ได้ ถ้าไม่มีสำเนา dSYM เก็บไว้

วิธีเปิดสำหรับ build ต่อไป — เพิ่มใน src-tauri/Cargo.toml:

    [profile.release]
    debug = true
    split-debuginfo = "packed"   # macOS: ได้ target/release/Mali.dSYM
    strip = true                 # binary ยังเล็กเท่าเดิม, symbol อยู่ใน dSYM

แล้วเก็บ Mali.dSYM ไว้คู่กับทุก release (เช่นแนบเป็น artifact ใน GitHub Release)
ERR
  exit 1
fi

# ชี้ไปที่ DWARF binary ข้างในถ้าส่ง .dSYM bundle มา
SYMBOLS="$DSYM"
if [[ -d "$DSYM" ]]; then
  SYMBOLS="$(find "$DSYM/Contents/Resources/DWARF" -type f -maxdepth 1 | head -n 1)"
fi
[[ -n "$SYMBOLS" && -f "$SYMBOLS" ]] || { echo "อ่าน DWARF ใน $DSYM ไม่ได้" >&2; exit 1; }

# ---------- เดา arch ----------
if [[ -z "$ARCH" ]]; then
  if lipo -info "$SYMBOLS" 2>/dev/null | grep -q 'x86_64' && ! lipo -info "$SYMBOLS" 2>/dev/null | grep -q 'arm64'; then
    ARCH="x86_64"
  else
    ARCH="arm64"
  fi
fi

echo "dSYM   : $DSYM"
echo "symbols: $SYMBOLS"
echo "arch   : $ARCH"
echo "load   : $LOAD_ADDR"
echo "UUID   : $(dwarfdump --uuid "$SYMBOLS" 2>/dev/null | head -n 2 | sed 's/^/         /')"
echo

# ---------- symbolicate ----------
printf '%-16s %-12s %s\n' "ADDRESS" "OFFSET" "SYMBOL"
printf '%-16s %-12s %s\n' "----------------" "------------" "------------------------------------"

for addr in "${ADDRS[@]}"; do
  offset=$(printf '0x%x' $(( addr - LOAD_ADDR )))
  sym=$(atos -arch "$ARCH" -o "$SYMBOLS" -l "$LOAD_ADDR" "$addr" 2>/dev/null || true)
  [[ -z "$sym" ]] && sym="(symbolicate ไม่ได้)"
  printf '%-16s %-12s %s\n' "$addr" "$offset" "$sym"
done

echo
echo "หมายเหตุ: ถ้าผลออกมาเป็น address ซ้ำเดิม แปลว่า UUID ของ dSYM ไม่ตรงกับ binary ที่ crash"
echo "ตรวจได้ด้วย: dwarfdump --uuid \"$SYMBOLS\"  เทียบกับ UUID ในหัว crash log"
