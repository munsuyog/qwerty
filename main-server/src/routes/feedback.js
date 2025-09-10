// ===============================================
// FEEDBACK ROUTES (src/routes/feedbackRoutes.js)
// ===============================================

const express = require('express');
const router = express.Router();
const FeedbackService = require('../services/feedbackService');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Rate limiting for feedback submission
const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 feedback submissions per windowMs
  message: 'Too many feedback submissions, please try again later.',
});

// Initialize feedback service
const feedbackService = new FeedbackService();
feedbackService.initialize();

// Validation middleware
const validateFeedback = [
  body('name').notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Valid email is required'),
  body('query').notEmpty().withMessage('Query/feedback is required').isLength({ max: 2000 }),
  body('namasteCode').optional().isLength({ max: 50 }),
  body('icd11Code').optional().isLength({ max: 50 }),
];

const validateFeedbackFilters = [
  query('status').optional().isIn(['open', 'in-progress', 'resolved', 'closed']),
  query('category').optional().isIn(['mapping', 'search', 'bug', 'feature-request', 'api', 'general']),
  query('priority').optional().isIn(['low', 'medium', 'high']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
];

// Submit feedback
router.post('/', feedbackLimiter, validateFeedback, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const feedbackData = {
      ...req.body,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    };

    const result = await feedbackService.submitFeedback(feedbackData);

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback',
      error: error.message,
    });
  }
});

// Get all feedback (admin endpoint)
router.get('/', validateFeedbackFilters, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filters',
        errors: errors.array(),
      });
    }

    const filters = {
      status: req.query.status,
      category: req.query.category,
      priority: req.query.priority,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
    };

    const result = await feedbackService.getAllFeedback(filters);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get feedback',
      error: error.message,
    });
  }
});

// Get feedback by ID
router.get('/:id', async (req, res) => {
  try {
    const feedback = await feedbackService.getFeedbackById(req.params.id);

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found',
      });
    }

    res.json({
      success: true,
      feedback,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get feedback',
      error: error.message,
    });
  }
});

// Mark feedback as resolved
router.patch('/:id/resolve', async (req, res) => {
  try {
    const { resolvedBy, response } = req.body;

    if (!resolvedBy) {
      return res.status(400).json({
        success: false,
        message: 'resolvedBy is required',
      });
    }

    const result = await feedbackService.markAsResolved(
      req.params.id,
      resolvedBy,
      response
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to resolve feedback',
      error: error.message,
    });
  }
});

// Update feedback status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, updatedBy } = req.body;

    if (!status || !updatedBy) {
      return res.status(400).json({
        success: false,
        message: 'status and updatedBy are required',
      });
    }

    const result = await feedbackService.updateFeedbackStatus(
      req.params.id,
      status,
      updatedBy
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: error.message,
    });
  }
});

// Add response to feedback
router.post('/:id/response', async (req, res) => {
  try {
    const { response, respondedBy } = req.body;

    if (!response || !respondedBy) {
      return res.status(400).json({
        success: false,
        message: 'response and respondedBy are required',
      });
    }

    const result = await feedbackService.addResponse(
      req.params.id,
      response,
      respondedBy
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add response',
      error: error.message,
    });
  }
});

// Get feedback statistics
router.get('/admin/stats', async (req, res) => {
  try {
    const stats = await feedbackService.getFeedbackStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get feedback stats',
      error: error.message,
    });
  }
});

module.exports = router;