import json, os, sys, urllib.request

TOKEN = os.environ.get('GH_TOKEN', '')
REPO = 's6050105/HacdsDeFi'


def api(path, method='GET', data=None, ctype='application/json'):
    url = 'https://api.github.com' + path
    body = None
    headers = {'Authorization': 'token ' + TOKEN, 'Accept': 'application/vnd.github+json',
               'User-Agent': 'hacds-android'}
    if data is not None:
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode()
            headers['Content-Type'] = ctype
        else:
            body = data
            headers['Content-Type'] = ctype
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    try:
        return json.loads(raw)
    except Exception:
        return raw


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'list'
    if cmd == 'list':
        d = api('/repos/%s/releases' % REPO)
        for r in d:
            print('tag=%s name=%s draft=%s prerelease=%s' % (
                r['tag_name'], r.get('name'), r['draft'], r['prerelease']))
            for a in r.get('assets', []):
                print('   asset: %s (%d bytes)' % (a['name'], a['size']))
            print('   upload_url:', r['upload_url'])
