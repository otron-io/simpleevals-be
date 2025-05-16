// Integration test for the manual evaluation feature
const assert = require('assert');
const request = require('supertest');
const app = require('../../src/index.js'); // Adjust path if needed

describe('Manual Evaluation Feature', function() {
  this.timeout(10000); // Increase timeout for API operations
  
  let evaluationSetId;
  let authToken;
  
  before(async function() {
    // This function would normally authenticate a user
    // Since we're testing without a real auth system, we'll skip this
    // and rely on the controller to handle unauthenticated users
    authToken = 'test-token';
  });
  
  it('should create an evaluation set with automatic evaluation disabled', async function() {
    const response = await request(app)
      .post('/api/mvp/evaluate-set')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        questions: [
          {
            question: 'What is 2+2?',
            referenceAnswer: '4'
          }
        ],
        models: ['gpt41'],
        setName: 'Manual Evaluation Test',
        evaluateAutomatically: false
      });
    
    assert.strictEqual(response.status, 200);
    assert.ok(response.body.id, 'Response should include an evaluation set ID');
    assert.strictEqual(response.body.evaluate_automatically, false, 'Automatic evaluation should be disabled');
    
    // Store the evaluation set ID for later use
    evaluationSetId = response.body.id;
    
    // Check that the first question's result has pending_manual status
    const firstQuestion = response.body.questions[0];
    assert.ok(firstQuestion, 'Response should include questions');
    assert.ok(firstQuestion.results, 'Question should include results');
    assert.ok(firstQuestion.results.length > 0, 'Question should have at least one result');
    
    const firstResult = firstQuestion.results[0];
    assert.strictEqual(firstResult.evaluation.evaluation_type, 'pending_manual', 'Result should be pending manual evaluation');
    assert.strictEqual(firstResult.evaluation.is_correct, null, 'is_correct should be null for pending evaluations');
  });
  
  it('should allow manual evaluation of a response', async function() {
    // Skip test if no evaluation set ID from previous test
    if (!evaluationSetId) {
      this.skip();
      return;
    }
    
    const response = await request(app)
      .post(`/api/mvp/sets/${evaluationSetId}/evaluate`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        evaluationId: evaluationSetId,
        questionIndex: 0,
        modelName: 'GPT-4.1', // Use display name from the controller
        isCorrect: true,
        reasoning: 'This answer is correct because 2+2=4.'
      });
    
    assert.strictEqual(response.status, 200);
    assert.ok(response.body.success, 'Response should indicate success');
    assert.ok(response.body.evaluation, 'Response should include evaluation data');
    assert.strictEqual(response.body.evaluation.evaluation_type, 'manual', 'Evaluation type should be manual');
    assert.strictEqual(response.body.evaluation.is_correct, true, 'is_correct should match what we sent');
    assert.strictEqual(
      response.body.evaluation.reasoning,
      'This answer is correct because 2+2=4.',
      'Reasoning should match what we sent'
    );
  });
  
  it('should retrieve the evaluation set with updated manual evaluations', async function() {
    // Skip test if no evaluation set ID from previous test
    if (!evaluationSetId) {
      this.skip();
      return;
    }
    
    const response = await request(app)
      .get(`/api/mvp/sets/${evaluationSetId}`)
      .set('Authorization', `Bearer ${authToken}`);
    
    assert.strictEqual(response.status, 200);
    
    // Check that the evaluation has been updated
    const firstQuestion = response.body.questions[0];
    const firstResult = firstQuestion.results[0];
    
    assert.strictEqual(firstResult.evaluation.evaluation_type, 'manual', 'Evaluation type should be manual');
    assert.strictEqual(firstResult.evaluation.is_correct, true, 'is_correct should be true');
    assert.strictEqual(
      firstResult.evaluation.reasoning,
      'This answer is correct because 2+2=4.',
      'Reasoning should match what we sent'
    );
  });
});