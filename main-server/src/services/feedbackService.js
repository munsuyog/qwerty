// ===============================================
// FEEDBACK SERVICE (src/services/feedbackService.js)
// ===============================================

const { getDB, connectDB } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class FeedbackService {
  constructor() {
    this.db = null;
  }

  async initialize() {
    if (!this.db) {
      await connectDB();
      this.db = getDB();
    }
    await this.createIndexes();
  }

  async createIndexes() {
    try {
      const collection = this.db.collection('Feedback');

      // Create indexes for better query performance
      await collection.createIndex({ status: 1 });
      await collection.createIndex({ createdAt: -1 });
      await collection.createIndex({ 'codes.namaste': 1 });
      await collection.createIndex({ 'codes.icd11': 1 });
      await collection.createIndex({ email: 1 });

      logger.info('Feedback collection indexes created');
    } catch (error) {
      logger.error('Failed to create feedback indexes:', error);
    }
  }

  async submitFeedback(feedbackData) {
    try {
      const feedback = {
        id: uuidv4(),
        resourceType: 'Feedback',
        name: feedbackData.name,
        email: feedbackData.email,
        codes: {
          namaste: feedbackData.namasteCode || null,
          icd11: feedbackData.icd11Code || null,
        },
        query: feedbackData.query,
        status: 'open',
        priority: this.calculatePriority(feedbackData),
        category: this.categorizeQuery(feedbackData.query),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
        response: null,
        metadata: {
          ipAddress: feedbackData.ipAddress,
          userAgent: feedbackData.userAgent,
          source: 'web-form',
        },
      };

      await this.db.collection('Feedback').insertOne(feedback);

      logger.info('Feedback submitted successfully', {
        feedbackId: feedback.id,
        category: feedback.category,
        priority: feedback.priority,
      });

      return {
        success: true,
        feedbackId: feedback.id,
        message: 'Feedback submitted successfully',
      };
    } catch (error) {
      logger.error('Failed to submit feedback:', error);
      throw error;
    }
  }

  async getAllFeedback(filters = {}) {
    try {
      const query = {};

      // Apply filters
      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.category) {
        query.category = filters.category;
      }

      if (filters.priority) {
        query.priority = filters.priority;
      }

      if (filters.dateFrom) {
        query.createdAt = { $gte: filters.dateFrom };
      }

      if (filters.dateTo) {
        query.createdAt = { ...query.createdAt, $lte: filters.dateTo };
      }

      const feedbacks = await this.db
        .collection('Feedback')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(filters.limit || 100)
        .skip(filters.offset || 0)
        .toArray();

      const total = await this.db.collection('Feedback').countDocuments(query);

      return {
        feedbacks,
        total,
        filters,
      };
    } catch (error) {
      logger.error('Failed to get feedback list:', error);
      throw error;
    }
  }

  async getFeedbackById(id) {
    try {
      const feedback = await this.db.collection('Feedback').findOne({ id });

      if (!feedback) {
        return null;
      }

      return feedback;
    } catch (error) {
      logger.error('Failed to get feedback by ID:', error);
      throw error;
    }
  }

  async markAsResolved(id, resolvedBy, response = null) {
    try {
      const updateData = {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy,
        updatedAt: new Date().toISOString(),
      };

      if (response) {
        updateData.response = response;
      }

      const result = await this.db.collection('Feedback').updateOne({ id }, { $set: updateData });

      if (result.matchedCount === 0) {
        return { success: false, message: 'Feedback not found' };
      }

      logger.info('Feedback marked as resolved', {
        feedbackId: id,
        resolvedBy,
      });

      return { success: true, message: 'Feedback marked as resolved' };
    } catch (error) {
      logger.error('Failed to mark feedback as resolved:', error);
      throw error;
    }
  }

  async updateFeedbackStatus(id, status, updatedBy) {
    try {
      const validStatuses = ['open', 'in-progress', 'resolved', 'closed'];

      if (!validStatuses.includes(status)) {
        return { success: false, message: 'Invalid status' };
      }

      const updateData = {
        status,
        updatedAt: new Date().toISOString(),
      };

      if (status === 'resolved' || status === 'closed') {
        updateData.resolvedAt = new Date().toISOString();
        updateData.resolvedBy = updatedBy;
      }

      const result = await this.db.collection('Feedback').updateOne({ id }, { $set: updateData });

      if (result.matchedCount === 0) {
        return { success: false, message: 'Feedback not found' };
      }

      logger.info('Feedback status updated', {
        feedbackId: id,
        status,
        updatedBy,
      });

      return { success: true, message: 'Feedback status updated' };
    } catch (error) {
      logger.error('Failed to update feedback status:', error);
      throw error;
    }
  }

  async addResponse(id, response, respondedBy) {
    try {
      const updateData = {
        response,
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: respondedBy,
        updatedAt: new Date().toISOString(),
      };

      const result = await this.db.collection('Feedback').updateOne({ id }, { $set: updateData });

      if (result.matchedCount === 0) {
        return { success: false, message: 'Feedback not found' };
      }

      logger.info('Response added to feedback', {
        feedbackId: id,
        respondedBy,
      });

      return { success: true, message: 'Response added successfully' };
    } catch (error) {
      logger.error('Failed to add response to feedback:', error);
      throw error;
    }
  }

  async getFeedbackStats() {
    try {
      const [totalCount, openCount, resolvedCount, inProgressCount, categoryStats, priorityStats] =
        await Promise.all([
          this.db.collection('Feedback').countDocuments(),
          this.db.collection('Feedback').countDocuments({ status: 'open' }),
          this.db.collection('Feedback').countDocuments({ status: 'resolved' }),
          this.db.collection('Feedback').countDocuments({ status: 'in-progress' }),
          this.db
            .collection('Feedback')
            .aggregate([
              { $group: { _id: '$category', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ])
            .toArray(),
          this.db
            .collection('Feedback')
            .aggregate([
              { $group: { _id: '$priority', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ])
            .toArray(),
        ]);

      return {
        total: totalCount,
        byStatus: {
          open: openCount,
          resolved: resolvedCount,
          inProgress: inProgressCount,
          closed: totalCount - openCount - resolvedCount - inProgressCount,
        },
        byCategory: categoryStats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        byPriority: priorityStats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
      };
    } catch (error) {
      logger.error('Failed to get feedback stats:', error);
      throw error;
    }
  }

  calculatePriority(feedbackData) {
    const query = feedbackData.query.toLowerCase();

    // High priority keywords
    if (query.includes('urgent') || query.includes('critical') || query.includes('error')) {
      return 'high';
    }

    // Medium priority if codes are provided (mapping issues)
    if (feedbackData.namasteCode || feedbackData.icd11Code) {
      return 'medium';
    }

    return 'low';
  }

  categorizeQuery(query) {
    const lowerQuery = query.toLowerCase();

    if (
      lowerQuery.includes('map') ||
      lowerQuery.includes('translation') ||
      lowerQuery.includes('convert')
    ) {
      return 'mapping';
    }

    if (
      lowerQuery.includes('search') ||
      lowerQuery.includes('find') ||
      lowerQuery.includes('lookup')
    ) {
      return 'search';
    }

    if (
      lowerQuery.includes('error') ||
      lowerQuery.includes('bug') ||
      lowerQuery.includes('issue')
    ) {
      return 'bug';
    }

    if (
      lowerQuery.includes('feature') ||
      lowerQuery.includes('enhancement') ||
      lowerQuery.includes('improve')
    ) {
      return 'feature-request';
    }

    if (
      lowerQuery.includes('api') ||
      lowerQuery.includes('integration') ||
      lowerQuery.includes('endpoint')
    ) {
      return 'api';
    }

    return 'general';
  }
}

module.exports = FeedbackService;
