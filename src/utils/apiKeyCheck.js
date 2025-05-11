/**
 * Helper utility to verify API keys are properly configured
 */

const checkApiKeys = () => {
  const apiKeys = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    // OPENAI_API_KEY: process.env.OPENAI_API_KEY, // No longer primary for mvpController
    // ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, // No longer used by mvpController
    // GEMINI_API_KEY: process.env.GEMINI_API_KEY // No longer used by mvpController
  };
  
  console.log('API Key Status (OpenRouter integration):');
  
  // Check key format patterns
  const keyPatterns = {
    OPENROUTER_API_KEY: {
      pattern: /^sk-or-v1-[a-zA-Z0-9]{40,}$/,
      example: 'sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' // Example format
    },
    // OPENAI_API_KEY: { // Pattern for original OpenAI key, if needed elsewhere
    //   pattern: /^sk-[a-zA-Z0-9]{32,}$/,
    //   example: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    // },
    // ANTHROPIC_API_KEY: { // Original pattern
    //   pattern: /^sk-ant-[a-zA-Z0-9]{32,}$/,
    //   example: 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    // },
    // GEMINI_API_KEY: { // Original pattern
    //   pattern: /^AIza[a-zA-Z0-9_-]{35,}$/,
    //   example: 'AIzaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
    // }
  };
  
  Object.entries(apiKeys).forEach(([name, key]) => {
    if (!key) {
      console.error(`❌ ${name} is missing!`);
    } else if (key.includes('your_')) {
      console.warn(`⚠️ ${name} appears to be a placeholder.`);
    } else {
      // Redact key to show only first and last 4 characters
      const redacted = key.length > 8 
        ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}`
        : '****';
      
      // Check if key format matches expected pattern
      const pattern = keyPatterns[name] ? keyPatterns[name].pattern : null;
      const example = keyPatterns[name] ? keyPatterns[name].example : null;
      
      if (pattern && !pattern.test(key)) {
        console.warn(`⚠️ ${name} format may be incorrect (${redacted})`);
        console.warn(`   Expected format: ${example}`);
      } else {
        console.log(`✅ ${name} is set (${redacted})`);
      }
    }
  });
  
  // Add special note for Anthropic API keys
  // if (apiKeys.ANTHROPIC_API_KEY) { // This specific note might no longer be relevant if not using direct Anthropic keys
  //   if (!apiKeys.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
  //     console.warn(`ℹ️ Note: Anthropic API keys should start with 'sk-ant-'.`);
  //     console.warn(`   If you're using an older Anthropic key or a different format,`);
  //     console.warn(`   you may need to create a new key in the Anthropic console.`);
  //   }
  // }
  
  console.log(''); // Add newline for readability
};

module.exports = { checkApiKeys }; 