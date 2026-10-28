import json, os

root = '.gev-logs/phase2'
m = json.load(open(os.path.join(root, 'metrics.json'), encoding='utf-8'))
iso = json.load(open(os.path.join(root, 'isolation/edge-isolation.json'), encoding='utf-8'))
det = json.load(open(os.path.join(root, 'determinism.json'), encoding='utf-8'))

print('viewport', m['viewport'], '| compare', m['compareImage']['layout'])
print('method.fps  :', m['method']['fps'][:120], '...')
for v in m['variants']:
    f = v['fps']
    print('%s primary runs=%d median=%s | supp runs=%d median=%s | base runs=%d median=%s | centerChromatic %s'
          % (v['key'], len(f['primary']['runs']), f['primary']['median'],
             len(f['supplementary']['runs']), f['supplementary']['median'],
             len(f['baselineNoGlass']['runs']), f['baselineNoGlass']['median'],
             json.dumps({k: v['centerChromatic'][k] for k in ('edgeOnVsOff_noText', 'edgeOnVsOff_withText', 'legacy_withTextVsNoText', 'interiorArea')})))
print('texts have rect:', all('rect' in t for v in m['variants'] for t in v['texts']), '| n=', len(m['variants'][0]['texts']))
print('iso all1536x730', iso['inputs']['all1536x730'], '| textBoxes', iso['dataCard']['textBoxes'])
tp = iso['threePart']
print('part1', tp['part1_flatCenter']['changed'], '| part3', tp['part3_textAA']['changed'],
      '| legacy t>1', tp['legacy_round3_metric']['changed'], '| legacy t>0', iso['sweeps']['legacy']['changed']['0'],
      '| band', tp['part2_ringBand']['measuredBandWidthPx'])
print('det differing fields', det['differingFieldCount'], 'maxΔ', det['maxAbsDelta'])
