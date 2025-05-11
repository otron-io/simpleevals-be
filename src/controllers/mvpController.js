const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const memoryCache = require("memory-cache");
const { createClient } = require("@supabase/supabase-js");

// Simple in-memory storage for evaluations
const evaluationsStore = {
    // Map to store evaluation sets by ID
    items: new Map(),

    // Generate a unique ID for a new evaluation set
    generateId: () => {
        return (
            Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15)
        );
    },

    // Create a new evaluation set
    create: (data) => {
        const id = evaluationsStore.generateId();
        const timestamp = new Date().toISOString();
        const newItem = {
            id,
            ...data,
            timestamp,
            questions: data.questions || [],
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
            timestamp: new Date().toISOString(),
        });

        // Update the set in the store
        evaluationsStore.items.set(setId, set);
        return set;
    },

    // Get all evaluation sets (limited to most recent for now)
    getAll: (limit = 50) => {
        const items = Array.from(evaluationsStore.items.values());
        return items
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, limit);
    },
};

// Unified OpenRouter Client (using OpenAI SDK)
const openRouterClient = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: { 
      "HTTP-Referer": "https://simpleevals.com", // Your site URL
      "X-Title": "SimpleEvals", // Your site name
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}` // Explicitly add as Bearer token
    },
});

// Log OpenRouter initialization status at startup
console.log("===== SimpleEvals OpenRouter Integration Initialized =====");
console.log(`OpenRouter API Key: ${process.env.OPENROUTER_API_KEY ? "Set ✓" : "NOT SET!"}`);
console.log(`OpenRouter Client baseURL: ${openRouterClient.baseURL}`);

// Supabase client setup
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);

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

// Function to get response from a model (now using OpenRouter)
const getModelResponse = async (modelName, question, systemMessage = "") => {
    let openRouterModelSlug = "";
    let effectiveSystemMessage = systemMessage;

    // Map internal model names to OpenRouter model slugs
    if (modelName === "gpt41" || modelName === "gpt4o") { // gpt4o was an alias for gpt41 previously
        openRouterModelSlug = "openai/gpt-4.1"; 
    } else if (modelName === "claude3") {
        openRouterModelSlug = "anthropic/claude-3.7-sonnet";
    } else if (modelName === "gemini") {
        openRouterModelSlug = "google/gemini-2.5-pro-preview";
    } else {
        console.warn(`Unsupported model requested for OpenRouter: ${modelName}`);
        return `Model ${modelName} not supported via OpenRouter in this configuration.`;
    }

    try {
        const messages = [];

        // Add system message if provided. OpenRouter handles hoisting for compatible models.
        if (effectiveSystemMessage) {
            messages.push({ role: "system", content: effectiveSystemMessage });
        }

        // Add user message
        messages.push({ role: "user", content: question });

        console.log(`[${modelName}] Requesting response via OpenRouter (${openRouterModelSlug})`);
        
        const startTime = Date.now();
        const completion = await openRouterClient.chat.completions.create({
            model: openRouterModelSlug,
            messages: messages,
            // max_tokens: 1000, // Removed as requested
            // Add other parameters like temperature if needed
        });
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`[${modelName}] Response received in ${duration}ms`);
        
        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error(`[${modelName}] Error calling OpenRouter:`, error.message);
        
        let errorMessage = error.message;
        // Attempt to extract more specific error details if available (OpenAI SDK style)
        if (error.response && error.response.data && error.response.data.error && error.response.data.error.message) {
            errorMessage = error.response.data.error.message;
        } else if (error.error && error.error.message) { 
            errorMessage = error.error.message;
        }

        return `Error getting response from ${modelName} via OpenRouter: ${errorMessage}`;
    }
};

// Function to evaluate a response using LLM-as-judge (now using OpenRouter)
const evaluateResponse = async (question, referenceAnswer, modelResponse) => {
    const prompt = evaluatorPromptTemplate
        .replace("{question}", question)
        .replace("{reference_answer}", referenceAnswer)
        .replace("{model_response}", modelResponse);

    try {
        console.log(`[Evaluator] Requesting evaluation via OpenRouter (openai/gpt-4.1-mini)`);
        
        const startTime = Date.now();
        const completion = await openRouterClient.chat.completions.create({
            model: "openai/gpt-4.1-mini", // Using specified OpenRouter model for judge
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }, // Ensure JSON output
        });
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`[Evaluator] Evaluation received in ${duration}ms`);
        
        const evaluationResult = JSON.parse(
            completion.choices[0].message.content,
        );
        return evaluationResult; // Should match { is_correct: boolean, reasoning: string }
    } catch (error) {
        console.error(`[Evaluator] Error calling OpenRouter:`, error.message);
        return { is_correct: false, reasoning: "Error during evaluation." };
    }
};

// Controller function for the /evaluate endpoint
// Create a new evaluation set or add to existing one
exports.evaluateModels = async (req, res) => {
    const { question, referenceAnswer, models, evalSetId, systemMessage } =
        req.body;

    if (!question || !referenceAnswer || !models) {
        return res
            .status(400)
            .json({
                message:
                    "Missing required fields: question, referenceAnswer, models",
            });
    }

    const selectedModels = Object.entries(models)
        .filter(([_, isSelected]) => isSelected)
        .map(([modelName, _]) => modelName);

    if (selectedModels.length === 0) {
        return res
            .status(400)
            .json({ message: "No models selected for evaluation." });
    }

    console.log(
        `[SingleEval] Evaluating for models: ${selectedModels.join(", ")}${evalSetId ? ' in set ' + evalSetId : ''}`,
    );

    try {
        const results = [];
        for (const modelName of selectedModels) {
            console.log(`Getting response from ${modelName}...`);
            const response = await getModelResponse(
                modelName,
                question,
                systemMessage,
            );
            console.log(`Evaluating response from ${modelName}...`);
            const evaluation = await evaluateResponse(
                question,
                referenceAnswer,
                response,
            );

            const modelDisplayNames = {
                gpt4o: "GPT-4.1",
                gpt41: "GPT-4.1",
                claude3: "Claude 3.7",
                gemini: "Gemini 2.5",
            };

            results.push({
                model: modelDisplayNames[modelName] || modelName,
                response: response,
                evaluation: evaluation,
            });
        }
        console.log(`[SingleEval] Completed evaluation for question: "${question.substring(0,30)}..."`);

        // Store the evaluation in our data store
        const questionData = {
            question,
            referenceAnswer,
            systemMessage, // Store the system message
            results,
            timestamp: new Date().toISOString(),
        };

        let evalSet;

        // Either add to existing set or create new one
        if (evalSetId) {
            evalSet = evaluationsStore.addQuestion(evalSetId, questionData);
            if (!evalSet) {
                return res
                    .status(404)
                    .json({ message: "Evaluation set not found" });
            }
        } else {
            // Create a new set with this as the first question
            evalSet = evaluationsStore.create({
                name: "Evaluation Set",
                questions: [questionData],
            });
        }

        // Return results along with the evaluation set ID
        res.json({
            results,
            evalSetId: evalSet.id,
            questionCount: evalSet.questions.length,
        });
    } catch (error) {
        console.error("Error during model evaluation process:", error);
        res.status(500).json({
            message: "Internal server error during evaluation.",
        });
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
        .from("evaluations")
        .insert({
            name: evaluationSet.name,
            models: evaluationSet.models || [],
            questions: evaluationSet.questions || [],
            results: evaluationSet.results || {},
            created_at: new Date().toISOString(),
        })
        .select("id")
        .single();
    if (error) throw error;
    return data.id;
};

// Fetch evaluation set by ID from Supabase
const getEvaluationSetByIdFromSupabase = async (req, res) => {
    const { id } = req.params;
    try {
        const { data, error } = await supabase
            .from("evaluations")
            .select("*")
            .eq("id", id)
            .single();
        if (error || !data) {
            return res.status(404).json({ message: "Evaluation not found" });
        }
        res.json(data);
    } catch (err) {
        console.error("Error fetching evaluation from Supabase:", err);
        res.status(500).json({
            message: "Failed to fetch evaluation from Supabase",
        });
    }
};

// Evaluate a set of questions in batch mode
exports.evaluateSet = async (req, res) => {
    try {
        const { questions, models: modelNamesToEvaluate, systemMessage, setId, name } = req.body;
        
        console.log(`[Eval] Starting evaluation: ${name || 'Unnamed'} (${questions.length} questions) for models: ${modelNamesToEvaluate.join(', ')}`);
        
        // Validate request
        if (!questions || !Array.isArray(questions) || questions.length === 0) {
            return res.status(400).json({
                error: "Missing or invalid questions array",
            });
        }
        
        if (!modelNamesToEvaluate || !Array.isArray(modelNamesToEvaluate) || modelNamesToEvaluate.length === 0) {
            return res.status(400).json({
                error: "No models specified for evaluation",
            });
        }
        
        // Create a new evaluation set or use existing one
        let evaluationSet;
        
        if (setId) {
            evaluationSet = evaluationsStore.get(setId);
            if (!evaluationSet) {
                return res.status(404).json({
                    error: "Evaluation set not found",
                });
            }
        } else {
            evaluationSet = evaluationsStore.create({
                name: name || "Unnamed Evaluation",
                // Store the original selection object if needed, or just the names
                // For now, the frontend will reconstruct selection state if it needs to.
            });
        }
        
        const modelDisplayNames = {
            gpt4o: "GPT-4.1", 
            gpt41: "GPT-4.1",
            claude3: "Claude 3.7",
            gemini: "Gemini 2.5",
        };

        for (const { question, referenceAnswer } of questions) {
            const questionResultsArray = []; // To store results for this single question
            console.log(`[Eval] Processing question: "${question.substring(0, 30)}..."`);
            
            for (const modelName of modelNamesToEvaluate) { 
                const responseStartTime = Date.now(); // Start timing for response
                const responseContent = await getModelResponse(
                    modelName, 
                    question,
                    systemMessage
                );
                const responseEndTime = Date.now(); // End timing for response
                const responseTime = responseEndTime - responseStartTime;
                
                const evalStartTime = Date.now(); // Start timing for evaluation
                const evaluationResult = await evaluateResponse(
                    question,
                    referenceAnswer,
                    responseContent
                );
                const evalEndTime = Date.now(); // End timing for evaluation
                const evalTime = evalEndTime - evalStartTime;
                
                questionResultsArray.push({
                    model: modelDisplayNames[modelName] || modelName,
                    response: responseContent,
                    evaluation: evaluationResult,
                    timings: {
                        responseTime: responseTime,
                        evaluationTime: evalTime,
                        totalTime: responseTime + evalTime,
                    }
                });
                console.log(`[Eval] ${modelName} response processed and evaluated in ${responseTime + evalTime}ms`);
            }
            
            const modelsSelectionForStorage = {};
            modelNamesToEvaluate.forEach(m => modelsSelectionForStorage[m] = true);

            evaluationsStore.addQuestion(evaluationSet.id, {
                question,
                referenceAnswer,
                results: questionResultsArray, // Use the array structure here
                models: modelsSelectionForStorage, 
                systemMessage,
            });
        }
        
        // Get the updated evaluation set
        const updatedEvalSet = evaluationsStore.get(evaluationSet.id);
        
        console.log(`[Eval] Completed evaluation: ${updatedEvalSet.name} (ID: ${updatedEvalSet.id})`);
        
        return res.json(updatedEvalSet);
    } catch (error) {
        console.error('Error in evaluateSet endpoint:', error.message);
        return res.status(500).json({
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
    }
};

// MVP endpoints
module.exports = {
    // Evaluate a single response
    evaluateResponse: async (req, res) => {
        try {
            const { question, referenceAnswer, modelResponses } = req.body;
            
            // Check required fields
            if (!question || !referenceAnswer || !modelResponses) {
                return res.status(400).json({
                    error: "Missing required fields (question, referenceAnswer, modelResponses)",
                });
            }
            
            // Process responses for each model
            const results = {};
            
            for (const [modelName, response] of Object.entries(modelResponses)) {
                // Use the evaluator to get correctness rating
                const evaluationResult = await evaluateResponse(
                    question,
                    referenceAnswer,
                    response,
                );
                
                results[modelName] = {
                    response,
                    evaluation: evaluationResult,
                };
            }
            
            return res.json({ results });
        } catch (error) {
            console.error('Error in evaluateResponse endpoint:', error.message);
            return res.status(500).json({ error: error.message });
        }
    },
    
    // Get response from a specific model
    getModelResponse: async (req, res) => {
        try {
            const { question, model, systemMessage } = req.body;
            
            if (!question || !model) {
                return res.status(400).json({
                    error: "Missing required fields (question, model)",
                });
            }
            
            const response = await getModelResponse(model, question, systemMessage);
            
            return res.json({ 
                model, 
                response, 
                timestamp: new Date().toISOString() 
            });
        } catch (error) {
            console.error('Error in getModelResponse endpoint:', error.message);
            return res.status(500).json({ error: error.message });
        }
    },
    
    // Create a new evaluation set
    createEvaluationSet: async (req, res) => {
        try {
            const { name } = req.body;
            
            if (!name) {
                return res.status(400).json({
                    error: "Missing required field (name)",
                });
            }
            
            const newSet = evaluationsStore.create({ name });
            
            return res.json(newSet);
        } catch (error) {
            console.error('Error in createEvaluationSet endpoint:', error.message);
            return res.status(500).json({ error: error.message });
        }
    },
    
    // Add a question to an evaluation set
    addQuestionToSet: async (req, res) => {
        try {
            const { setId } = req.params;
            const { question, referenceAnswer } = req.body;
            
            if (!setId || !question || !referenceAnswer) {
                return res.status(400).json({
                    error: "Missing required fields (setId, question, referenceAnswer)",
                });
            }
            
            const updatedSet = evaluationsStore.addQuestion(setId, {
                question,
                referenceAnswer,
                modelResponses: {},
            });
            
            if (!updatedSet) {
                return res.status(404).json({
                    error: "Evaluation set not found",
                });
            }
            
            return res.json(updatedSet);
        } catch (error) {
            console.error('Error in addQuestionToSet endpoint:', error.message);
            return res.status(500).json({ error: error.message });
        }
    },
    
    // Get all evaluation sets
    getEvaluationSets: async (req, res) => {
        try {
            const sets = evaluationsStore.getAll();
            return res.json(sets);
        } catch (error) {
            console.error('Error in getEvaluationSets endpoint:', error.message);
            return res.status(500).json({ error: error.message });
        }
    },
    
    // Get a specific evaluation set
    getEvaluationSet: async (req, res) => {
        try {
            const { id } = req.params;
            
            if (!id) {
                return res.status(400).json({
                    error: "Missing required parameter (id)",
                });
            }
            
            const set = evaluationsStore.get(id);
            
            if (!set) {
                return res.status(404).json({
                    error: "Evaluation set not found",
                });
            }
            
            return res.json(set);
        } catch (error) {
            console.error('Error in getEvaluationSet endpoint:', error.message);
            return res.status(500).json({ error: error.message });
        }
    },
    
    // Fetch a specific evaluation set from Supabase for sharing
    getSharedEvaluationSet: getEvaluationSetByIdFromSupabase,
    
    // Evaluate a set of questions with multiple models
    evaluateSet: async (req, res) => {
        try {
            const { questions, models: modelNamesToEvaluate, systemMessage, setId, name } = req.body; 
            
            console.log(`[Eval] Starting evaluation: ${name || 'Unnamed'} (${questions.length} questions) for models: ${modelNamesToEvaluate.join(', ')}`);
            
            if (!questions || !Array.isArray(questions) || questions.length === 0) {
                return res.status(400).json({ error: "Missing or invalid questions array" });
            }
            
            if (!modelNamesToEvaluate || !Array.isArray(modelNamesToEvaluate) || modelNamesToEvaluate.length === 0) {
                return res.status(400).json({ error: "No models specified for evaluation" });
            }
            
            let evaluationSet;
            if (setId) {
                evaluationSet = evaluationsStore.get(setId);
                if (!evaluationSet) {
                    return res.status(404).json({ error: "Evaluation set not found" });
                }
            } else {
                evaluationSet = evaluationsStore.create({
                    name: name || "Unnamed Evaluation",
                });
            }
            
            const modelDisplayNames = {
                gpt4o: "GPT-4.1", 
                gpt41: "GPT-4.1",
                claude3: "Claude 3.7",
                gemini: "Gemini 2.5",
            };

            for (const { question, referenceAnswer } of questions) {
                const questionResultsArray = []; // To store results for this single question
                console.log(`[Eval] Processing question: "${question.substring(0, 30)}..."`);
                
                for (const modelName of modelNamesToEvaluate) { 
                    const responseStartTime = Date.now(); // Start timing for response
                    const responseContent = await getModelResponse(
                        modelName, 
                        question,
                        systemMessage
                    );
                    const responseEndTime = Date.now(); // End timing for response
                    const responseTime = responseEndTime - responseStartTime;
                    
                    const evalStartTime = Date.now(); // Start timing for evaluation
                    const evaluationResult = await evaluateResponse(
                        question,
                        referenceAnswer,
                        responseContent
                    );
                    const evalEndTime = Date.now(); // End timing for evaluation
                    const evalTime = evalEndTime - evalStartTime;
                    
                    questionResultsArray.push({
                        model: modelDisplayNames[modelName] || modelName,
                        response: responseContent,
                        evaluation: evaluationResult,
                        timings: {
                            responseTime: responseTime,
                            evaluationTime: evalTime,
                            totalTime: responseTime + evalTime,
                        }
                    });
                    console.log(`[Eval] ${modelName} response processed and evaluated in ${responseTime + evalTime}ms`);
                }
                
                const modelsSelectionForStorage = {};
                modelNamesToEvaluate.forEach(m => modelsSelectionForStorage[m] = true);

                evaluationsStore.addQuestion(evaluationSet.id, {
                    question,
                    referenceAnswer,
                    results: questionResultsArray, // Use the array structure here
                    models: modelsSelectionForStorage, 
                    systemMessage,
                });
            }
            
            const updatedSet = evaluationsStore.get(evaluationSet.id);
            console.log(`[Eval] Completed evaluation: ${updatedSet.name} (ID: ${updatedSet.id})`);
            return res.json(updatedSet);
        } catch (error) {
            console.error('Error in evaluateSet endpoint:', error.message);
            return res.status(500).json({
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            });
        }
    },
};
