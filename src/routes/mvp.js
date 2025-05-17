const express = require('express');
const router = express.Router();
const mvpController = require('../controllers/mvpController');
const { AVAILABLE_MODELS } = require("../lib/models");
const { verifyAuth, requireAuth } = require('../middleware/auth');

// GET /api/mvp/demo - Demo endpoint
router.get('/demo', (req, res) => {
  res.json({
    message: 'SimpleEvals MVP API Demo',
    endpoints: [
      // { method: 'POST', path: '/api/mvp/evaluate', description: 'Evaluate a single question (currently under review)' },
      { method: 'POST', path: '/api/mvp/evaluate-set', description: 'Evaluate multiple questions in batch' },
        { method: 'GET', path: '/api/mvp/models', description: 'List available models' },
      { method: 'GET', path: '/api/mvp/sets', description: 'Get all evaluation sets (in-memory)' },
      { method: 'GET', path: '/api/mvp/sets/:id', description: 'Get a specific evaluation set (in-memory)' },
      { method: 'GET', path: '/api/mvp/share/:id', description: 'Get a shareable evaluation set (from Supabase)' }
    ],
    timestamp: new Date().toISOString()
  });
});
router.get("/models", (req, res) => { res.json(AVAILABLE_MODELS); });

// POST /api/mvp/evaluate - Evaluate a single question
// router.post('/evaluate', mvpController.evaluateModels); // evaluateModels is not in the new module.exports, functionality covered by evaluateSet or evaluateResponse

// POST /api/mvp/evaluate-set - Evaluate multiple questions in batch
router.post('/evaluate-set', verifyAuth, mvpController.evaluateSet);

// GET /api/mvp/sets - Get all evaluation sets (from in-memory store)
// Currently available to all, but we track the user if authenticated
router.get('/sets', verifyAuth, mvpController.getEvaluationSets);

// GET /api/mvp/sets/:id - Get a specific evaluation set (from in-memory store)
router.get('/sets/:id', verifyAuth, mvpController.getEvaluationSet);

// GET /api/mvp/user/sets - Get evaluation sets for the authenticated user
router.get('/user/sets', requireAuth, mvpController.getUserEvaluationSets);

// GET /api/mvp/share/:id - Fetch evaluation set by ID for sharing (from Supabase)
router.get('/share/:id', mvpController.getSharedEvaluationSet); // Was getEvaluationSetById, now uses the integrated Supabase function

// POST /api/mvp/sets/:id/evaluate - Manually evaluate a response
router.post('/sets/:id/evaluate', requireAuth, mvpController.manuallyEvaluateResponse);

module.exports = router; 