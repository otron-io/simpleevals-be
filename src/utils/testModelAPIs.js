/**
 * Test script to verify API connections
 * Run with: node src/utils/testModelAPIs.js
 */

require('dotenv').config();
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { checkApiKeys } = require('./apiKeyCheck');

// Simple test question
const TEST_QUESTION = "What is 2+2? Answer with just the number.";
const TEST_SYSTEM_MESSAGE = "You are a helpful assistant that provides concise answers.";

// Test OpenAI API
const testOpenAI = async () => {
  try {
    console.log("🔍 Testing OpenAI API connection...");
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Test first without system message
    const completion1 = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Using a simpler model for testing
      messages: [{ role: "user", content: TEST_QUESTION }],
    });

    console.log("✅ OpenAI API connection successful!");
    console.log(`Response without system message: "${completion1.choices[0].message.content.trim()}"`);

    // Test with system message
    const completion2 = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Using a simpler model for testing
      messages: [
        { role: "system", content: TEST_SYSTEM_MESSAGE },
        { role: "user", content: TEST_QUESTION }
      ],
    });

    console.log(`Response with system message: "${completion2.choices[0].message.content.trim()}"`);

    return true;
  } catch (error) {
    console.error("❌ OpenAI API connection failed!");
    console.error(`Error: ${error.message}`);
    console.error(error);
    return false;
  }
};

// Test Anthropic API
const testAnthropic = async () => {
  try {
    console.log("🔍 Testing Anthropic API connection...");
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY.trim(),
    });

    // Test first without system message
    const response1 = await anthropic.messages.create({
      model: "claude-3-haiku-20240307", // Using the simplest model for testing
      max_tokens: 100,
      messages: [
        { role: "user", content: TEST_QUESTION }
      ],
    });

    console.log("✅ Anthropic API connection successful!");
    console.log(`Response without system message: "${response1.content[0].text}"`);

    // Test with system message
    const response2 = await anthropic.messages.create({
      model: "claude-3-haiku-20240307", // Using the simplest model for testing
      max_tokens: 100,
      messages: [
        { role: "system", content: TEST_SYSTEM_MESSAGE },
        { role: "user", content: TEST_QUESTION }
      ],
    });

    console.log(`Response with system message: "${response2.content[0].text}"`);

    return true;
  } catch (error) {
    console.error("❌ Anthropic API connection failed!");
    console.error(`Error: ${error.message}`);
    if (error.status === 401) {
      console.error("This is an authentication error. Check your API key format!");

      // Provide debugging information for Anthropic keys
      const key = process.env.ANTHROPIC_API_KEY;
      if (key) {
        console.error(`Key starts with: ${key.substring(0, 7)}...`);
        console.error("Anthropic keys should start with 'sk-ant-'");
        console.error("Get a new key from https://console.anthropic.com/keys");
      }
    }
    return false;
  }
};

// Test Google Gemini API
const testGemini = async () => {
  try {
    console.log("🔍 Testing Google Gemini API connection...");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Try to list available models first to check credentials
    console.log("Checking available Gemini models...");
    const models = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).listModels();
    console.log(`Available models: ${models ? 'Yes' : 'No'}`);

    // Generate content with simplest model without system message
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result1 = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: TEST_QUESTION }] }],
    });

    console.log("✅ Google Gemini API connection successful!");
    console.log(`Response without system message: "${result1.response.text()}"`);

    // Generate content with system message
    const result2 = await model.generateContent({
      contents: [
        { role: "system", parts: [{ text: TEST_SYSTEM_MESSAGE }] },
        { role: "user", parts: [{ text: TEST_QUESTION }] }
      ],
    });

    console.log(`Response with system message: "${result2.response.text()}"`);

    return true;
  } catch (error) {
    console.error("❌ Google Gemini API connection failed!");
    console.error(`Error: ${error.message}`);
    console.error(error);

    if (error.message && error.message.includes("not found")) {
      console.error("Model not found. Try using a different model.");
      console.error("Common Gemini models: gemini-1.5-flash, gemini-1.5-pro");
    }
    return false;
  }
};

// Run all tests
const runTests = async () => {
  console.log("\n=== API KEY CHECK ===\n");
  checkApiKeys();
  
  console.log("\n=== API CONNECTION TESTS ===\n");
  
  const openaiResult = await testOpenAI();
  console.log("\n---\n");
  
  const anthropicResult = await testAnthropic();
  console.log("\n---\n");
  
  const geminiResult = await testGemini();
  
  console.log("\n=== TEST SUMMARY ===\n");
  console.log(`OpenAI API: ${openaiResult ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Anthropic API: ${anthropicResult ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Google Gemini API: ${geminiResult ? '✅ PASSED' : '❌ FAILED'}`);
};

// Execute tests
runTests().catch(error => {
  console.error("Error running tests:", error);
}); 