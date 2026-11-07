const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { StateRepository } = require('../src/repositories/stateRepository');

async function tempStatePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcheck-'));
  return path.join(dir, 'state.json');
}

const wallet = { network: 'BEP20', address: '0xabc', name: 'Main', watchFromMs: 1000 };

test('wallets get sequential ids per user and survive a restart', async () => {
  const file = await tempStatePath();
  const repo = new StateRepository(file);
  await repo.init();

  const first = await repo.addWallet(42, wallet);
  const second = await repo.addWallet(42, { ...wallet, address: '0xdef', name: 'Cold' });
  await repo.addWallet(7, wallet);
  await repo.renameWallet(42, second.id, 'Savings');
  await repo.setThreshold(42, 500);

  assert.deepEqual([first.id, second.id], [1, 2]);

  const reloaded = new StateRepository(file);
  await reloaded.init();
  assert.deepEqual(
    reloaded.listUserWallets(42).map((w) => w.name),
    ['Main', 'Savings']
  );
  assert.equal(reloaded.getThreshold(42, 100), 500);
  assert.equal(reloaded.getThreshold(7, 100), 100);
});

test('seen transactions are deduplicated and capped at 200 newest', async () => {
  const repo = new StateRepository(await tempStatePath());
  await repo.init();
  const { id } = await repo.addWallet(1, wallet);

  await repo.markTxAsSeen(1, id, 'tx-a');
  await repo.markTxAsSeen(1, id, 'tx-a');
  assert.equal(repo.getWalletById(1, id).seenTxHashes.length, 1);

  for (let i = 0; i < 250; i += 1) {
    await repo.markTxAsSeen(1, id, `tx-${i}`);
  }
  const seen = repo.getWalletById(1, id).seenTxHashes;
  assert.equal(seen.length, 200);
  assert.equal(seen[0], 'tx-249');
  assert.equal(repo.hasSeenTx(1, id, 'tx-249'), true);
  assert.equal(repo.hasSeenTx(1, id, 'tx-a'), false);
});

test('writes go through a temp file and leave no partial JSON behind', async () => {
  const file = await tempStatePath();
  const repo = new StateRepository(file);
  await repo.init();
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => repo.addWallet(1, { ...wallet, name: `w${i}` }))
  );

  const files = await fs.readdir(path.dirname(file));
  assert.deepEqual(files, ['state.json']);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.users['1'].wallets.length, 20);
});

test('one failed write does not block later writes', async () => {
  const file = await tempStatePath();
  const repo = new StateRepository(file);
  await repo.init();

  await fs.rm(path.dirname(file), { recursive: true });
  await assert.rejects(repo.addWallet(1, wallet));

  await fs.mkdir(path.dirname(file), { recursive: true });
  await repo.addWallet(1, { ...wallet, name: 'After recovery' });

  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(
    saved.users['1'].wallets.map((w) => w.name),
    ['Main', 'After recovery']
  );
});
