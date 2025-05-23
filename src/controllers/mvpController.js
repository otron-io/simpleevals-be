const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const memoryCache = require("memory-cache");
const { createClient } = require("@supabase/supabase-js");

// Simple in-memory storage for evaluations
const { AVAILABLE_MODELS, getOpenRouterSlug, getDisplayName } = require("../lib/models");
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
    const openRouterModelSlug = getOpenRouterSlug(modelName);
    let effectiveSystemMessage = systemMessage;

    if (!openRouterModelSlug) {
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
                claude3: "Claude Sonnet 4",
                gemini: "Gemini 2.5",
            };

            results.push({
                model: getDisplayName(modelName),
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

// Helper function to prepare evaluation for Supabase by ensuring consistent format
const prepareEvaluationForSupabase = (evaluation) => {
    // Create a clean copy without any circular references or non-serializable fields
    const cleanEvaluation = JSON.parse(JSON.stringify({
        id: evaluation.id,
        name: evaluation.name || evaluation.setName || "Unnamed Evaluation",
        user_id: evaluation.user_id || null,
        models: evaluation.models || [],
        questions: evaluation.questions || [],
        results: evaluation.results || {},
        created_at: evaluation.created_at || evaluation.timestamp || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        evaluate_automatically: evaluation.evaluate_automatically !== false
    }));
    
    return cleanEvaluation;
};

// Helper function to check if an evaluation with given id exists in Supabase
const checkEvaluationInSupabase = async (id) => {
    if (!id) return null;
    
    try {
        // Check if the ID looks like a UUID (standard UUID format check)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        
        // If it's not a UUID, it can't be in Supabase (Supabase uses UUIDs)
        if (!uuidRegex.test(id)) {
            console.log(`ID ${id} is not a UUID format - not in Supabase`);
            return null;
        }
        
        // If it looks like a UUID, check if it exists in Supabase
        const { data, error } = await supabase
            .from("evaluations")
            .select("id, created_at")
            .eq("id", id)
            .single();
            
        if (error) {
            // If it's an RLS error, that means the record exists but we can't see it
            if (error.code === 'PGRST301') {
                console.log(`Evaluation exists in Supabase but is protected by RLS: ${id}`);
                return { id, rls_protected: true };
            }
            
            console.error(`Error checking evaluation in Supabase: ${error.message}`);
            return null;
        }
        
        return data;
    } catch (error) {
        console.error(`Error in checkEvaluationInSupabase: ${error.message}`);
        return null;
    }
};

// Save evaluation set to Supabase and return the new ID
exports.saveEvaluationSetToSupabase = async (evaluationSet) => {
    // Prepare a clean evaluation object for Supabase
    const preparedEvaluation = prepareEvaluationForSupabase(evaluationSet);
    
    // Sanitize the name by stripping HTML and limiting length
    let name = preparedEvaluation.name;
    name = name.replace(/<[^>]*>?/gm, '').trim();
    name = name.length > 100 ? name.substring(0, 100) : name;
    preparedEvaluation.name = name;

    console.log(`Saving evaluation with name: ${name} to Supabase`);

    const insertData = {
        name: name,
        models: preparedEvaluation.models,
        questions: preparedEvaluation.questions,
        results: preparedEvaluation.results,
        created_at: preparedEvaluation.created_at,
        // updated_at will be set by DEFAULT now() in the database
        evaluate_automatically: preparedEvaluation.evaluate_automatically,
        user_id: preparedEvaluation.user_id
    };

    // Add user_id if it exists in the evaluation set
    if (evaluationSet.user_id) {
        insertData.user_id = evaluationSet.user_id;
        console.log(`User ID attached to evaluation: ${evaluationSet.user_id}`);
    } else {
        console.log(`WARNING: No user_id found in evaluation set. User association will not be saved.`);
        console.log(`Evaluation set contents: ${JSON.stringify({
            id: evaluationSet.id,
            name: evaluationSet.name || evaluationSet.setName,
            timestamp: evaluationSet.timestamp,
            // Don't log all content to avoid excessive logging
            hasUserID: !!evaluationSet.user_id
        })}`);
    }

    const { data, error } = await supabase
        .from("evaluations")
        .insert(insertData)
        .select("id")
        .single();

    if (error) {
        console.error(`Error inserting evaluation into Supabase:`, error);
        throw error;
    }
    console.log(`Successfully saved evaluation to Supabase with ID: ${data.id}`);
    return data.id;
};

// Fetch evaluation set by ID from Supabase
const getEvaluationSetByIdFromSupabase = async (req, res) => {
    const { id } = req.params;
    try {
        // Check if the ID looks like a UUID (standard UUID format check)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        
        // If it's not a UUID, check the local store instead
        if (!uuidRegex.test(id)) {
            console.log(`ID ${id} is not a UUID format - checking in-memory store`);
            
            // Try to get from in-memory store
            const localSet = evaluationsStore.get(id);
            
            if (localSet) {
                // Check if this evaluation has a Supabase ID
                if (localSet.supabaseId) {
                    console.log(`Found local evaluation with Supabase ID: ${localSet.supabaseId}`);
                    
                    // Try to get the record from Supabase using the stored supabaseId
                    const { data: supabaseData, error: supabaseError } = await supabase
                        .from("evaluations")
                        .select("*")
                        .eq("id", localSet.supabaseId)
                        .single();
                        
                    if (!supabaseError && supabaseData) {
                        return res.json(supabaseData);
                    }
                }
                
                // If we couldn't get from Supabase or there's no supabaseId, return the local data
                return res.json(localSet);
            }
            
            // Not found in either storage
            return res.status(404).json({ message: "Evaluation not found" });
        }
        
        // For UUID format, check Supabase directly
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
            // Add user_id if user is authenticated
            const userData = req.user ? { user_id: req.user.id } : {};

            // Make sure we capture the name properly
            const evalName = name && name.trim() !== "" ? name : "Unnamed Evaluation";
            console.log(`Creating evaluation set with name: ${evalName}`);

            evaluationSet = evaluationsStore.create({
                name: evalName,
                // Store the original selection object if needed, or just the names
                // For now, the frontend will reconstruct selection state if it needs to.
                ...userData
            });
        }
        
        const modelDisplayNames = {
            gpt4o: "GPT-4.1", 
            gpt41: "GPT-4.1",
            claude3: "Claude Sonnet 4",
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
                    model: getDisplayName(modelName),
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

// Manually evaluate a response
exports.manuallyEvaluateResponse = async (req, res) => {
    try {
        const { evaluationId, questionIndex, modelName, isCorrect, reasoning } = req.body;
        
        console.log(`[ManualEval] User ${req.user ? req.user.id : 'unknown'} is manually evaluating set ${evaluationId}, question ${questionIndex}, model ${modelName}`);
        
        // Validate required parameters
        if (!evaluationId || questionIndex === undefined || !modelName || isCorrect === undefined) {
            return res.status(400).json({
                error: "Missing required fields (evaluationId, questionIndex, modelName, isCorrect)"
            });
        }
        
        let evaluationSet = null;
        let storedInSupabase = false;
        
        // First check if the ID exists in Supabase
        const supabaseRecord = await checkEvaluationInSupabase(evaluationId);
        
        if (supabaseRecord) {
            console.log(`[ManualEval] Found evaluation in Supabase with ID: ${evaluationId}`);
            // This is a Supabase ID, fetch the full data
            const { data, error } = await supabase
                .from("evaluations")
                .select("*")
                .eq("id", evaluationId)
                .single();
                
            if (error) {
                console.error(`[ManualEval] Error fetching evaluation from Supabase: ${error.message}`);
                return res.status(500).json({
                    error: `Failed to retrieve evaluation data: ${error.message}`
                });
            }
            
            if (!data) {
                return res.status(404).json({
                    error: "Evaluation set not found in Supabase"
                });
            }
            
            evaluationSet = data;
            storedInSupabase = true;
        } else {
            // Try to load from in-memory store
            evaluationSet = evaluationsStore.get(evaluationId);
            
            if (!evaluationSet) {
                return res.status(404).json({
                    error: "Evaluation set not found in local store or Supabase"
                });
            }
            
            console.log(`[ManualEval] Found evaluation in local store with ID: ${evaluationId}`);
        }
        
        // Verify user is owner of the evaluation (if user auth is available)
        if (req.user && evaluationSet.user_id && req.user.id !== evaluationSet.user_id) {
            return res.status(403).json({
                error: "You are not authorized to evaluate this set"
            });
        }
        
        // Check if the question index is valid
        if (!evaluationSet.questions || !evaluationSet.questions[questionIndex]) {
            return res.status(404).json({
                error: "Question not found in evaluation set"
            });
        }
        
        // Find the model result to update
        const question = evaluationSet.questions[questionIndex];
        const modelResult = question.results.find(r => r.model === modelName);
        
        if (!modelResult) {
            return res.status(404).json({
                error: "Model result not found for this question"
            });
        }
        
        // Update the evaluation result
        modelResult.evaluation = {
            is_correct: isCorrect,
            reasoning: reasoning || "Manually evaluated by user.",
            evaluation_type: "manual",
            evaluated_by: req.user ? req.user.id : null,
            evaluated_at: new Date().toISOString()
        };
        
        // Always update the in-memory store
        evaluationsStore.items.set(evaluationId, evaluationSet);
        
        // Check if this ID has a UUID format (Supabase uses UUIDs)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const isUuidFormat = uuidRegex.test(evaluationId);
        
        // For non-UUID IDs, we should save to Supabase as a new record
        if (!isUuidFormat) {
            console.log(`[ManualEval] ID ${evaluationId} is not a UUID format - will create new record in Supabase`);
            try {
                // Create a new evaluation in Supabase
                console.log(`[ManualEval] Saving evaluation to Supabase as a new record...`);
                const supabaseId = await exports.saveEvaluationSetToSupabase(evaluationSet);
                console.log(`[ManualEval] Saved to Supabase with ID: ${supabaseId}`);
                
                // Update the in-memory store with the new Supabase ID
                evaluationSet.supabaseId = supabaseId;
                evaluationsStore.items.set(evaluationId, evaluationSet);
                
                // Continue with normal flow - no need to update Supabase again
                return res.json({
                    success: true,
                    evaluation: modelResult.evaluation,
                    supabaseId
                });
            } catch (error) {
                console.error(`[ManualEval] Error saving to Supabase: ${error.message}`);
                // Continue with response even if Supabase save fails
            }
        }
        
        // If it's from Supabase, update there directly
        if (storedInSupabase) {
            try {
                console.log(`[ManualEval] Saving changes directly to Supabase...`);
                
                // Prepare a clean evaluation object for Supabase
                const preparedEvaluation = prepareEvaluationForSupabase(evaluationSet);
                console.log(`[ManualEval] Updating Supabase record with ID: ${evaluationId}`);
                
                // Update the evaluation in Supabase - only update the questions array
                const { error: updateError } = await supabase
                    .from("evaluations")
                    .update({ 
                        questions: preparedEvaluation.questions,
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", evaluationId);
                    
                if (updateError) {
                    console.error(`[ManualEval] Error updating Supabase: ${updateError.message}`);
                    throw updateError;
                }
                
                console.log(`[ManualEval] Successfully updated evaluation in Supabase`);
            } catch (dbError) {
                console.error(`[ManualEval] Error updating Supabase: ${dbError.message}`);
                // Continue even if Supabase update fails
            }
        } else {
            // Otherwise, save to Supabase as a new record if no supabaseId exists
            try {
                if (!evaluationSet.supabaseId) {
                    console.log(`[ManualEval] Saving evaluation to Supabase as a new record...`);
                    const supabaseId = await exports.saveEvaluationSetToSupabase(evaluationSet);
                    console.log(`[ManualEval] Saved to Supabase with ID: ${supabaseId}`);
                    
                    // Update the in-memory store with the new Supabase ID
                    evaluationSet.supabaseId = supabaseId;
                    evaluationsStore.items.set(evaluationId, evaluationSet);
                } else {
                    // We have a supabaseId, try to update that record
                    console.log(`[ManualEval] Updating existing Supabase record with ID: ${evaluationSet.supabaseId}`);
                    
                    // Prepare a clean evaluation object for Supabase
                    const preparedEvaluation = prepareEvaluationForSupabase(evaluationSet);
                    console.log(`[ManualEval] Updating Supabase record with ID: ${evaluationSet.supabaseId}`);
                    
                    const { error: updateError } = await supabase
                        .from("evaluations")
                        .update({ 
                            questions: preparedEvaluation.questions,
                            updated_at: new Date().toISOString()
                        })
                        .eq("id", evaluationSet.supabaseId);
                        
                    if (updateError) {
                        console.error(`[ManualEval] Error updating Supabase: ${updateError.message}`);
                        throw updateError;
                    }
                    
                    console.log(`[ManualEval] Successfully updated existing Supabase record`);
                }
            } catch (dbError) {
                console.error(`[ManualEval] Error saving to Supabase: ${dbError.message}`);
                // Continue even if Supabase update fails
            }
        }
        
        return res.json({
            success: true,
            evaluation: modelResult.evaluation
        });
    } catch (error) {
        console.error('Error in manuallyEvaluateResponse endpoint:', error.message);
        return res.status(500).json({ error: error.message });
    }
};

// MVP endpoints
module.exports = {
    // Manually evaluate a response
    manuallyEvaluateResponse: exports.manuallyEvaluateResponse,
    
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

            // Add user_id if authenticated
            const userData = req.user ? { user_id: req.user.id } : {};

            const newSet = evaluationsStore.create({
                name,
                ...userData
            });

            return res.json(newSet);
        } catch (error) {
            console.error('Error in createEvaluationSet endpoint:', error.message);
            return res.status(500).json({ error: error.message });
        }
    },

    // Get all evaluation sets for the authenticated user
    getUserEvaluationSets: async (req, res) => {
        try {
            if (!req.user) {
                return res.status(401).json({ error: "Authentication required" });
            }

            console.log(`Getting evaluations for user: ${req.user.id}`);

            // Get pagination parameters from query
            const page = parseInt(req.query.page) || 1;
            const pageSize = parseInt(req.query.pageSize) || 10;
            const from = (page - 1) * pageSize;
            const to = from + pageSize - 1;

            console.log(`Pagination: page ${page}, pageSize ${pageSize}, range ${from}-${to}`);

            // Get count of total records first
            const { count, error: countError } = await supabase
                .from("evaluations")
                .select("*", { count: 'exact', head: true })
                .eq("user_id", req.user.id);

            if (countError) {
                console.error('Supabase count error:', countError);
                throw countError;
            }

            // Get paginated user evaluations directly from Supabase
            const { data, error } = await supabase
                .from("evaluations")
                .select("*")
                .eq("user_id", req.user.id)
                .order('created_at', { ascending: false })
                .range(from, to);

            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }

            console.log(`Found ${data.length} evaluations for user (page ${page} of ${Math.ceil(count/pageSize)})`);

            // Return data with pagination metadata
            return res.json({
                data: data,
                pagination: {
                    page,
                    pageSize,
                    total: count,
                    totalPages: Math.ceil(count/pageSize)
                }
            });
        } catch (error) {
            console.error('Error in getUserEvaluationSets endpoint:', error.message);
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
            
            // Check for the debug parameter to help diagnose Supabase issues
            const debug = req.query.debug === 'true';
            if (debug) {
                const supabaseRecord = await checkEvaluationInSupabase(id);
                const hasSupabaseRecord = !!supabaseRecord;
                
                // If we have both local and Supabase records, add debug info
                if (hasSupabaseRecord) {
                    // Get the full Supabase record for comparison
                    const { data, error } = await supabase
                        .from("evaluations")
                        .select("*")
                        .eq("id", id)
                        .single();
                    
                    if (!error && data) {
                        return res.json({
                            local: set,
                            supabase: data,
                            _debug: {
                                localQuestionCount: set.questions?.length || 0,
                                supabaseQuestionCount: data.questions?.length || 0,
                                supabaseId: set.supabaseId || null,
                                hasMatchingId: id === data.id
                            }
                        });
                    }
                }
                
                // If we only have local record, add that info
                return res.json({
                    local: set,
                    supabase: null,
                    _debug: {
                        inSupabase: hasSupabaseRecord,
                        supabaseId: set.supabaseId || null
                    }
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
            const { questions, models: modelNamesToEvaluate, systemMessage, setId, name, setName, evaluateAutomatically } = req.body; 
            
            // Prioritize setName over name for logging
            const displayName = setName || name || 'Unnamed';
            console.log(`[Eval] Starting evaluation: "${displayName}" (${questions.length} questions) for models: ${modelNamesToEvaluate.join(', ')}`);
            console.log(`[Eval] Automatic evaluation: ${evaluateAutomatically !== false ? 'enabled' : 'disabled'}`);
            
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
                // Make sure to include the user ID from the request when creating the set
                const userData = req.user && req.user.id ? { user_id: req.user.id } : {};
                console.log(`Creating new evaluation set${req.user ? ' for user ' + req.user.id : ' without user'}`);

                // Prioritize setName over name and log the actual name being used
                const evalName = setName || name || "Unnamed Evaluation";
                console.log(`Creating new evaluation set with name: "${evalName}"`);

                evaluationSet = evaluationsStore.create({
                    name: evalName,
                    setName: evalName, // Store in both fields for consistency
                    evaluate_automatically: evaluateAutomatically !== false, // Store evaluation preference
                    ...userData
                });
            }
            
            const modelDisplayNames = {
                gpt4o: "GPT-4.1", 
                gpt41: "GPT-4.1",
                claude3: "Claude Sonnet 4",
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
                    
                    // Only evaluate automatically if the flag is true (default)
                    if (evaluateAutomatically !== false) {
                        const evalStartTime = Date.now(); // Start timing for evaluation
                        const evaluationResult = await evaluateResponse(
                            question,
                            referenceAnswer,
                            responseContent
                        );
                        const evalEndTime = Date.now(); // End timing for evaluation
                        const evalTime = evalEndTime - evalStartTime;
                        
                        questionResultsArray.push({
                            model: getDisplayName(modelName),
                            response: responseContent,
                            evaluation: {
                                ...evaluationResult,
                                evaluation_type: "automatic",
                                evaluated_at: new Date().toISOString()
                            },
                            timings: {
                                responseTime: responseTime,
                                evaluationTime: evalTime,
                                totalTime: responseTime + evalTime,
                            }
                        });
                        console.log(`[Eval] ${modelName} response processed and evaluated in ${responseTime + evalTime}ms`);
                    } else {
                        // Skip evaluation, store null evaluation for manual assessment later
                        questionResultsArray.push({
                            model: getDisplayName(modelName),
                            response: responseContent,
                            evaluation: {
                                is_correct: null,
                                reasoning: null,
                                evaluation_type: "pending_manual",
                                evaluated_at: null,
                                evaluated_by: null
                            },
                            timings: {
                                responseTime: responseTime,
                                evaluationTime: 0,
                                totalTime: responseTime
                            }
                        });
                        console.log(`[Eval] ${modelName} response processed (pending manual evaluation) in ${responseTime}ms`);
                    }
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
            
            // Get the updated set from in-memory store
            const updatedSet = evaluationsStore.get(evaluationSet.id);
            console.log(`[Eval] Completed evaluation: ${updatedSet.name} (ID: ${updatedSet.id})`);

            try {
                // Save to Supabase for persistence
                console.log(`Saving evaluation to Supabase...`);

                // Make sure to include the user ID from the request if not already present
                if (req.user && req.user.id) {
                    if (!updatedSet.user_id) {
                        updatedSet.user_id = req.user.id;
                        console.log(`User ID from request added to set: ${req.user.id}`);
                    } else if (updatedSet.user_id !== req.user.id) {
                        console.log(`WARNING: User ID mismatch in evaluation set!`);
                        console.log(`Set has user_id ${updatedSet.user_id} but request has user_id ${req.user.id}`);
                        // We'll keep the original user_id to maintain data integrity
                    }
                } else {
                    console.log(`No user ID available from request`);
                }

                const supabaseId = await exports.saveEvaluationSetToSupabase(updatedSet);
                console.log(`Saved to Supabase with ID: ${supabaseId}`);

                // Update the ID if it came from Supabase
                updatedSet.supabaseId = supabaseId;
            } catch (supabaseError) {
                console.error('Error saving to Supabase:', supabaseError.message);
                // Continue with the response even if Supabase save fails
            }

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
