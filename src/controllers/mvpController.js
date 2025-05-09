const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const memoryCache = require('memory-cache');
const { createClient } = require('@supabase/supabase-js');

// Simple in-memory storage for evaluations
const evaluationsStore = {
    // Map to store evaluation sets by ID
    items: new Map(),
    
    // Generate a unique ID for a new evaluation set
    generateId: () => {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15);
    },
    
    // Create a new evaluation set
    create: (data) => {
        const id = evaluationsStore.generateId();
        const timestamp = new Date().toISOString();
        const newItem = {
            id,
            ...data,
            timestamp,
            questions: data.questions || []
        };
        evaluationsStore.items.set(id, newItem);
        return newItem;
    },
    
    // Get an evaluation set by ID
    get: (id) => {
        return evaluationsStore.items.get(id);
    },
    
    // Add a question to an existing evaluation set
    addQuestion: (setId, questionData) => {
        const set = evaluationsStore.items.get(setId);
        if (!set) return null;
        
        set.questions.push({
            ...questionData,
            timestamp: new Date().toISOString()
        });
        
        // Update the set in the store
        evaluationsStore.items.set(setId, set);
        return set;
    },
    
    // Get all evaluation sets (limited to most recent for now)
    getAll: (limit = 50) => {
        const items = Array.from(evaluationsStore.items.values());
        return items.sort((a, b) => 
            new Date(b.timestamp) - new Date(a.timestamp)
        ).slice(0, limit);
    }
};

// Initialize API clients
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Supabase client setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Placeholder for the evaluator prompt from docs
const evaluatorPromptTemplate = `
You are a precise and objective evaluator tasked with determining if a model's answer correctly responds to a user question based on a provided reference answer.

[QUESTION]
{question}

[REFERENCE ANSWER]
{reference_answer}

[MODEL RESPONSE]
{model_response}

Evaluate whether the model response correctly answers the question by comparing it to the reference answer. 

Instructions for evaluation:
1. The response is CORRECT if it contains the same key information as the reference answer, even if phrased differently.
2. The response is INCORRECT if it:
   - Contradicts the reference answer
   - Misses critical information contained in the reference answer
   - Adds incorrect information not in the reference answer
   - Fails to address the question directly

Respond with a JSON object in the following format:
{
  "is_correct": true/false,
  "reasoning": "A brief explanation (1-2 sentences) of why the response is correct or incorrect."
}

Your evaluation must be strict but fair, focusing only on correctness of information rather than style, verbosity, or tone.
`;

// Function to get response from a model (starting with OpenAI)
const getModelResponse = async (modelName, question, systemMessage = '') => {
    if (modelName === 'gpt4o' || modelName === 'gpt41') {
        try {
            const messages = [];

            // Add system message if provided
            if (systemMessage) {
                messages.push({ role: "system", content: systemMessage });
            }

            // Add user message
            messages.push({ role: "user", content: question });

            const completion = await openai.chat.completions.create({
                model: "gpt-4.1", // Use GPT-4.1 for user-facing evaluation
                messages: messages,
                temperature: 0.7, // Adjust as needed
            });
            return completion.choices[0].message.content.trim();
        } catch (error) {
            console.error(`Error calling OpenAI API for ${modelName}:`, error);
            return "Error getting response from OpenAI";
        }
    } else if (modelName === 'claude3') {
        try {
            // Check if API key is set
            if (!process.env.ANTHROPIC_API_KEY) {
                console.error('ANTHROPIC_API_KEY is not set in environment variables');
                return "Error: Anthropic API key is missing";
            }

            // Initialize client with explicit apiKey param
            const claudeClient = new Anthropic({
                apiKey: process.env.ANTHROPIC_API_KEY.trim()
            });

            const messages = [];

            // Add system message if provided
            if (systemMessage) {
                messages.push({ role: "system", content: systemMessage });
            }

            // Add user message
            messages.push({ role: "user", content: question });

            // Use only the stable model without preview features
            const response = await claudeClient.messages.create({
                model: "claude-3-7-sonnet-latest", // Use the latest Claude 3.7 Sonnet model
                max_tokens: 1000,
                temperature: 0.7,
                messages: messages
                // Removed thinking parameter as it may not be widely supported
            });
            return response.content[0].text;
        } catch (error) {
            console.error(`Error calling Anthropic API for ${modelName}:`, error);
            return `Error getting response from Claude: ${error.message}`;
        }
    } else if (modelName === 'gemini') {
        try {
            // Initialize the model with stable Gemini version
            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-pro-preview-03-25" // Use Gemini 2.5 Pro preview model
            });

            const contents = [];

            // Add system message if provided
            if (systemMessage) {
                contents.push({ role: "system", parts: [{ text: systemMessage }] });
            }

            // Add user message
            contents.push({ role: "user", parts: [{ text: question }] });

            // Use simple generateContent instead of chat for compatibility
            const result = await model.generateContent({
                contents: contents,
                generationConfig: {
                    temperature: 0.7,
                }
            });
            return result.response.text();
        } catch (error) {
            console.error(`Error calling Google Gemini API for ${modelName}:`, error);
            return `Error getting response from Gemini 2.5: ${error.message}`;
        }
    } else {
        console.warn(`Unsupported model requested: ${modelName}`);
        return `Model ${modelName} not supported yet.`;
    }
};

