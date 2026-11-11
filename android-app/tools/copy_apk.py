import shutil, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
src = os.path.join(ROOT, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
dst = os.path.join(ROOT, 'dist', 'HacdsDeFi-0.1.0-arm64.apk')

os.makedirs(os.path.dirname(dst), exist_ok=True)
shutil.copy2(src, dst)
print('OK', dst, os.path.getsize(dst))
