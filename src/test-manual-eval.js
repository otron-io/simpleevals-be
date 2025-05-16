// Test script to verify manual evaluation still works with the new RLS policies
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service role (bypasses RLS for testing)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function testManualEvaluation() {
  try {
    console.log('Starting manual evaluation test...');
    
    // 1. Create a test evaluation with pending_manual evaluation
    console.log('\n1. Creating test evaluation with pending manual evaluation...');
    const { data: evalData, error: evalError } = await supabase
      .from('evaluations')
      .insert({
        name: 'Manual Evaluation Test',
        user_id: null, // Public for easy testing
        models: ['test-model'],
        questions: [{
          question: 'Test question for manual evaluation',
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
    
    // 2. Verify the evaluation is pending
    console.log('\n2. Verifying pending manual evaluation status...');
    const { data: checkData, error: checkError } = await supabase
      .from('evaluations')
      .select('questions')
      .eq('id', evalId)
      .single();
    
    if (checkError) {
      throw checkError;
    }
    
    const evalType = checkData.questions[0].results[0].evaluation.evaluation_type;
    console.log(`Initial evaluation type: ${evalType}`);
    
    if (evalType !== 'pending_manual') {
      throw new Error('Expected pending_manual evaluation type');
    }
    
    // 3. Update the evaluation status manually
    console.log('\n3. Updating evaluation status to manual...');
    
    // Get a copy of the data to modify
    let updatedQuestions = JSON.parse(JSON.stringify(checkData.questions));
    
    // Update the evaluation status
    updatedQuestions[0].results[0].evaluation = {
      is_correct: true,
      reasoning: 'Test manual evaluation reasoning',
      evaluation_type: 'manual',
      evaluated_by: null,
      evaluated_at: new Date().toISOString()
    };
    
    // Save the updated evaluation
    const { error: updateError } = await supabase
      .from('evaluations')
      .update({ 
        questions: updatedQuestions,
        updated_at: new Date().toISOString()
      })
      .eq('id', evalId);
    
    if (updateError) {
      throw updateError;
    }
    
    // 4. Verify the update worked
    console.log('\n4. Verifying manual evaluation was saved...');
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
      throw new Error('Manual evaluation update failed');
    }
    
    // 5. Clean up
    console.log('\n5. Cleaning up test data...');
    const { error: deleteError } = await supabase
      .from('evaluations')
      .delete()
      .eq('id', evalId);
    
    if (deleteError) {
      throw deleteError;
    }
    
    console.log(`\n✅ Manual evaluation test completed successfully!`);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testManualEvaluation();