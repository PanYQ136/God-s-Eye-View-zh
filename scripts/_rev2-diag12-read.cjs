const d = require('../.gev-logs/rev2-accept/diag12.json');
d.log.forEach((x, i) => console.log(i, x.id, '| g.rect', JSON.stringify(x.state.rect), '| cls', x.state.cls.slice(0, 44), '| hit', x.state.hitAtHeaderCentre, '| owner', x.state.hitOwner));
console.log('--- timeline owners');
d.timeline.forEach((x) => console.log(x.t, '| g', JSON.stringify(x.g.rect), x.g.cls.slice(0, 34), '| hit', x.g.hitAtHeaderCentre, '| owner', x.g.hitOwner, '| cctv', JSON.stringify(x.c.rect), x.c.cls.slice(-12)));
