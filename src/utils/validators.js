const { NETWORKS, coerceNetwork } = require('./constants');

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const TRON_ADDRESS_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function normalizeNetwork(input) {
  return coerceNetwork(input);
}

function isValidAddress(network, address) {
  if (!address) {
    return false;
  }

  if (network === NETWORKS.BEP20) {
    return EVM_ADDRESS_REGEX.test(address);
  }

  if (network === NETWORKS.TRC20) {
    return TRON_ADDRESS_REGEX.test(address);
  }

  return false;
}

function normalizeAddress(network, address) {
  const raw = String(address || '').trim();

  if (network === NETWORKS.BEP20) {
    return raw.toLowerCase();
  }

  return raw;
}

module.exports = {
  isValidAddress,
  normalizeAddress,
  normalizeNetwork
};
