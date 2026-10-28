import json, re

t = open('.gev-logs/ego-round05.log', encoding='utf-8', errors='replace').read()
m = re.search(r'DIAG (\{.*\})', t)
if not m:
    print('NO DIAG'); print(t[-3000:]); raise SystemExit(1)
d = json.loads(m.group(1))
print('shotOk:', d.get('shotOk'))
print('init:', d['init']['vw'], 'x', d['init']['vh'], 'open=', d['init']['open'])
for k, v in d['init']['cards'].items():
    if v: print('   ', k, v['r'], 'col=', v['col'])
print('\n--- LEFT SWITCH ---')
for s in d['left']:
    st = s['s']
    print(s['step'], '| probe:', s['p'] and (s['p']['x'], s['p']['y'], 'hitCard=' + s['p']['hitCard'], 'hdr=' + str(s['p']['header'])))
    print('   open=', st['open'])
    for k in ['data-panel', 'scene-panel']:
        c = st['cards'][k]
        print('    ', k, c['r'], 'col=', c['col'], 'fl=', c['fl'], 'inView=', c['inView'])
print('\n--- RAPID / DOCK ---')
for s in d['dock']:
    print('t=', s['at'], 'open=', s['open'])
    for k, v in s['dockCards'].items():
        print('    ', k, v['r'], 'col=', v['col'], 'inView=', v['inView'])
