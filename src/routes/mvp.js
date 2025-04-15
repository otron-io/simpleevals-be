const express = require('express');
const router = express.Router();
const mvpController = require('../controllers/mvpController');

// GET /api/mvp/demo - Demo endpoint
router.get('/demo', (req, res) => {
  res.json({
    message: 'SimpleEvals MVP API Demo',
    endpoints: [
      { method: 'POST', path: '/api/mvp/evaluate', description: 'Evaluate a single question' },
      { method: 'POST', path: '/api/mvp/evaluate-set', description: 'Evaluate multiple questions in batch' },
      { method: 'GET', path: '/api/mvp/sets', description: 'Get all evaluation sets' },
      { method: 'GET', path: '/api/mvp/sets/:id', description: 'Get a specific evaluation set' },
      { method: 'GET', path: '/api/mvp/share/:id', description: 'Get a shareable evaluation set' }
    ],
    timestamp: new Date().toISOString()
  });
});

// POST /api/mvp/evaluate - Evaluate a single question
router.post('/evaluate', mvpController.evaluateModels);

// POST /api/mvp/evaluate-set - Evaluate multiple questions in batch
router.post('/evaluate-set', mvpController.evaluateSet);

// GET /api/mvp/sets - Get all evaluation sets
router.get('/sets', mvpController.getAllEvaluationSets);

// GET /api/mvp/sets/:id - Get a specific evaluation set
router.get('/sets/:id', mvpController.getEvaluationSet);

// Fetch evaluation set by ID for sharing
router.get('/share/:id', mvpController.getEvaluationSetById);

module.exports = router; 