const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { MonitorService } = require('../src/services/monitorService');
const { StateRepository } = require('../src/repositories/stateRepository');

const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

function transfer(overrides) {
  return {
    hash: `0x${Math.random().toString(16).slice(2)}`,
    timestampMs: 5_000,
    from: OTHER,
    to: WALLET,
    amount: 1500,
    ...overrides
  };
}

async function setup({ transactions = [], sendMessage } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcheck-monitor-'));
  const stateRepository = new StateRepository(path.join(dir, 'state.json'));
  await stateRepository.init();
  const created = await stateRepository.addWallet(10, {
    network: 'BEP20',
    // Адрес в другом регистре: EVM-адреса сравниваются без учёта регистра.
    address: WALLET.toUpperCase().replace('0X', '0x'),
    name: 'Main',
    watchFromMs: 1_000
  });

  const sent = [];
  const bscClient = {
    fetchUsdtTransactions: async () => transactions,
    resolveAddressLabel: async () => null
  };
  const bot = {
    sendMessage:
      sendMessage ||
      (async (chatId, text) => {
        sent.push({ chatId, text });
      })
  };

  const monitor = new MonitorService({
    stateRepository,
    bscClient,
    tronClient: { fetchUsdtTransactions: async () => [] },
    bot,
    minAlertUsdt: 1000,
    pollIntervalMs: 60_000,
    getBotUsername: () => null
  });
  return { monitor, stateRepository, sent, bscClient, walletId: created.id };
}

test('alerts only on new transfers above the threshold after watchFromMs', async () => {
  const transactions = [
    transfer({ amount: 1500, hash: '0xbig' }),
    transfer({ amount: 999, hash: '0xsmall' }),
    transfer({ amount: 5000, hash: '0xold', timestampMs: 500 }),
    transfer({ amount: 5000, hash: '0xforeign', from: OTHER, to: OTHER })
  ];
  const { monitor, sent } = await setup({ transactions });

  await monitor.tick();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, 10);
  assert.match(sent[0].text, /0xbig/);
  assert.match(sent[0].text, /Получено/);
});

test('does not alert twice about the same transfer', async () => {
  const { monitor, sent } = await setup({ transactions: [transfer({ hash: '0xonce' })] });

  await monitor.tick();
  await monitor.tick();

  assert.equal(sent.length, 1);
});

test('detects outgoing transfers', async () => {
  const { monitor, sent } = await setup({
    transactions: [transfer({ from: WALLET, to: OTHER, hash: '0xout' })]
  });

  await monitor.tick();

  assert.match(sent[0].text, /Отправлено/);
});

test('retries the alert on the next tick if Telegram delivery failed', async () => {
  let attempts = 0;
  const { monitor, stateRepository, walletId } = await setup({
    transactions: [transfer({ hash: '0xretry' })],
    sendMessage: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('ETELEGRAM: 502 Bad Gateway');
      }
    }
  });

  await monitor.tick();
  assert.equal(stateRepository.hasSeenTx(10, walletId, '0xretry-IN'), false);

  await monitor.tick();
  assert.equal(attempts, 2);
  assert.equal(stateRepository.hasSeenTx(10, walletId, '0xretry-IN'), true);
});

test('backs off a wallet after a fetch error instead of hammering the API', async () => {
  const { monitor, bscClient } = await setup();
  let calls = 0;
  bscClient.fetchUsdtTransactions = async () => {
    calls += 1;
    throw new Error('429 Too Many Requests');
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await monitor.tick();
    await monitor.tick();
  } finally {
    console.error = originalError;
  }

  assert.equal(calls, 1);
  assert.match(monitor.getStats().lastError, /429/);
});
