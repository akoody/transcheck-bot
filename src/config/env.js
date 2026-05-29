const path = require('path');
const dotenv = require('dotenv');

const dotenvResult = dotenv.config();
const fileEnv = dotenvResult.parsed || {};

function readEnv(key, fallback = '') {
  if (Object.prototype.hasOwnProperty.call(fileEnv, key)) {
    return fileEnv[key];
  }

  return process.env[key] ?? fallback;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildBscRpcFallbackUrls() {
  const fallbacks = [];
  const ankrApiKey = String(readEnv('ANKR_API_KEY') || '').trim();
  const nodeRealApiKey = String(readEnv('NODEREAL_API_KEY') || '').trim();

  if (ankrApiKey) {
    fallbacks.push(`https://rpc.ankr.com/bsc/${ankrApiKey}`);
  }

  if (nodeRealApiKey) {
    fallbacks.push(`https://bsc-mainnet.nodereal.io/v1/${nodeRealApiKey}`);
  }

  fallbacks.push(...toList(readEnv('BSC_RPC_FALLBACK_URLS')));
  return fallbacks;
}

const TELEGRAM_BOT_TOKEN = readEnv('TELEGRAM_BOT_TOKEN');

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

module.exports = {
  telegram: {
    token: TELEGRAM_BOT_TOKEN
  },
  monitor: {
    pollIntervalMs: Math.max(10_000, toNumber(readEnv('POLL_INTERVAL_MS'), 20_000)),
    minAlertUsdt: Math.max(0, toNumber(readEnv('MIN_ALERT_USDT'), 0.98)),
    walletErrorBaseCooldownMs: Math.max(5_000, toNumber(readEnv('MONITOR_WALLET_ERROR_BASE_COOLDOWN_MS'), 30_000)),
    walletErrorMaxCooldownMs: Math.max(15_000, toNumber(readEnv('MONITOR_WALLET_ERROR_MAX_COOLDOWN_MS'), 10 * 60_000)),
    walletErrorLogIntervalMs: Math.max(10_000, toNumber(readEnv('MONITOR_WALLET_ERROR_LOG_INTERVAL_MS'), 60_000))
  },
  bsc: {
    apiKey: readEnv('ETHERSCAN_API_KEY') || readEnv('BSCSCAN_API_KEY') || '',
    legacyApiKey: readEnv('BSCSCAN_API_KEY') || '',
    v2ApiUrl: 'https://api.etherscan.io/v2/api',
    legacyApiUrl: 'https://api.bscscan.com/api',
    chainId: 56,
    rpcUrl: readEnv('BSC_RPC_URL') || 'https://bsc-rpc.publicnode.com',
    rpcFallbackUrls: buildBscRpcFallbackUrls(),
    rpcWarmupBlocks: Math.max(6, toNumber(readEnv('BSC_RPC_WARMUP_BLOCKS'), 24)),
    rpcChunkSize: Math.max(1, toNumber(readEnv('BSC_RPC_CHUNK_SIZE'), 50)),
    rpcCooldownBaseMs: Math.max(5_000, toNumber(readEnv('BSC_RPC_COOLDOWN_BASE_MS'), 30_000)),
    rpcCooldownMaxMs: Math.max(15_000, toNumber(readEnv('BSC_RPC_COOLDOWN_MAX_MS'), 10 * 60_000)),
    addressTagTtlMs: Math.max(5 * 60_000, toNumber(readEnv('BSC_ADDRESS_TAG_TTL_MS'), 6 * 60 * 60_000)),
    useExplorerFallback: String(readEnv('BSC_USE_EXPLORER_FALLBACK') || 'false').toLowerCase() === 'true',
    explorerUrl: 'https://bscscan.com',
    usdtContract: '0x55d398326f99059ff775485246999027b3197955'
  },
  tron: {
    apiKey: readEnv('TRONGRID_API_KEY') || '',
    apiUrl: 'https://api.trongrid.io/v1',
    explorerUrl: 'https://tronscan.org/#',
    requestRetries: Math.max(0, toNumber(readEnv('TRON_REQUEST_RETRIES'), 2)),
    cooldownBaseMs: Math.max(5_000, toNumber(readEnv('TRON_COOLDOWN_BASE_MS'), 20_000)),
    cooldownMaxMs: Math.max(15_000, toNumber(readEnv('TRON_COOLDOWN_MAX_MS'), 5 * 60_000)),
    usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
  },
  storage: {
    dataFile: path.resolve(process.cwd(), readEnv('DATA_FILE') || './data/state.json')
  }
};
