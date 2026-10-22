"""
生成 Android 发布签名密钥库（keytool）。

⚠ 口令**不写死在代码里**：从环境变量读取，避免把口令提交进仓库。

用法：
    set HACDS_KS_PASS=<你的口令>          # Windows cmd
    export HACDS_KS_PASS=<你的口令>       # bash
    python -I tools/gen_keystore.py

可选环境变量：
    HACDS_KS_PATH  密钥库输出路径（默认 ../keystore/hacds-release.jks）
    HACDS_KEY_ALIAS  别名（默认 hacds）
    JAVA_HOME      用于定位 keytool（或改 KEYTOOL 变量）
"""
import subprocess, os, sys

JAVA_HOME = os.environ.get('JAVA_HOME', '')
KEYTOOL = os.environ.get('KEYTOOL') or (
    os.path.join(JAVA_HOME, 'bin', 'keytool.exe') if JAVA_HOME else 'keytool')

here = os.path.dirname(os.path.abspath(__file__))
ks = os.environ.get('HACDS_KS_PATH') or os.path.join(here, '..', 'keystore', 'hacds-release.jks')
alias = os.environ.get('HACDS_KEY_ALIAS', 'hacds')
pw = os.environ.get('HACDS_KS_PASS')

if not pw:
    print('ERROR: 请先设置环境变量 HACDS_KS_PASS（密钥库口令），不要把口令写进代码。')
    sys.exit(2)

if os.path.exists(ks):
    print('keystore already exists:', os.path.getsize(ks))
    sys.exit(0)

r = subprocess.run(
    [KEYTOOL, '-genkeypair', '-keystore', ks, '-alias', alias,
     '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
     '-storepass', pw, '-keypass', pw,
     '-dname', 'CN=HacdsDeFi,O=HacdsDeFi,C=CN'],
    capture_output=True, text=True, encoding='utf-8', errors='replace')

print('rc =', r.returncode)
print('exists:', os.path.exists(ks), os.path.getsize(ks) if os.path.exists(ks) else 0)
if r.returncode != 0:
    print('ERR:', (r.stderr or '')[-300:])
