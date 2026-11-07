const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, formatAlertMessage, shortHash } = require('../src/utils/formatters');

const wallet = {
  id: 3,
  network: 'BEP20',
  address: '0x1111111111111111111111111111111111111111',
  name: 'Main <b>wallet</b> & "co"'
};
const tx = {
  hash: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  amount: 1234.5,
  direction: 'IN',
  counterpartyAddress: '0x2222222222222222222222222222222222222222',
  counterpartyName: 'Binance',
  counterpartyUrl: 'https://bscscan.com/address/0x2222222222222222222222222222222222222222'
};

test('escapeHtml neutralises characters that break Telegram HTML', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('shortHash keeps both ends and leaves short values intact', () => {
  assert.equal(shortHash('0x1234567890abcdef1234', 4), '0x12...1234');
  assert.equal(shortHash('0x1234', 4), '0x1234');
});

test('incoming alert shows amount, sender label and escaped wallet name', () => {
  const message = formatAlertMessage({ wallet, tx, botUsername: 'transcheck_bot' });

  assert.match(message, /Получено: .*1,234\.50 USDT/);
  assert.match(message, /От: <a href="[^"]+">Binance<\/a>/);
  assert.match(message, /Main &lt;b&gt;wallet&lt;\/b&gt; &amp; &quot;co&quot;/);
  assert.doesNotMatch(message, /<b>wallet<\/b>/);
  assert.match(message, /https:\/\/t\.me\/transcheck_bot\?start=edit_wallet_3/);
  assert.match(message, new RegExp(`bscscan\\.com/tx/${tx.hash}`));
});

test('outgoing alert without a known label links to the address', () => {
  const message = formatAlertMessage({
    wallet: { ...wallet, network: 'TRC20', address: 'TXYZ' },
    tx: { ...tx, direction: 'OUT', counterpartyName: tx.counterpartyAddress },
    botUsername: null
  });

  assert.match(message, /Отправлено: /);
  assert.match(message, /На: <a href="[^"]+">Address<\/a>/);
  assert.match(message, /tronscan\.org\/#\/transaction\//);
  assert.doesNotMatch(message, /edit_wallet/);
});
