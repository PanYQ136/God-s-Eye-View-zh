const d = require('../.gev-logs/rev2-accept/oldheader.json');
d.out.forEach((c) => {
  const v = c.verdict || {};
  console.log(c.case, '| afterSwap', JSON.stringify(c.openedAfterSwap), '| oldHeader owner', c.oldHeader && c.oldHeader.owner,
    'onOwn', c.oldHeader && c.oldHeader.onOwnHeader, 'hidden', c.oldHeader && c.oldHeader.hidden,
    'rect', JSON.stringify(c.oldHeader && c.oldHeader.rect), '| afterOldClick', JSON.stringify(c.openedAfterOldClick),
    '| verdict', JSON.stringify(v));
});
console.log('trust', JSON.stringify(d.trust));
