#!/usr/bin/env bash
# ============================================================================
# 交叉编译 Rust 引擎为 Android JNI 库（arm64-v8a + x86_64）
#
# 用法：  ./build-engine.sh [arm64|x86_64|both]
# 产物：  app/src/main/jniLibs/<abi>/libhacds_txbuild.so
#
# 源：D:\hacash_fullnode 的 `android-jni` crate（cdylib，包名 hacds_android_jni，
#     库名 hacds_txbuild）。它只依赖 testkit（纯 rlib），因此**不会**污染 PC 侧
#     `hacds_txbuild.exe` 的构建。
#
# ⚠ Windows + NDK 的坑（已实测确认，别改）：
#   1) C 依赖（x16rs-sys）用 NDK 的 .cmd 包装：CC_<target>=…-clang.cmd
#   2) **链接器必须用 clang.exe 而非 .cmd**：.cmd 经 cmd.exe 二次解析会把
#      `-Wl,--version-script=…` 这类参数搞坏（cdylib 才会带 version-script，
#      普通 bin 不触发，所以历史上没暴露）。
#   3) 用 clang.exe 当链接器时不会自动带 --target，必须通过 **target 作用域**
#      的 RUSTFLAGS 补（CARGO_TARGET_<T>_RUSTFLAGS），不能用全局 RUSTFLAGS
#      ——否则宿主的 build script（如 num-traits）会被带上 android target 而失败。
# ============================================================================
set -euo pipefail

NDK=/d/Android/sdk/ndk/26.1.10909125/toolchains/llvm/prebuilt/windows-x86_64/bin
SRC=/d/hacash_fullnode
OUT="$(cd "$(dirname "$0")" && pwd)/app/src/main/jniLibs"

export PATH="$HOME/.cargo/bin:$PATH"

build_one() {
  local rt="$1" cc="$2" jni_dir="$3"
  local envkey="${rt//-/_}"
  local upr="${rt^^}"; upr="${upr//-/_}"

  echo "== 构建 $jni_dir ($rt) =="
  export "CC_${envkey}=$NDK/${cc}21-clang.cmd"
  export "CXX_${envkey}=$NDK/${cc}21-clang++.cmd"
  export "AR_${envkey}=$NDK/llvm-ar.exe"
  export "RANLIB_${envkey}=$NDK/llvm-ranlib.exe"
  export "CARGO_TARGET_${upr}_LINKER=$NDK/clang.exe"
  export "CARGO_TARGET_${upr}_RUSTFLAGS=-C link-arg=--target=${rt}21"

  ( cd "$SRC" && cargo build --offline --release --target "$rt" -p hacds_android_jni )

  local so="$SRC/target/$rt/release/libhacds_txbuild.so"
  [ -f "$so" ] || { echo "  ✗ 未找到 .so"; return 1; }

  mkdir -p "$OUT/$jni_dir"
  cp -f "$so" "$OUT/$jni_dir/libhacds_txbuild.so"
  printf "  ✓ %s  %s\n" "$jni_dir" "$(stat -c %s "$OUT/$jni_dir/libhacds_txbuild.so" | numfmt --to=iec 2>/dev/null || echo '?')"
}

case "${1:-both}" in
  arm64)  build_one aarch64-linux-android aarch64-linux-android arm64-v8a ;;
  x86_64) build_one x86_64-linux-android  x86_64-linux-android  x86_64 ;;
  both)
    build_one aarch64-linux-android aarch64-linux-android arm64-v8a
    build_one x86_64-linux-android  x86_64-linux-android  x86_64
    ;;
  *) echo "用法: $0 [arm64|x86_64|both]"; exit 1 ;;
esac

echo
echo "产物："
find "$OUT" -name '*.so' -exec ls -la {} \;
