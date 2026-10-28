import json, os
base = r'D:\Hermes\gods-eye-view\.gev-logs\review-t829-r2'
m = json.load(open(os.path.join(base, 'C-matrix.json'), encoding='utf-8'))['checks']
print('keys:', list(m.keys()))
ini = m['initial']; col = m['collapse']; rel = m['reload']
print('collapse keys:', list(col.keys()))
print('stillOpen:', col['stillOpen'])
print()
print('initial mini rects / reload rects:')
for k, v in ini.items():
    same = rel[k]['rect'] == v['rect'] if rel.get(k) else None
    print(' ', k.ljust(22), v['rect'], 'open=', v['open'], 'bgA=', v['bgA'], 'bf=', v['bf'], '| reload same rect =', same, 'open=', rel[k]['open'] if rel.get(k) else None)
print()
print('seven_headers (card-rect retest in D):')
d = json.load(open(os.path.join(base, 'D-confirm.json'), encoding='utf-8'))
for x in d['seven_headers_cardrect']:
    print(' ', x['id'].ljust(22), 'ownHit=', x['ownHit'], 'hit=', x['preHit'], 'owner=', x['hitOwner'], 'openAfter=', x['openAfter'], 'bgA=', x['bgA'])
print()
print('toast after real tilt click:', json.dumps(d['toast_after_real_tilt_click'], ensure_ascii=False))
print()
print('mutex:', json.dumps(m['mutex'])[:400])
print('pp_scroll:', json.dumps(m['pp_scroll']))
print('fps:', json.dumps(m['fps']))
