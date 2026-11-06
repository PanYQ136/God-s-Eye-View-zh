import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  LEGACY_LAYER_STATE_TOKENS,
  LAYER_STATE_TOKEN_ALPHABET,
  LAYER_STATE_TOKEN_RESERVATIONS,
  nextLayerStateToken,
  parseLayerStateTokenReservations,
  validateLayerStateAllocations,
} from './layerState.js';
import {
  PRE_LEDGER_LAYER_STATE_TOKENS,
  checkLayerStateTokens,
  readPublishedLayerStateReservations,
} from '../../scripts/check-layer-state-tokens.mjs';

const LEDGER_PATH = 'src/data/layerStateTokenReservations.json';
const SOURCE_PATH = 'src/data/layerState.js';
const CODEC_SOURCE_PATH = fileURLToPath(
  new URL('./layerState.js', import.meta.url),
);
const CHECKER_PATH = fileURLToPath(
  new URL('../../scripts/check-layer-state-tokens.mjs', import.meta.url),
);
const NEXT_PATH = fileURLToPath(
  new URL('../../scripts/next-layer-state-token.mjs', import.meta.url),
);
const reservationRows = JSON.parse(
  readFileSync(
    new URL('./layerStateTokenReservations.json', import.meta.url),
    'utf8',
  ),
);

// CN 反向移植图层占用了 9/00/01/02（真实台账行）。下面的分配演化场景
// 模拟「从预 CN 基线出发」的竞争分配，因此夹具基线剔除 cn 行，
// 保持 9→00→01→02 的边界语义与 "36 published" 计数可测。
const PRE_CN_RESERVATION_ROWS = reservationRows.filter(
  ([id]) => !['cn-admin', 'cn-quakes', 'cn-traffic', 'cn-typhoon'].includes(id),
);

