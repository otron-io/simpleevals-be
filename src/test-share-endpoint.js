const fetch = require('node-fetch');

const sampleEvaluationSet = {
  name: 'Test Evaluation',
  models: ['gpt4o', 'claude3', 'gemini'],
  questions: [
    {
      question: 'What is the best way to relax?',
      referenceAnswer: 'Reading a book in a quiet room is the ultimate way to unwind.',
      results: [
        { model: 'GPT-4o', response: 'Take a walk in nature.', evaluation: { is_correct: false, reasoning: 'Different method than reference.' } },
        { model: 'Claude 3.7', response: 'Reading a book in a quiet room is the ultimate way to unwind.', evaluation: { is_correct: true, reasoning: 'Matches reference answer.' } },
        { model: 'Gemini 2.5', response: 'Meditation is best.', evaluation: { is_correct: false, reasoning: 'Does not match reference.' } }
      ],
      timestamp: new Date().toISOString()
    }
  ],
  results: { summary: 'Test summary' },
  timestamp: new Date().toISOString()
};

async function testShare() {
  const response = await fetch('http://localhost:3001/api/mvp/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evaluationSet: sampleEvaluationSet })
  });
  const data = await response.json();
  console.log('Share endpoint response:', data);
}

testShare(); 