const { createActions } = require('./actions');
const { registerCallbacks } = require('./callbacks');
const { registerCommands } = require('./commands');
const { createConversation } = require('./conversation');
const { registerMenuButtons } = require('./menuButtons');

function registerHandlers({ bot, stateRepository, defaultThreshold, monitorService }) {
  const actions = createActions({ bot, stateRepository, monitorService, defaultThreshold });
  const conversation = createConversation({ bot, stateRepository, actions });
  const context = { bot, stateRepository, defaultThreshold, actions, conversation };

  registerCommands(context);
  registerCallbacks(context);
  registerMenuButtons(context);
}

module.exports = {
  registerHandlers
};
