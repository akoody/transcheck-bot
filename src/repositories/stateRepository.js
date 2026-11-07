const fs = require('fs/promises');
const path = require('path');
const { coerceNetwork } = require('../utils/constants');

class StateRepository {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = {
      users: {}
    };
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const fileContent = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      const users = parsed.users || {};

      for (const user of Object.values(users)) {
        user.wallets = Array.isArray(user.wallets) ? user.wallets : [];

        for (const wallet of user.wallets) {
          const normalizedNetwork = coerceNetwork(wallet.network);

          if (normalizedNetwork) {
            wallet.network = normalizedNetwork;
          }

          wallet.seenTxHashes = Array.isArray(wallet.seenTxHashes) ? wallet.seenTxHashes : [];
          wallet.watchFromMs = Number(wallet.watchFromMs || 0);
        }
      }

      this.state = {
        users
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      await this.persist();
    }
  }

  getUser(userId) {
    const key = String(userId);

    if (!this.state.users[key]) {
      this.state.users[key] = {
        thresholdUsdt: null,
        wallets: []
      };
    }

    return this.state.users[key];
  }

  listUserWallets(userId) {
    const user = this.getUser(userId);
    return [...user.wallets];
  }

  async addWallet(userId, wallet) {
    const user = this.getUser(userId);
    const maxLocalId = user.wallets.reduce((max, w) => Math.max(max, w.id), 0);

    const createdWallet = {
      id: maxLocalId + 1,
      network: wallet.network,
      address: wallet.address,
      name: wallet.name,
      watchFromMs: wallet.watchFromMs,
      createdAt: new Date().toISOString(),
      seenTxHashes: []
    };

    user.wallets.push(createdWallet);
    await this.persist();

    return createdWallet;
  }

  async removeWallet(userId, walletId) {
    const user = this.getUser(userId);
    const index = user.wallets.findIndex((wallet) => wallet.id === walletId);

    if (index === -1) {
      return false;
    }

    user.wallets.splice(index, 1);
    await this.persist();

    return true;
  }

  getWalletById(userId, walletId) {
    const user = this.getUser(userId);
    return user.wallets.find((wallet) => wallet.id === walletId) || null;
  }

  async renameWallet(userId, walletId, nextName) {
    const wallet = this.getWalletById(userId, walletId);

    if (!wallet) {
      return null;
    }

    wallet.name = nextName;
    await this.persist();

    return wallet;
  }

  findWallet(userId, network, address) {
    const user = this.getUser(userId);
    return user.wallets.find((wallet) => wallet.network === network && wallet.address === address) || null;
  }

  async setThreshold(userId, value) {
    const user = this.getUser(userId);
    user.thresholdUsdt = value;
    await this.persist();
  }

  getThreshold(userId, defaultThreshold) {
    const user = this.getUser(userId);
    if (typeof user.thresholdUsdt === 'number' && user.thresholdUsdt >= 0) {
      return user.thresholdUsdt;
    }

    return defaultThreshold;
  }

  listAllUsersWithWallets() {
    return Object.entries(this.state.users)
      .map(([userId, user]) => ({
        userId: Number(userId),
        thresholdUsdt: user.thresholdUsdt,
        wallets: user.wallets
      }))
      .filter((item) => item.wallets.length > 0);
  }

  async markTxAsSeen(userId, walletId, txHash) {
    const wallet = this.getWalletById(userId, walletId);

    if (!wallet) {
      return;
    }

    if (wallet.seenTxHashes.includes(txHash)) {
      return;
    }

    wallet.seenTxHashes.unshift(txHash);

    if (wallet.seenTxHashes.length > 200) {
      wallet.seenTxHashes = wallet.seenTxHashes.slice(0, 200);
    }

    await this.persist();
  }

  hasSeenTx(userId, walletId, txHash) {
    const wallet = this.getWalletById(userId, walletId);
    return Boolean(wallet && wallet.seenTxHashes.includes(txHash));
  }

  /**
   * Сохраняет состояние атомарно: пишет во временный файл и переименовывает его.
   * Сбой посреди записи не оставит битый JSON. Записи идут по очереди, а ошибка
   * одной записи возвращается вызывающему, но не блокирует следующие.
   */
  async persist() {
    const snapshot = JSON.stringify(this.state, null, 2);
    const write = this.writeQueue.then(() => this.writeAtomically(snapshot));

    this.writeQueue = write.catch(() => {});
    await write;
  }

  async writeAtomically(content) {
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;

    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }
}

module.exports = {
  StateRepository
};