// Function to evaluate a response using LLM-as-judge (OpenAI)
const evaluateResponse = async (question, referenceAnswer, modelResponse) => {
    const prompt = evaluatorPromptTemplate
        .replace('{question}', question)
        .replace('{reference_answer}', referenceAnswer)
        .replace('{model_response}', modelResponse);

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4.1-mini", // Using GPT-4.1-mini as the judge
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }, // Ensure JSON output
            temperature: 0.2, // Lower temperature for more deterministic evaluation
        });
        const evaluationResult = JSON.parse(completion.choices[0].message.content);
        return evaluationResult; // Should match { is_correct: boolean, reasoning: string }
    } catch (error) {
        console.error("Error calling OpenAI API for evaluation:", error);
        return { is_correct: false, reasoning: "Error during evaluation." };
    }
};

// Controller function for the /evaluate endpoint
// Create a new evaluation set or add to existing one
exports.evaluateModels = async (req, res) => {
    const { question, referenceAnswer, models, evalSetId, systemMessage } = req.body;

    if (!question || !referenceAnswer || !models) {
        return res.status(400).json({ message: "Missing required fields: question, referenceAnswer, models" });
    }

    const selectedModels = Object.entries(models)
        .filter(([_, isSelected]) => isSelected)
        .map(([modelName, _]) => modelName);

    if (selectedModels.length === 0) {
        return res.status(400).json({ message: "No models selected for evaluation." });
    }

    console.log(`Evaluating question: "${question}" for models: ${selectedModels.join(', ')}`);
    if (systemMessage) {
        console.log(`Using system message: "${systemMessage}"`);
    }

    try {
        const results = [];
        for (const modelName of selectedModels) {
            console.log(`Getting response from ${modelName}...`);
            const response = await getModelResponse(modelName, question, systemMessage);
            console.log(`Evaluating response from ${modelName}...`);
            const evaluation = await evaluateResponse(question, referenceAnswer, response);

            const modelDisplayNames = {
                gpt4o: 'GPT-4.1',
                gpt41: 'GPT-4.1',
                claude3: 'Claude 3.7',
                gemini: 'Gemini 2.5'
            };

            results.push({
                model: modelDisplayNames[modelName] || modelName,
                response: response,
                evaluation: evaluation
            });
        }

        // Store the evaluation in our data store
        const questionData = {
            question,
            referenceAnswer,
            systemMessage, // Store the system message
            results,
            timestamp: new Date().toISOString()
        };

        let evalSet;

        // Either add to existing set or create new one
        if (evalSetId) {
            evalSet = evaluationsStore.addQuestion(evalSetId, questionData);
            if (!evalSet) {
                return res.status(404).json({ message: "Evaluation set not found" });
            }
        } else {
            // Create a new set with this as the first question
            evalSet = evaluationsStore.create({
                name: "Evaluation Set",
                questions: [questionData]
            });
        }

        // Return results along with the evaluation set ID
        res.json({
            results,
            evalSetId: evalSet.id,
            questionCount: evalSet.questions.length
        });
    } catch (error) {
        console.error("Error during model evaluation process:", error);
        res.status(500).json({ message: "Internal server error during evaluation." });
    }
};

// Get an evaluation set by ID
exports.getEvaluationSet = (req, res) => {
    const { id } = req.params;
    
    if (!id) {
        return res.status(400).json({ message: "Missing evaluation set ID" });
    }
    
    const evalSet = evaluationsStore.get(id);
    
    if (!evalSet) {
        return res.status(404).json({ message: "Evaluation set not found" });
    }
    
    res.json(evalSet);
};

