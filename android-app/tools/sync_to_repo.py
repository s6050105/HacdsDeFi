import os, shutil, sys

SRC = r'D:\hacds_server-main\android-app'
DST = r'D:\hacds\android-app'

# 排除：构建产物、IDE 缓存、密钥、机器相关配置
EXCLUDE_DIRS = {'build', '.gradle', '.idea', 'keystore', '.kotlin'}
EXCLUDE_FILES = {'local.properties', 'verify.txt', 'remain.txt', 'remain_all.txt'}

copied = 0
skipped = []

for root, dirs, files in os.walk(SRC):
    # 过滤目录
    dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
    rel = os.path.relpath(root, SRC)
    # 跳过临时目录
    if rel.startswith('tmp') or rel.startswith('tools/tmp'):
        continue
    for f in files:
        if f in EXCLUDE_FILES:
            skipped.append(os.path.join(rel, f)); continue
        if f.endswith(('.jks', '.keystore', '.apk', '.aab')):
            skipped.append(os.path.join(rel, f)); continue
        if f.startswith('_') or f.endswith(('.pyc',)):
            skipped.append(os.path.join(rel, f)); continue
        s = os.path.join(root, f)
        d = os.path.join(DST, rel, f)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)
        copied += 1

print('copied:', copied)
print('skipped:', skipped)