test('pre-ledger published ownership is independent of the candidate mapping', () => {
  assert.notStrictEqual(
    PRE_LEDGER_LAYER_STATE_TOKENS,
    LEGACY_LAYER_STATE_TOKENS,
  );
  assert.deepEqual(PRE_LEDGER_LAYER_STATE_TOKENS, LEGACY_LAYER_STATE_TOKENS);
  assert.equal(Object.keys(PRE_LEDGER_LAYER_STATE_TOKENS).length, 28);
  assert.equal(PRE_LEDGER_LAYER_STATE_TOKENS['recent-imagery'], '1');
  assert.equal(PRE_LEDGER_LAYER_STATE_TOKENS['fire-perimeters'], '2');
  assert.throws(
    () =>
      validateLayerStateAllocations(PRE_LEDGER_LAYER_STATE_TOKENS, {
        ...LAYER_STATE_TOKEN_RESERVATIONS,
        flights: '00',
      }),
    /Published layer-state token changed or removed: flights/,
  );
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function withPublishedBase(
  { rows, source = 'export const changed = true;\n' },
  check,
) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'gev-layer-token-ledger-'));
  try {
    git(cwd, 'init', '-q');
    mkdirSync(path.join(cwd, 'src/data'), { recursive: true });
    writeFileSync(path.join(cwd, SOURCE_PATH), source);
    if (rows !== undefined) {
      writeFileSync(path.join(cwd, LEDGER_PATH), JSON.stringify(rows));
    }
    git(cwd, 'add', 'src/data');
    git(
      cwd,
      '-c',
      'user.name=Layer Token Test',
      '-c',
      'user.email=layer-token-test@example.invalid',
      'commit',
      '-q',
      '-m',
      'published base',
    );
    check(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function writeCodecFixture(cwd, rows, entries) {
  const providerCodec = path.join(cwd, 'src/data/idSwitches.js');
  mkdirSync(path.dirname(providerCodec), { recursive: true });
  writeFileSync(
    providerCodec,
    readFileSync(new URL('./idSwitches.js', import.meta.url)),
  );
  const source = readFileSync(CODEC_SOURCE_PATH, 'utf8');
  const registryEnd = ']);\n\nexport const REGISTERED_LAYER_IDS';
  assert.equal(source.split(registryEnd).length, 2);
  // 夹具模拟「预 CN 基线」的分配演化：剥离真实 layerState.js 里的 cn 注册行，
  // 使夹具注册表与夹具台账（PRE_CN 基线）保持一致。
  const cnFreeSource = source
    .split('\n')
    .filter((line) => !/id: 'cn-(admin|quakes|traffic|typhoon)'/.test(line))
    .join('\n');
  const additions = entries
    .map(
      ({ id, token }) =>
        `  Object.freeze({ id: '${id}', token: '${token}', disposition: 'enabled-only' }),`,
    )
    .join('\n');
  mkdirSync(path.join(cwd, 'src/data'), { recursive: true });
  writeFileSync(path.join(cwd, 'package.json'), '{"type":"module"}');
  writeFileSync(
    path.join(cwd, SOURCE_PATH),
    cnFreeSource.replace(registryEnd, `${additions}\n${registryEnd}`),
  );
  writeFileSync(path.join(cwd, LEDGER_PATH), JSON.stringify(rows));
  return path.join(cwd, SOURCE_PATH);
}

test('reservation ledger is complete, pinned, and rejects duplicate or malformed rows', () => {
  assert.deepEqual(
    { ...parseLayerStateTokenReservations(reservationRows) },
    { ...LAYER_STATE_TOKEN_RESERVATIONS },
  );
  assert.equal(Object.keys(LAYER_STATE_TOKEN_RESERVATIONS).length, 39);
  assert.deepEqual(
    { ...LAYER_STATE_TOKEN_RESERVATIONS },
    {
      ...LEGACY_LAYER_STATE_TOKENS,
      'street-level': '0',
      'gnss-integrity': '3',
      'air-quality': '4',
      's2-ghostmaps': '5',
      'sea-marks': '6',
      'ski-pistes': '7',
      'drone-airspace': '8',
      // CN 反向移植图层（A1-A4）。
      'cn-admin': '9',
      'cn-quakes': '00',
      'cn-traffic': '01',
      'cn-typhoon': '02',
    },
  );
  assert.throws(
    () =>
      parseLayerStateTokenReservations(
        // Drop a legacy row by id; the first row sorts as air-quality, which
        // is not a legacy reservation.
        reservationRows.filter(([id]) => id !== 'ais-live-vessels'),
      ),
    /Missing or changed legacy/,
  );
  assert.throws(
    () =>
      parseLayerStateTokenReservations([
        ...PRE_CN_RESERVATION_ROWS,
        reservationRows[0],
      ]),
    /Duplicate layer-state token reservation id/,
  );
  assert.throws(
    () =>
      parseLayerStateTokenReservations([...PRE_CN_RESERVATION_ROWS, ['future', 'a']]),
    /Duplicate layer-state token reservation/,
  );
  assert.equal(
    parseLayerStateTokenReservations([...PRE_CN_RESERVATION_ROWS, ['future', '9']])
      .future,
    '9',
  );
  assert.throws(
    () =>
      parseLayerStateTokenReservations([
        ...PRE_CN_RESERVATION_ROWS.filter(([id]) => id !== 'transit'),
        ['future', 'j'],
      ]),
    /Legacy layer-state token is immutable/,
  );
  assert.throws(
    () => parseLayerStateTokenReservations([...PRE_CN_RESERVATION_ROWS, ['future']]),
    /Invalid layer-state token ledger row/,
  );
});

test('published retired digits and competing PRs advance the merge-time allocation', () => {
  withPublishedBase(
    { rows: [...PRE_CN_RESERVATION_ROWS, ['retired-layer', '9']] },
    (cwd) => {
      const published = readPublishedLayerStateReservations('HEAD', cwd);
      assert.equal(nextLayerStateToken(published), '00');
      assert.equal(
        validateLayerStateAllocations(published, {
          ...published,
          newcomer: '00',
        }),
        true,
      );
      assert.throws(
        () =>
          validateLayerStateAllocations(published, {
            ...published,
            competing: '9',
          }),
        /next free token 00/,
      );
      assert.throws(
        () =>
          validateLayerStateAllocations(published, {
            ...LAYER_STATE_TOKEN_RESERVATIONS,
            newcomer: '9',
          }),
        /changed or removed: retired-layer/,
      );
    },
  );
});

test('PR B manually replaces provisional 9 with 00 after PR A publishes 9', () => {
  withPublishedBase({ rows: [...PRE_CN_RESERVATION_ROWS, ['pr-a', '9']] }, (cwd) => {
    mkdirSync(path.join(cwd, 'scripts'));
    const fixtureChecker = path.join(
      cwd,
      'scripts/check-layer-state-tokens.mjs',
    );
    writeFileSync(fixtureChecker, readFileSync(CHECKER_PATH, 'utf8'));
    const fixtureNext = path.join(cwd, 'scripts/next-layer-state-token.mjs');
    writeFileSync(fixtureNext, readFileSync(NEXT_PATH, 'utf8'));
    const runCheck = () =>
      spawnSync(
        process.execPath,
        [realpathSync(fixtureChecker), '--base-ref', 'HEAD'],
        {
          cwd,
          encoding: 'utf8',
        },
      );

    writeCodecFixture(
      cwd,
      [...PRE_CN_RESERVATION_ROWS, ['pr-b', '9']],
      [{ id: 'pr-b', token: '9' }],
    );
    const beforeRebase = runCheck();
    assert.equal(beforeRebase.status, 1);
    assert.match(beforeRebase.stderr, /changed or removed: pr-a/);

    writeCodecFixture(
      cwd,
      [...PRE_CN_RESERVATION_ROWS, ['pr-a', '9'], ['pr-b', '9']],
      [
        { id: 'pr-a', token: '9' },
        { id: 'pr-b', token: '9' },
      ],
    );
    const staleRebase = runCheck();
    assert.equal(staleRebase.status, 1);
    assert.match(staleRebase.stderr, /Duplicate layer-state token reservation/);

    const published = readPublishedLayerStateReservations('HEAD', cwd);
    assert.equal(nextLayerStateToken(published), '00');
    const validBaselineRows = [...PRE_CN_RESERVATION_ROWS, ['pr-a', '9']];
    writeCodecFixture(cwd, validBaselineRows, [{ id: 'pr-a', token: '9' }]);
    const helper = spawnSync(
      process.execPath,
      [realpathSync(fixtureNext), 'pr-b'],
      { cwd, encoding: 'utf8' },
    );
    assert.equal(helper.status, 0, helper.stderr);
    assert.match(helper.stdout, /pr-b: 00/);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(cwd, LEDGER_PATH), 'utf8')),
      validBaselineRows,
      'the helper reports a token without rewriting the ledger',
    );
    writeCodecFixture(
      cwd,
      [...PRE_CN_RESERVATION_ROWS, ['pr-a', '9'], ['pr-b', '00']],
      [
        { id: 'pr-a', token: '9' },
        { id: 'pr-b', token: '00' },
      ],
    );
    const corrected = runCheck();
    assert.equal(corrected.status, 0, corrected.stderr);
    assert.match(corrected.stdout, /36 published, 1 new/);
  });
});

