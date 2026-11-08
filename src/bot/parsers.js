function parseStartPayload(text) {
  const payload = String(text || '').trim().split(' ')[1];
  return payload || null;
}

function parseAddCommand(text) {
  const [, ...parts] = String(text || '').trim().split(/\s+/);

  if (parts.length < 3) {
    return null;
  }

  const network = parts[0];
  const address = parts[1];
  const name = parts.slice(2).join(' ').trim();

  if (!name) {
    return null;
  }

  return { network, address, name };
}

function parseSingleNetworkAddCommand(text, forcedNetwork) {
  const [, ...parts] = String(text || '').trim().split(/\s+/);

  if (parts.length < 2) {
    return null;
  }

  const address = parts[0];
  const name = parts.slice(1).join(' ').trim();

  if (!name) {
    return null;
  }

  return {
    network: forcedNetwork,
    address,
    name
  };
}

function parseWalletInputText(text) {
  const parts = String(text || '').trim().split(/\s+/);

  if (parts.length < 2) {
    return null;
  }

  const address = parts[0];
  const name = parts.slice(1).join(' ').trim();

  if (!name) {
    return null;
  }

  return { address, name };
}

function parseThresholdValue(raw) {
  const normalized = String(raw || '').trim().replace(',', '.');
  const value = Number(normalized);

  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  return value;
}

function isCancelText(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return normalized === '/cancel' || normalized === 'отмена' || normalized === 'cancel';
}

module.exports = {
  isCancelText,
  parseAddCommand,
  parseSingleNetworkAddCommand,
  parseStartPayload,
  parseThresholdValue,
  parseWalletInputText
};
