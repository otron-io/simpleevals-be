// Test script to verify manual evaluation API still works with the new RLS policies
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const request = require('supertest');
const app = require('./index');

// Initialize Supabase client with service role (bypasses RLS for testing)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function testManualEvaluationAPI() {
  try {
    console.log('Starting manual evaluation API test...');
    
    // 1. Create a test evaluation with pending_manual evaluation
    console.log('\n1. Creating test evaluation with pending manual evaluation...');
    const { data: evalData, error: evalError } = await supabase
      .from('evaluations')
      .insert({
        name: 'Manual Evaluation API Test',
        user_id: null, // Public for easy testing
        models: ['test-model'],
        questions: [{
          question: 'Test question for manual evaluation API',
          referenceAnswer: 'Test reference answer',
          results: [{
            model: 'Test Model',
            response: 'Test response content',
            evaluation: {
              is_correct: null,
              reasoning: null,
              evaluation_type: 'pending_manual'
            },
            timings: {
              responseTime: 100,
              evaluationTime: 0,
              totalTime: 100
            }
          }]
        }],
        results: {},
        evaluate_automatically: false
      })
      .select();
    
    if (evalError) {
      throw evalError;
    }
    
    console.log(`Created test evaluation with ID: ${evalData[0].id}`);
    const evalId = evalData[0].id;
    
    // Simulate API request to manually evaluate
    console.log('\n2. Making API request to manually evaluate...');
    const response = await request(app)
      .post(`/api/mvp/sets/${evalId}/evaluate`)
      .send({
        evaluationId: evalId,
        questionIndex: 0,
        modelName: 'Test Model',
        isCorrect: true,
        reasoning: 'API test manual evaluation'
      });
    
    console.log(`Response status: ${response.status}`);
    console.log('Response body:', response.body);
    
    if (response.status !== 200) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    
    // 3. Verify the evaluation was updated in the database
    console.log('\n3. Verifying manual evaluation was saved in database...');
    const { data: finalData, error: finalError } = await supabase
      .from('evaluations')
      .select('questions')
      .eq('id', evalId)
      .single();
    
    if (finalError) {
      throw finalError;
    }
    
    const finalEvalType = finalData.questions[0].results[0].evaluation.evaluation_type;
    const isCorrect = finalData.questions[0].results[0].evaluation.is_correct;
    
    console.log(`Final evaluation type: ${finalEvalType}`);
    console.log(`Is correct: ${isCorrect}`);
    
    if (finalEvalType !== 'manual' || isCorrect !== true) {
      throw new Error('Manual evaluation API update failed to persist to database');
    }
    
    // 4. Clean up
    console.log('\n4. Cleaning up test data...');
    const { error: deleteError } = await supabase
      .from('evaluations')
      .delete()
      .eq('id', evalId);
    
    if (deleteError) {
      throw deleteError;
    }
    
    console.log(`\n✅ Manual evaluation API test completed successfully!`);
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Make sure we exit since the app might be keeping the process alive
    process.exit(0);
  }
}

testManualEvaluationAPI();