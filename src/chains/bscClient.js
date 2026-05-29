const axios = require('axios');
const { NETWORKS } = require('../utils/constants');

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDT_DECIMALS = 18;
const DEFAULT_RPC_RETRIES = 4;
const DEFAULT_RPC_COOLDOWN_BASE_MS = 30_000;
const DEFAULT_RPC_COOLDOWN_MAX_MS = 10 * 60_000;
const BUILTIN_RPC_FALLBACKS = [
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed1.bnbchain.org',
  'https://bsc-dataseed2.bnbchain.org',
  'https://bsc-dataseed3.bnbchain.org',
  'https://bsc-dataseed4.bnbchain.org',
  'https://bsc-dataseed.binance.org',
  'https://bnb-mainnet.g.alchemy.com/public',
  'https://1rpc.io/bnb'
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class BscClient {
  constructor(config) {
    this.config = config;
    this.http = axios.create({
      timeout: 15_000
    });
    this.lastScannedByAddress = new Map();
    this.blockTimestampCache = new Map();
    this.rpcUrls = Array.from(new Set([
      this.config.rpcUrl,
      ...(Array.isArray(this.config.rpcFallbackUrls) ? this.config.rpcFallbackUrls : []),
      ...BUILTIN_RPC_FALLBACKS
    ].filter(Boolean)));
    this.rpcCooldownBaseMs = Math.max(5_000, Number(this.config.rpcCooldownBaseMs || DEFAULT_RPC_COOLDOWN_BASE_MS));
    this.rpcCooldownMaxMs = Math.max(this.rpcCooldownBaseMs, Number(this.config.rpcCooldownMaxMs || DEFAULT_RPC_COOLDOWN_MAX_MS));
    this.rpcCooldowns = new Map();
    this.addressTagCache = new Map();
    this.addressTagPending = new Map();
    this.addressTagTtlMs = Math.max(5 * 60_000, Number(this.config.addressTagTtlMs || 6 * 60 * 60_000));
  }

  async resolveAddressLabel(address) {
    const normalizedAddress = String(address || '').toLowerCase();

    if (!/^0x[a-f0-9]{40}$/.test(normalizedAddress)) {
      return '';
    }

    const now = Date.now();
    const cached = this.addressTagCache.get(normalizedAddress);

    if (cached && cached.expiresAtMs > now) {
      return cached.label;
    }

    const pending = this.addressTagPending.get(normalizedAddress);

    if (pending) {
      return pending;
    }

    const request = (async () => {
      try {
        const label = await this.fetchAddressLabel(normalizedAddress);
        const ttlMs = label ? this.addressTagTtlMs : Math.min(this.addressTagTtlMs, 60 * 60_000);
        this.addressTagCache.set(normalizedAddress, {
          label,
          expiresAtMs: now + ttlMs
        });
        return label;
      } catch (error) {
        this.addressTagCache.set(normalizedAddress, {
          label: '',
          expiresAtMs: now + Math.min(this.addressTagTtlMs, 15 * 60_000)
        });
        return '';
      } finally {
        this.addressTagPending.delete(normalizedAddress);
      }
    })();

    this.addressTagPending.set(normalizedAddress, request);
    return request;
  }

  async fetchAddressLabel(address) {
    const viaApi = await this.fetchAddressLabelViaApi(address);

    if (viaApi) {
      return viaApi;
    }

    return this.fetchAddressLabelFromExplorer(address);
  }

  async fetchUsdtTransactions(address, limit = 50) {
    const errors = [];

    try {
      return await this.fetchViaRpc(address, limit);
    } catch (error) {
      errors.push(`[rpc] ${error.message}`);
    }

    if (!this.config.useExplorerFallback) {
      throw new Error(`BSC RPC failed: ${errors.join(' | ')}`);
    }

    const baseParams = {
      module: 'account',
      action: 'tokentx',
      contractaddress: this.config.usdtContract,
      address,
      sort: 'desc',
      page: 1,
      offset: Math.min(Math.max(limit, 1), 100)
    };

    const strategies = this.buildStrategies(baseParams);
    let rows = null;

    for (const strategy of strategies) {
      try {
        const { data } = await this.http.get(strategy.url, {
          params: strategy.params
        });
        rows = this.extractRows(data, strategy.name);
        break;
      } catch (error) {
        errors.push(`[${strategy.name}] ${error.message}`);
      }
    }

    if (!rows) {
      throw new Error(`BSC API failed: ${errors.join(' | ') || 'no strategies available'}`);
    }

    return this.mapExplorerRows(rows);
  }

  mapExplorerRows(rows) {
    return rows.map((item) => {
      const decimals = Number(item.tokenDecimal || 18);
      const value = Number(item.value) / 10 ** decimals;
      const timestampMs = Number(item.timeStamp) * 1_000;
      const from = String(item.from || '').toLowerCase();
      const to = String(item.to || '').toLowerCase();

      return {
        network: NETWORKS.BEP20,
        hash: item.hash,
        timestampMs,
        from,
        to,
        amount: value,
        tokenSymbol: item.tokenSymbol || 'USDT',
        blockNumber: Number(item.blockNumber || 0)
      };
    });
  }

  async fetchViaRpc(address, limit) {
    const normalizedAddress = String(address || '').toLowerCase();
    const latestBlockHex = await this.rpcRequest('eth_blockNumber', []);
    const latestBlock = Number.parseInt(latestBlockHex, 16);

    if (!Number.isFinite(latestBlock)) {
      throw new Error('Invalid latest block from BSC RPC');
    }

    const previousBlock = this.lastScannedByAddress.get(normalizedAddress);
    const warmupBlocks = Math.max(6, Number(this.config.rpcWarmupBlocks || 24));
    const fromBlock = previousBlock == null
      ? Math.max(0, latestBlock - warmupBlocks)
      : previousBlock + 1;

    if (fromBlock > latestBlock) {
      return [];
    }

    const addressTopic = this.addressToTopic(normalizedAddress);
    const outgoingLogs = await this.fetchLogsChunked({
      address: this.config.usdtContract,
      topics: [TRANSFER_TOPIC, addressTopic]
    }, fromBlock, latestBlock);

    const incomingLogs = await this.fetchLogsChunked({
      address: this.config.usdtContract,
      topics: [TRANSFER_TOPIC, null, addressTopic]
    }, fromBlock, latestBlock);

    this.lastScannedByAddress.set(normalizedAddress, latestBlock);

    const unique = new Map();

    for (const log of [...outgoingLogs, ...incomingLogs]) {
      unique.set(`${log.transactionHash}:${log.logIndex}`, log);
    }

    const logs = Array.from(unique.values());

    if (!logs.length) {
      return [];
    }

    const blockNumbers = [...new Set(logs.map((log) => Number.parseInt(log.blockNumber, 16)))];
    await this.populateBlockTimestamps(blockNumbers);

    const txRows = logs.map((log) => {
      const blockNumber = Number.parseInt(log.blockNumber, 16);
      const logIndex = Number.parseInt(log.logIndex || '0x0', 16);
      const from = this.topicToAddress(log.topics?.[1]);
      const to = this.topicToAddress(log.topics?.[2]);
      const amountRaw = BigInt(log.data || '0x0');
      const amount = Number(amountRaw) / 10 ** USDT_DECIMALS;

      return {
        network: NETWORKS.BEP20,
        hash: log.transactionHash,
        timestampMs: this.blockTimestampCache.get(blockNumber) || 0,
        from,
        to,
        amount,
        tokenSymbol: 'USDT',
        blockNumber,
        logIndex
      };
    });

    txRows.sort((a, b) => {
      if (b.blockNumber !== a.blockNumber) {
        return b.blockNumber - a.blockNumber;
      }

      return b.logIndex - a.logIndex;
    });

    return txRows
      .slice(0, Math.max(1, limit))
      .map(({ logIndex, ...tx }) => tx);
  }

  async populateBlockTimestamps(blockNumbers) {
    for (const blockNumber of blockNumbers) {
      if (this.blockTimestampCache.has(blockNumber)) {
        continue;
      }

      const block = await this.rpcRequest('eth_getBlockByNumber', [this.toHex(blockNumber), false]);
      const timestampMs = Number.parseInt(block?.timestamp || '0x0', 16) * 1_000;
      this.blockTimestampCache.set(blockNumber, timestampMs);
    }

    if (this.blockTimestampCache.size > 5000) {
      const recentBlockNumbers = [...this.blockTimestampCache.keys()]
        .sort((a, b) => b - a)
        .slice(0, 2500);

      const compactCache = new Map();

      for (const blockNumber of recentBlockNumbers) {
        compactCache.set(blockNumber, this.blockTimestampCache.get(blockNumber));
      }

      this.blockTimestampCache = compactCache;
    }
  }

  buildStrategies(baseParams) {
    const strategies = [];

    if (this.config.apiKey) {
      strategies.push({
        name: 'etherscan-v2',
        url: this.config.v2ApiUrl,
        params: {
          ...baseParams,
          chainid: this.config.chainId,
          apikey: this.config.apiKey
        }
      });
    }

    if (this.config.legacyApiKey || this.config.apiKey) {
      strategies.push({
        name: 'bscscan-legacy',
        url: this.config.legacyApiUrl,
        params: {
          ...baseParams,
          apikey: this.config.legacyApiKey || this.config.apiKey
        }
      });
    } else {
      strategies.push({
        name: 'bscscan-legacy-no-key',
        url: this.config.legacyApiUrl,
        params: baseParams
      });
    }

    return strategies;
  }

  async fetchLogsChunked(filter, fromBlock, toBlock) {
    const logs = [];
    let current = fromBlock;
    let chunkSize = Math.max(1, Number(this.config.rpcChunkSize || 50));

    while (current <= toBlock) {
      const end = Math.min(current + chunkSize - 1, toBlock);

      try {
        const result = await this.rpcRequest('eth_getLogs', [{
          ...filter,
          fromBlock: this.toHex(current),
          toBlock: this.toHex(end)
        }], { retries: 2 });

        if (!Array.isArray(result)) {
          throw new Error('Invalid eth_getLogs result from BSC RPC');
        }

        logs.push(...result);
        current = end + 1;
      } catch (error) {
        const message = String(error.message || '');

        if (this.isRangeLimitError(message) && chunkSize > 1) {
          chunkSize = Math.max(1, Math.floor(chunkSize / 2));
          continue;
        }

        throw error;
      }
    }

    return logs;
  }

  async rpcRequest(method, params, options = {}) {
    const retries = Number.isInteger(options.retries) ? options.retries : DEFAULT_RPC_RETRIES;
    const rpcUrls = this.rpcUrls.length ? this.rpcUrls : [this.config.rpcUrl];

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const availableRpcUrls = this.getAvailableRpcUrls(rpcUrls);

      if (!availableRpcUrls.length) {
        const cooldownError = new Error(this.buildRpcCooldownMessage(rpcUrls));

        if (attempt >= retries) {
          throw cooldownError;
        }

        await sleep(this.getBackoffMs(attempt));
        continue;
      }

      const messages = [];

      for (const rpcUrl of availableRpcUrls) {
        try {
          const { data } = await this.http.post(rpcUrl, {
            jsonrpc: '2.0',
            id: Date.now() + attempt,
            method,
            params
          }, {
            headers: {
              'Content-Type': 'application/json'
            }
          });

          if (data?.error) {
            throw new Error(data.error.message || `RPC error ${method}`);
          }

          if (!Object.prototype.hasOwnProperty.call(data, 'result')) {
            throw new Error(`RPC malformed response for ${method}`);
          }

          this.clearRpcCooldown(rpcUrl);
          return data.result;
        } catch (error) {
          const message = this.extractAxiosErrorMessage(error);
          this.registerRpcFailure(rpcUrl, message);
          messages.push(`${rpcUrl}: ${message}`);
        }
      }

      const combinedMessage = messages.join(' | ');
      const shouldRetry = this.isRetryableError(combinedMessage);

      if (attempt >= retries || !shouldRetry) {
        throw new Error(combinedMessage || `RPC request failed for ${method}`);
      }

      await sleep(this.getBackoffMs(attempt));
    }

    throw new Error(`RPC request failed for ${method}`);
  }

  extractAxiosErrorMessage(error) {
    if (error?.response?.data?.error?.message) {
      return String(error.response.data.error.message);
    }

    if (error?.response?.data?.message) {
      return String(error.response.data.message);
    }

    if (error?.response?.status) {
      return `HTTP ${error.response.status}`;
    }

    if (error?.message) {
      return String(error.message);
    }

    return 'Unknown RPC error';
  }

  isRangeLimitError(message) {
    return /query returned more than|response size exceeded|block range|too many results|max results/i.test(String(message || ''));
  }

  isRateLimitError(message) {
    return /limit exceeded|usage limit|quota limit|monthly quota|rate limit|too many requests|429/i.test(String(message || ''));
  }

  isRetryableError(message) {
    return /limit exceeded|usage limit|quota limit|monthly quota|rate limit|too many requests|401|429|timeout|timed out|temporar|busy|gateway|502|503|504|econnreset|etimedout|enotfound|socket hang up|network error|cooldown active/i.test(String(message || ''));
  }

  getBackoffMs(attempt) {
    return Math.min(2_500, 300 * 2 ** attempt);
  }

  getAvailableRpcUrls(rpcUrls) {
    const now = Date.now();
    const available = [];

    for (const rpcUrl of rpcUrls) {
      const state = this.rpcCooldowns.get(rpcUrl);

      if (!state || state.untilMs <= now) {
        if (state && state.untilMs <= now) {
          this.rpcCooldowns.delete(rpcUrl);
        }

        available.push(rpcUrl);
      }
    }

    return available;
  }

  registerRpcFailure(rpcUrl, message) {
    if (!this.shouldCooldownRpc(message)) {
      this.clearRpcCooldown(rpcUrl);
      return;
    }

    const now = Date.now();
    const previous = this.rpcCooldowns.get(rpcUrl);
    const failures = previous && previous.reason === message
      ? Math.min(previous.failures + 1, 10)
      : 1;

    this.rpcCooldowns.set(rpcUrl, {
      failures,
      reason: message,
      untilMs: now + this.getRpcCooldownMs(message, failures)
    });
  }

  clearRpcCooldown(rpcUrl) {
    this.rpcCooldowns.delete(rpcUrl);
  }

  shouldCooldownRpc(message) {
    return this.isRateLimitError(message)
      || /401|timeout|timed out|temporar|busy|gateway|502|503|504|econnreset|etimedout|enotfound|socket hang up|network error/i.test(String(message || ''));
  }

  getRpcCooldownMs(message, failures) {
    const baseMs = this.isRateLimitError(message)
      ? this.rpcCooldownBaseMs
      : Math.max(5_000, Math.floor(this.rpcCooldownBaseMs / 2));

    return Math.min(this.rpcCooldownMaxMs, baseMs * 2 ** Math.max(0, failures - 1));
  }

  buildRpcCooldownMessage(rpcUrls) {
    const now = Date.now();
    const parts = rpcUrls
      .map((rpcUrl) => {
        const state = this.rpcCooldowns.get(rpcUrl);

        if (!state || state.untilMs <= now) {
          return '';
        }

        const seconds = Math.max(1, Math.ceil((state.untilMs - now) / 1000));
        return `${rpcUrl}: cooldown ${seconds}s (${state.reason})`;
      })
      .filter(Boolean);

    if (!parts.length) {
      return 'RPC cooldown active';
    }

    return `RPC cooldown active: ${parts.join(' | ')}`;
  }

  addressToTopic(address) {
    const raw = String(address || '').toLowerCase().replace(/^0x/, '');

    if (raw.length !== 40) {
      throw new Error('Invalid BSC address format');
    }

    return `0x${raw.padStart(64, '0')}`;
  }

  topicToAddress(topic) {
    if (!topic || typeof topic !== 'string') {
      return '';
    }

    return `0x${topic.slice(-40)}`.toLowerCase();
  }

  toHex(value) {
    return `0x${Number(value).toString(16)}`;
  }

  extractRows(data, sourceName) {
    if (data && Array.isArray(data.result)) {
      return data.result;
    }

    const details = [
      data?.message,
      typeof data?.result === 'string' ? data.result : '',
      data?.error?.message
    ]
      .filter(Boolean)
      .join(' | ');

    throw new Error(details || `Unexpected ${sourceName} response format`);
  }

  async fetchAddressLabelFromExplorer(address) {
    const explorerUrl = String(this.config.explorerUrl || 'https://bscscan.com').replace(/\/+$/, '');
    const { data } = await this.http.get(`${explorerUrl}/address/${address}`, {
      responseType: 'text'
    });

    if (typeof data !== 'string') {
      return '';
    }

    return this.extractAddressLabelFromHtml(data, address);
  }

  async fetchAddressLabelViaApi(address) {
    if (!this.config.apiKey) {
      return '';
    }

    const { data } = await this.http.get(this.config.v2ApiUrl, {
      params: {
        chainid: this.config.chainId,
        module: 'nametag',
        action: 'getaddresstag',
        address,
        apikey: this.config.apiKey
      }
    });

    if (!data || data.status !== '1' || !Array.isArray(data.result) || !data.result.length) {
      return '';
    }

    const first = data.result[0] || {};
    const candidate = first.nametag || first.internal_nametag || '';
    return this.normalizeLabelCandidate(candidate, address);
  }

  extractAddressLabelFromHtml(html, address) {
    const safeHtml = String(html || '');
    const candidates = [];
    const ogTitle = safeHtml.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    const title = safeHtml.match(/<title>([^<]+)<\/title>/i);
    const nameTag = safeHtml.match(/<span[^>]*class=["'][^"']*hash-tag[^"']*["'][^>]*>([^<]+)<\/span>/i);

    if (nameTag?.[1]) {
      candidates.push(nameTag[1]);
    }

    if (ogTitle?.[1]) {
      candidates.push(ogTitle[1]);
    }

    if (title?.[1]) {
      candidates.push(title[1]);
    }

    for (const rawCandidate of candidates) {
      const candidate = this.normalizeLabelCandidate(rawCandidate, address);

      if (candidate) {
        return candidate;
      }
    }

    return '';
  }

  normalizeLabelCandidate(value, address) {
    const decoded = this.decodeHtmlEntities(String(value || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s*\|\s*BscScan.*$/i, '')
      .replace(/\s*\|\s*Address\s+0x[a-f0-9]{40}.*$/i, '')
      .trim();

    if (!decoded) {
      return '';
    }

    const lower = decoded.toLowerCase();

    if (lower === String(address || '').toLowerCase()) {
      return '';
    }

    if (/^0x[a-f0-9]{40}$/i.test(decoded)) {
      return '';
    }

    if (/^address\s+0x[a-f0-9]{40}$/i.test(decoded)) {
      return '';
    }

    return decoded;
  }

  decodeHtmlEntities(value) {
    return String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, '\'')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
}

module.exports = {
  BscClient
};
