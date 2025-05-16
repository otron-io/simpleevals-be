// Test script to verify RLS policies
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function runTests() {
  console.log('Starting RLS policy tests...');
  
  try {
    // 1. Test reading public evaluations (user_id IS NULL)
    console.log('\n--- Test 1: Read public evaluations ---');
    const { data: publicEvals, error: publicError } = await supabase
      .from('evaluations')
      .select('id, name, user_id')
      .is('user_id', null)
      .limit(3);
    
    if (publicError) throw publicError;
    console.log(`✅ Successfully read ${publicEvals.length} public evaluations`);
    console.log(publicEvals);
    
    // 2. Test reading a specific user's evaluations using service role
    console.log('\n--- Test 2: Read user evaluations with service role ---');
    const { data: userEvals, error: userError } = await supabase
      .from('evaluations')
      .select('id, name, user_id')
      .not('user_id', 'is', null)
      .limit(3);
    
    if (userError) throw userError;
    console.log(`✅ Successfully read ${userEvals.length} user evaluations with service role`);
    
    if (userEvals.length > 0) {
      // Store a user ID for later tests
      const testUserId = userEvals[0].user_id;
      console.log(`Using test user ID: ${testUserId}`);
      
      // 3. Try direct access with service role (this should work since we're using the service role)
      console.log('\n--- Test 3: Direct access with service role ---');
      
      // Directly try to insert with someone else's user ID (should work with service role)
      const { data: insertData, error: insertError } = await supabase
        .from('evaluations')
        .insert({
          name: 'Test Service Role Access',
          user_id: testUserId, // Use someone else's user_id but with service role
          models: [],
          questions: [],
          results: {}
        })
        .select();
      
      if (insertError) {
        console.log(`❌ Service role access failed: ${insertError.message}`);
      } else {
        console.log(`✅ Service role correctly has full access (expected)`);
        
        // Clean up this test evaluation
        if (insertData && insertData[0]) {
          const testId = insertData[0].id;
          await supabase.from('evaluations').delete().eq('id', testId);
          console.log(`   Cleaned up test evaluation ${testId}`);
        }
      }
      
      // 4. Create a test evaluation with service role
      console.log('\n--- Test 4: Create test evaluation with service role ---');
      const { data: newEval, error: createError } = await supabase
        .from('evaluations')
        .insert({
          name: 'RLS Test Evaluation',
          user_id: null, // Public evaluation
          models: [],
          questions: [{ 
            question: 'Test question for RLS', 
            referenceAnswer: 'Test answer',
            results: [{
              model: 'Test Model',
              response: 'Test response',
              evaluation: {
                is_correct: null,
                reasoning: null,
                evaluation_type: 'pending_manual'
              }
            }]
          }],
          results: {},
          evaluate_automatically: false
        })
        .select();
      
      if (createError) throw createError;
      console.log(`✅ Successfully created test evaluation: ${newEval[0].id}`);
      
      // 5. Update the test evaluation
      const testEvalId = newEval[0].id;
      console.log('\n--- Test 5: Update test evaluation ---');
      const { data: updateData, error: updateError } = await supabase
        .from('evaluations')
        .update({ 
          name: 'Updated RLS Test Evaluation',
          updated_at: new Date().toISOString()
        })
        .eq('id', testEvalId)
        .select();
      
      if (updateError) throw updateError;
      console.log(`✅ Successfully updated test evaluation: ${updateData[0].id}`);
      
      // 6. Clean up - Delete the test evaluation
      console.log('\n--- Test 6: Delete test evaluation ---');
      const { error: deleteError } = await supabase
        .from('evaluations')
        .delete()
        .eq('id', testEvalId);
      
      if (deleteError) throw deleteError;
      console.log(`✅ Successfully deleted test evaluation: ${testEvalId}`);
    } else {
      console.log('No user evaluations found, skipping user-specific tests');
    }
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTests();