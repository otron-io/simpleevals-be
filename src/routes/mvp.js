const express = require('express');
const router = express.Router();
const mvpController = require('../controllers/mvpController');

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