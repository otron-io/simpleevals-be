/**
 * Helper utility to verify API keys are properly configured
 */

const checkApiKeys = () => {
  const apiKeys = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY
  };
  
  console.log('API Key Status:');
  
  // Check key format patterns
  const keyPatterns = {
    OPENAI_API_KEY: {
      pattern: /^sk-[a-zA-Z0-9]{32,}$/,
      example: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    },
    ANTHROPIC_API_KEY: {
      pattern: /^sk-ant-[a-zA-Z0-9]{32,}$/,
      example: 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    },
    GEMINI_API_KEY: {
      pattern: /^AIza[a-zA-Z0-9_-]{35,}$/,
      example: 'AIzaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
    }
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
  if (apiKeys.ANTHROPIC_API_KEY) {
    if (!apiKeys.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
      console.warn(`ℹ️ Note: Anthropic API keys should start with 'sk-ant-'.`);
      console.warn(`   If you're using an older Anthropic key or a different format,`);
      console.warn(`   you may need to create a new key in the Anthropic console.`);
    }
  }
  
  console.log(''); // Add newline for readability
};

module.exports = { checkApiKeys }; 