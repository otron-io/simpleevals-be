const AVAILABLE_MODELS = {
  gpt4o: {
    slug: 'openai/gpt-4.1',
    display: 'GPT-4.1'
  },
  gpt41: {
    slug: 'openai/gpt-4.1',
    display: 'GPT-4.1'
  },
  claude3: {
    slug: 'anthropic/claude-sonnet-4',
    display: 'Claude Sonnet 4'
  },
  gemini: {
    slug: 'google/gemini-2.5-flash-preview-05-20',
    display: 'Gemini 2.5 Flash'
  }
};

/**
 * Retrieves the slug for the specified model name.
 *
 * @param {string} name - The name of the model (e.g., 'gpt4o', 'gpt41', 'claude3', 'gemini').
 * @returns {string|null} The slug associated with the model name, or null if the name is unsupported.
 */
function getOpenRouterSlug(name) {
  return AVAILABLE_MODELS[name] ? AVAILABLE_MODELS[name].slug : null;
}

function getDisplayName(name) {
  return AVAILABLE_MODELS[name] ? AVAILABLE_MODELS[name].display : name;
}

module.exports = { AVAILABLE_MODELS, getOpenRouterSlug, getDisplayName };