// Get all evaluation sets (limited)
exports.getAllEvaluationSets = (req, res) => {
    const evalSets = evaluationsStore.getAll();
    res.json(evalSets);
};

// Save evaluation set to Supabase and return the new ID
exports.saveEvaluationSetToSupabase = async (evaluationSet) => {
    const { data, error } = await supabase
        .from('evaluations')
        .insert({
            name: evaluationSet.name,
            models: evaluationSet.models || [],
            questions: evaluationSet.questions || [],
            results: evaluationSet.results || {},
            created_at: new Date().toISOString()
        })
        .select('id')
        .single();
    if (error) throw error;
    return data.id;
};

// Fetch evaluation set by ID from Supabase
exports.getEvaluationSetById = async (req, res) => {
    const { id } = req.params;
    try {
        const { data, error } = await supabase
            .from('evaluations')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !data) {
            return res.status(404).json({ message: 'Evaluation not found' });
        }
        res.json(data);
    } catch (err) {
        console.error('Error fetching evaluation from Supabase:', err);
        res.status(500).json({ message: 'Failed to fetch evaluation from Supabase' });
    }
};

// Evaluate a set of questions in batch mode
exports.evaluateSet = async (req, res) => {
    const { questions, models, setName, systemMessage } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "Missing or invalid questions array" });
    }

    if (!models || models.length === 0) {
        return res.status(400).json({ message: "No models selected for evaluation" });
    }

    if (!setName) {
        return res.status(400).json({ message: "Evaluation set name is required" });
    }

    // Enforce 500-character limit for question and referenceAnswer
    for (const q of questions) {
        if ((q.question && q.question.length > 500) || (q.referenceAnswer && q.referenceAnswer.length > 500)) {
            return res.status(400).json({ message: "Each question and reference answer must be 500 characters or fewer." });
        }
    }

    // Enforce character limit for system message if provided
    if (systemMessage && systemMessage.length > 1000) {
        return res.status(400).json({ message: "System message must be 1000 characters or fewer." });
    }

    try {
        // Create a new evaluation set
        const evalSet = evaluationsStore.create({
            name: setName,
            models,
            systemMessage, // Store system message at the set level
            questions: []
        });

        // Process each question
        for (const q of questions) {
            const { question, referenceAnswer } = q;
            if (!question || !referenceAnswer) {
                continue; // Skip invalid questions
            }
            const results = [];
            // Get responses from each model
            for (const modelName of models) {
                // Measure response time
                const responseStartTime = performance.now();
                const response = await getModelResponse(modelName, question, systemMessage);
                const responseEndTime = performance.now();
                const responseTime = Math.round(responseEndTime - responseStartTime);

                // Measure evaluation time
                const evalStartTime = performance.now();
                const evaluation = await evaluateResponse(question, referenceAnswer, response);
                const evalEndTime = performance.now();
                const evalTime = Math.round(evalEndTime - evalStartTime);

                const modelDisplayNames = {
                    gpt4o: 'GPT-4.1',
                    gpt41: 'GPT-4.1',
                    claude3: 'Claude 3.7',
                    gemini: 'Gemini 2.5'
                };
                results.push({
                    model: modelDisplayNames[modelName] || modelName,
                    response: response,
                    evaluation: evaluation,
                    timings: {
                        responseTime,
                        evalTime,
                        totalTime: responseTime + evalTime
                    }
                });
            }
            // Add the question with results to the evaluation set
            const questionData = {
                question,
                referenceAnswer,
                results,
                timestamp: new Date().toISOString()
            };
            evaluationsStore.addQuestion(evalSet.id, questionData);
        }
        // Get the updated evaluation set to return
        const updatedEvalSet = evaluationsStore.get(evalSet.id);
        // Save to Supabase and get the ID
        const supabaseId = await exports.saveEvaluationSetToSupabase({
            name: updatedEvalSet.name,
            models: updatedEvalSet.models,
            systemMessage: updatedEvalSet.systemMessage,
            questions: updatedEvalSet.questions,
            results: updatedEvalSet,
            timestamp: updatedEvalSet.timestamp
        });
        res.json({ ...updatedEvalSet, id: supabaseId });
    } catch (err) {
        console.error('Error during evaluation:', err);
        res.status(500).json({ message: 'Failed to evaluate questions' });
    }
}; 