const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidAddress, normalizeAddress } = require('../src/utils/validators');
const { coerceNetwork, NETWORKS } = require('../src/utils/constants');

const BEP20 = '0x55d398326f99059fF775485246999027B3197955';
const TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

test('coerceNetwork accepts common aliases', () => {
  for (const alias of ['bep20', 'BEP 20', 'bsc', 'BNB']) {
    assert.equal(coerceNetwork(alias), NETWORKS.BEP20);
  }
  for (const alias of ['trc20', 'TRC 20', 'tron', 'TRX']) {
    assert.equal(coerceNetwork(alias), NETWORKS.TRC20);
  }
  assert.equal(coerceNetwork('erc20'), null);
  assert.equal(coerceNetwork(undefined), null);
});

test('isValidAddress validates each network by its own format', () => {
  assert.equal(isValidAddress(NETWORKS.BEP20, BEP20), true);
  assert.equal(isValidAddress(NETWORKS.TRC20, TRC20), true);

  assert.equal(isValidAddress(NETWORKS.BEP20, TRC20), false);
  assert.equal(isValidAddress(NETWORKS.TRC20, BEP20), false);
  assert.equal(isValidAddress(NETWORKS.BEP20, `${BEP20}0`), false);
  // В base58 нет символов 0, O, I, l.
  assert.equal(isValidAddress(NETWORKS.TRC20, `T${'0'.repeat(33)}`), false);
  assert.equal(isValidAddress(NETWORKS.BEP20, ''), false);
  assert.equal(isValidAddress('ERC20', BEP20), false);
});

test('normalizeAddress lowercases EVM addresses and keeps base58 as is', () => {
  assert.equal(normalizeAddress(NETWORKS.BEP20, ` ${BEP20} `), BEP20.toLowerCase());
  assert.equal(normalizeAddress(NETWORKS.TRC20, ` ${TRC20} `), TRC20);
});
