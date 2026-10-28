import json, re, sys

t = open('.gev-logs/ego-round04.log', encoding='utf-8', errors='replace').read()
m = re.search(r'FINALSECTIONS (\{.*\})', t)
if not m:
    print('NO FINALSECTIONS'); sys.exit(1)
d = json.loads(m.group(1))
init = d['initial']
print('INIT openBy', init['openBy'], 'xGlyphs', init['xGlyphs'], 'overlap', init['overlap'], 'shot', init['shot'])
for k, v in init['cards'].items():
    if v: print('   ', k, v['r'], 'col=', v['col'], v['bg'], 'blur=', v['blur'])
print('\n--- 7 headers ---')
for s in d['headers']:
    if s['id'].endswith(':close'):
        print('CLOSE', s['id'][:-6], 'col=', s['closed']['col'], 'rectBack=', s['rectBack'], s['closed']['r'])
    else:
        print('OPEN ', s['id'], 'hit=', s['pt']['hit'], 'col=', s['opened']['col'], 'inView=', s['opened']['inView'],
              s['opened']['r'], 'bg=', s['opened']['bg'], 'blur=', s['opened']['blur'], 'shot=', s['shot'])
print('\n--- switches ---')
for s in d['switches']:
    print(s['from'], '->', s['to'], 'openBy=', s['openBy'], 'fromCol=', s['fromCollapsed'], 'fromVis=', s['fromVisible'],
          'toCol=', s['toCollapsed'], 'toInView=', s['toInView'], 'toBg=', s['toBg'], 'toBlur=', s['toBlur'], 'cnt=', s['groupCount'])
print('\n--- pp ---')
p = d['pp']['detail']
print('rect', p['rect'], 'rows', p['rows'], 'minGap', p['minGap'], 'gaps', p['gaps'])
print('scroll', p['scrollTop'], '/', p['scrollHeight'], 'clientH', p['clientHeight'])
print('btns', len(p['btns']), 'darkBtns', p['darkBtns'], 'solidBtns', p['solidBtns'])
print('after wheel', d['pp']['after'], 'shot', d['pp']['shot'])
print('\n--- rapid ---')
r = d['rapid']
print('openBy', r['openBy'], 'overlap', r['overlap'], 'shot', r['shot'])
for k, v in r['cards'].items():
    if v: print('   ', k, v['r'], 'col=', v['col'], 'inView=', v['inView'])
print('\n--- collapse ---')
c = d['collapse']
print('openBy', c['openBy'], 'overlap', c['overlap'], 'rectDiff', c['rectDiff'], 'xGlyphs', c['xGlyphs'], 'shot', c['shot'])