test('allocation batches cross the last digit and base-36 pair boundaries in order', () => {
  const digitRows = [...'9'].map((digit) => [`retired-${digit}`, digit]);
  const allDigits = parseLayerStateTokenReservations([
    ...PRE_CN_RESERVATION_ROWS,
    ...digitRows,
  ]);
  const beforeNine = { ...allDigits };
  delete beforeNine['retired-9'];
  assert.equal(
    validateLayerStateAllocations(beforeNine, {
      ...beforeNine,
      pair: '00',
      lastDigit: '9',
    }),
    true,
  );
  const baseBefore0a = {
    ...allDigits,
    ...Object.fromEntries(
      [...'012345678'].map((second) => [`retired-0${second}`, `0${second}`]),
    ),
  };
  assert.equal(nextLayerStateToken(baseBefore0a), '09');
  assert.equal(
    validateLayerStateAllocations(baseBefore0a, {
      ...baseBefore0a,
      after: '0a',
      before: '09',
    }),
    true,
  );
  const baseBefore10 = {
    ...allDigits,
    ...Object.fromEntries(
      [...LAYER_STATE_TOKEN_ALPHABET]
        .slice(0, -1)
        .map((second) => [`retired-0${second}`, `0${second}`]),
    ),
  };
  assert.equal(nextLayerStateToken(baseBefore10), '0z');
  assert.equal(
    validateLayerStateAllocations(baseBefore10, {
      ...baseBefore10,
      after: '10',
      before: '0z',
    }),
    true,
  );
});

