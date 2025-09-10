
// ===============================================
// RATE LIMITING MIDDLEWARE (src/middleware/rateLimit.js)
// ===============================================

const rateLimit = require('express-rate-limit');
const { getRedis } = require('../config/database');
const logger = require('../utils/logger');

// Custom rate limit store using Redis
class RedisStore {
    constructor(options = {}) {
        this.prefix = options.prefix || 'rate-limit:';
        this.resetExpiryOnChange = options.resetExpiryOnChange || false;
    }

    async increment(key) {
        const redis = getRedis();
        const prefixedKey = this.prefix + key;
        
        try {
            const current = await redis.incr(prefixedKey);
            let ttl;
            
            if (current === 1) {
                // First request, set expiry
                ttl = await redis.expire(prefixedKey, 900); // 15 minutes
            } else {
                ttl = await redis.ttl(prefixedKey);
            }
            
            return {
                totalHits: current,
                resetTime: new Date(Date.now() + (ttl * 1000))
            };
        } catch (error) {
            logger.error('Redis rate limit error:', error);
            // Fallback: allow request if Redis fails
            return {
                totalHits: 1,
                resetTime: new Date(Date.now() + 900000)
            };
        }
    }

    async decrement(key) {
        const redis = getRedis();
        const prefixedKey = this.prefix + key;
        
        try {
            await redis.decr(prefixedKey);
        } catch (error) {
            logger.error('Redis rate limit decrement error:', error);
        }
    }

    async resetKey(key) {
        const redis = getRedis();
        const prefixedKey = this.prefix + key;
        
        try {
            await redis.del(prefixedKey);
        } catch (error) {
            logger.error('Redis rate limit reset error:', error);
        }
    }
}

const createRateLimiter = (options = {}) => {
    const {
        windowMs = 15 * 60 * 1000, // 15 minutes
        max = 1000, // requests per window
        message = 'Too many requests',
        skipSuccessfulRequests = false,
        skipFailedRequests = false,
        keyGenerator = null
    } = options;

    return rateLimit({
        windowMs,
        max,
        message: {
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'throttled',
                details: { 
                    text: message,
                    coding: [{
                        system: 'http://terminology.hl7.org/CodeSystem/operation-outcome',
                        code: 'MSG_RATE_LIMIT'
                    }]
                }
            }]
        },
        standardHeaders: true,
        legacyHeaders: false,
        store: new RedisStore(),
        skipSuccessfulRequests,
        skipFailedRequests,
        keyGenerator: keyGenerator || ((req) => {
            // Use user ID if authenticated, otherwise IP
            return req.auditContext?.userId || req.ip;
        }),
        skip: (req) => {
            // Skip rate limiting for health checks
            return req.path.includes('/health');
        },
        onLimitReached: (req, res, options) => {
            logger.warn(`Rate limit exceeded for ${req.ip}`, {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                path: req.path,
                userId: req.auditContext?.userId
            });
        }
    });
};

// Different rate limiters for different endpoints
const generalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 minutes
    message: 'Too many requests from this IP'
});

const searchLimiter = createRateLimiter({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 searches per minute
    message: 'Too many search requests. Please slow down.'
});

const adminLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 admin requests per 15 minutes
    message: 'Too many admin requests'
});

const bundleLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 bundle submissions per 5 minutes
    message: 'Too many bundle submissions. Please wait before submitting more data.',
    skipSuccessfulRequests: true // Don't count successful submissions
});

// Authentication attempt limiter
const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 failed attempts per 15 minutes
    message: 'Too many authentication attempts. Please try again later.',
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
        // Use IP + user agent for auth attempts
        return `${req.ip}:${req.get('User-Agent')}`;
    }
});

module.exports = {
    generalLimiter,
    searchLimiter,
    adminLimiter,
    bundleLimiter,
    authLimiter,
    createRateLimiter,
    RedisStore
};
