import subprocess, os, sys

apk = r'D:\hacds_server-main\android-app\app\build\outputs\apk\release\app-release.apk'
asr = r'D:\Android\sdk\build-tools\36.0.0\apksigner.bat'
env = dict(os.environ)
env['JAVA_HOME'] = r'D:\Dev\jdk-17.0.20.1+1'

r = subprocess.run([asr, 'verify', '--verbose', '--print-certs', apk],
                   capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
out = (r.stdout or '')
err = (r.stderr or '')
# 写文件避免控制台编码问题
open(r'D:\hacds_server-main\android-app\verify.txt', 'w', encoding='utf-8').write(
    'rc=%d\n--- STDOUT ---\n%s\n--- STDERR ---\n%s' % (r.returncode, out, err))
print('rc =', r.returncode)
print('detail written to verify.txt')
