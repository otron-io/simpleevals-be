
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
    apiEndpoint: process.env.VERTEX_API_ENDPOINT || "us-central1-aiplatform.googleapis.com",
    vertexai: true
});

async function testGemini() {
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-pro-preview-03-25"
        });

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: "What is 2+2? Answer with just the number." }] }],
            generationConfig: {
                temperature: 0.7,
            }
        });

        console.log("Gemini Response:", result.response.text());
        console.log("✅ Gemini API connection successful!");
    } catch (error) {
        console.error("❌ Gemini API connection failed:", error.message);
    }
}

testGemini();
