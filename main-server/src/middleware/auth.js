const jwt = require('jsonwebtoken');
const axios = require('axios');
const logger = require('../utils/logger');
const { getRedis } = require('../config/database');

class AuthenticationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthenticationError';
        this.statusCode = 401;
    }
}

const authMiddleware = async (req, res, next) => {
    try {
        // Skip authentication in development mode for GET requests
        if (process.env.NODE_ENV === 'development' && req.method === 'GET') {
            req.user = {
                sub: 'dev-user',
                healthId: '91-1234-5678-9012',
                name: 'Development User',
                userType: 'admin',
                facilityId: 'dev-facility'
            };
            req.auditContext = {
                userId: 'dev-user',
                userName: 'Development User',
                userType: 'admin',
                facilityId: 'dev-facility'
            };
            return next();
        }

        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            throw new AuthenticationError('Missing authorization token');
        }

        // Validate ABHA token
        const user = await validateABHAToken(token);
        req.user = user;
        req.token = token;

        // Add user info to audit context
        req.auditContext = {
            userId: user.sub || user.healthId,
            userName: user.name,
            userType: user.userType || 'practitioner',
            facilityId: user.facilityId
        };

        next();

    } catch (error) {
        logger.warn('Authentication failed:', error.message);
        
        const operationOutcome = {
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'login',
                details: {
                    text: error.message || 'Authentication failed'
                }
            }]
        };

        res.status(error.statusCode || 401).json(operationOutcome);
    }
};

const validateABHAToken = async (token) => {
    const redis = getRedis();
    const cacheKey = `abha-token:${token}`;
    
    try {
        // Check cache first
        const cachedUser = await redis.get(cacheKey);
        if (cachedUser) {
            return JSON.parse(cachedUser);
        }

        // Validate with ABHA service
        let user;
        
        if (process.env.NODE_ENV === 'development') {
            // Mock validation for development
            user = validateMockToken(token);
        } else {
            // Real ABHA validation
            user = await validateRealABHAToken(token);
        }

        // Cache for 1 hour
        await redis.setEx(cacheKey, 3600, JSON.stringify(user));
        
        return user;

    } catch (error) {
        logger.error('ABHA token validation failed:', error);
        throw new AuthenticationError('Invalid ABHA token');
    }
};

const validateMockToken = (token) => {
    try {
        // For development - simple JWT validation
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
        return {
            sub: decoded.sub || 'test-user',
            healthId: decoded.healthId || '91-1234-5678-9012',
            name: decoded.name || 'Dr. Test User',
            userType: decoded.userType || 'practitioner',
            facilityId: decoded.facilityId || 'test-facility'
        };
    } catch (error) {
        throw new AuthenticationError('Invalid token format');
    }
};

const validateRealABHAToken = async (token) => {
    const response = await axios.post(
        `${process.env.ABHA_BASE_URL}/v0.5/users/auth/verify`,
        {},
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-CM-ID': process.env.ABHA_CM_ID || 'sbx',
                'Content-Type': 'application/json'
            },
            timeout: 5000
        }
    );

    if (response.status !== 200) {
        throw new AuthenticationError('ABHA token validation failed');
    }

    return response.data;
};

// Admin role validation
const requireAdmin = (req, res, next) => {
    // console.log(req.user)
    if (req.user?.userType !== 'admin') {
        return res.status(403).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'forbidden',
                details: {
                    text: 'Admin access required'
                }
            }]
        });
    }
    next();
};

module.exports = authMiddleware;
module.exports.requireAdmin = requireAdmin;