test('an isolated valid two-character fixture round-trips an l field beyond the old 64-character cap', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'gev-layer-token-width-'));
  try {
    // 上游台账已占用数字 0-8（street-level 0、air-quality 4 等），CN 反向
    // 移植图层占用 9/00/01/02——夹具直接从当前台账出发，新 pair 从 03 起。
    const fixtureLayers = ['03', '04', '05', '06'].map((token) => ({
      id: `qa-layer-${token}`,
      token,
    }));
    const fixtureRows = [
      ...reservationRows,
      ...fixtureLayers.map(({ id, token }) => [id, token]),
    ];
    const fixtureModule = writeCodecFixture(cwd, fixtureRows, fixtureLayers);
    const codec = await import(pathToFileURL(fixtureModule));
    assert.equal(codec.validateLayerStateRegistry(), true);
    assert.equal(
      nextLayerStateToken(parseLayerStateTokenReservations(reservationRows)),
      '03',
    );
    // 注：不对照真实预留做 validateLayerStateAllocations——夹具 qa 行与
    // 真实数字 token 必然冲突；分配语义由上一行 nextLayerStateToken 断言
    // 与 allocation batches 测试覆盖，本测试主题是编解码往返。

    const expectedLayerIds = codec.REGISTERED_LAYER_IDS;
    const state = codec.normalizeLayerState({
      enabledLayerIds: expectedLayerIds,
    });
    const params = new URLSearchParams([['v', '2']]);
    codec.encodeLayerStateParams(params, state);
    assert.ok(params.get('l').length > 64, 'fixture must cross the old cap');
    // 精确长度随夹具图层集变化，不再钉死（原 81 按预合并 35+4 夹具校准）。
    const restored = codec.decodeLayerStateParams(params);
    assert.deepEqual(restored?.enabledLayerIds, expectedLayerIds);
    assert.deepEqual(restored?.options, state.options);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('checker reads a complete future base ledger and rejects retired-token reuse', () => {
  withPublishedBase(
    {
      rows: [...PRE_CN_RESERVATION_ROWS, ['retired-layer', '00']],
      source:
        'export const LAYER_STATE_TOKEN_RESERVATIONS = Object.freeze({ ["retired-layer"]: "00" });\n',
    },
    (cwd) => {
      const published = readPublishedLayerStateReservations('HEAD', cwd);
      assert.equal(Object.keys(published).length, 36);
      assert.equal(published['retired-layer'], '00');
      assert.throws(
        () =>
          validateLayerStateAllocations(published, {
            ...LAYER_STATE_TOKEN_RESERVATIONS,
            newcomer: '00',
          }),
        /changed or removed/,
      );
      assert.throws(
        () => checkLayerStateTokens('HEAD', cwd),
        /changed or removed/,
      );
      const cli = spawnSync(
        process.execPath,
        [CHECKER_PATH, '--base-ref', 'HEAD'],
        {
          cwd,
          encoding: 'utf8',
        },
      );
      assert.equal(cli.status, 1);
      assert.match(cli.stderr, /changed or removed/);
    },
  );
});

test('checker fails closed on unknown or malformed published ledgers', () => {
  withPublishedBase({}, (cwd) => {
    assert.throws(
      () => readPublishedLayerStateReservations('HEAD', cwd),
      /no recognizable layer-state token ledger/,
    );
  });
  withPublishedBase({ rows: [...PRE_CN_RESERVATION_ROWS, ['future', 'a']] }, (cwd) => {
    assert.throws(
      () => readPublishedLayerStateReservations('HEAD', cwd),
      /Duplicate layer-state token reservation/,
    );
  });
});
