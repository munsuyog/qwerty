// ===============================================
// AUTHENTICATION ROUTES (src/routes/auth.js)
// ===============================================

const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();
const { getRedis } = require('../config/database');
const { authLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');

// Apply rate limiting to all auth routes
router.use(authLimiter);

// ===============================================
// ABHA OAUTH 2.0 ENDPOINTS
// ===============================================

// ABHA OAuth 2.0 Authorization URL
router.get('/abha/authorize', async (req, res) => {
    try {
        const { redirect_uri, scope = 'abha-enrol', state } = req.query;
        
        if (!redirect_uri) {
            return res.status(400).json({
                error: 'invalid_request',
                error_description: 'redirect_uri parameter is required'
            });
        }

        // Generate state if not provided
        const authState = state || crypto.randomBytes(32).toString('hex');
        
        // Store state for validation
        const redis = getRedis();
        await redis.setEx(`auth-state:${authState}`, 600, JSON.stringify({
            redirect_uri,
            scope,
            created_at: new Date().toISOString()
        }));

        const authUrl = new URL(`${process.env.ABHA_BASE_URL}/v0.5/users/auth/init`);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', process.env.ABHA_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', redirect_uri);
        authUrl.searchParams.set('scope', scope);
        authUrl.searchParams.set('state', authState);

        logger.auth('abha-authorization-initiated', {
            redirect_uri,
            scope,
            state: authState,
            ip: req.ip
        });

        res.json({
            authorization_url: authUrl.toString(),
            state: authState,
            expires_in: 600
        });

    } catch (error) {
        logger.error('ABHA authorization initiation failed:', error);
        res.status(500).json({
            error: 'server_error',
            error_description: 'Failed to initiate ABHA authorization'
        });
    }
});

// ABHA OAuth 2.0 Token Exchange
router.post('/abha/token', async (req, res) => {
    try {
        const { code, state, redirect_uri } = req.body;
        
        if (!code || !state) {
            return res.status(400).json({
                error: 'invalid_request',
                error_description: 'code and state parameters are required'
            });
        }

        // Validate state
        const redis = getRedis();
        const stateData = await redis.get(`auth-state:${state}`);
        
        if (!stateData) {
            return res.status(400).json({
                error: 'invalid_grant',
                error_description: 'Invalid or expired state parameter'
            });
        }

        const parsedState = JSON.parse(stateData);
        
        if (parsedState.redirect_uri !== redirect_uri) {
            return res.status(400).json({
                error: 'invalid_grant',
                error_description: 'redirect_uri mismatch'
            });
        }

        // Exchange code for token with ABHA
        let tokenResponse;
        
        if (process.env.NODE_ENV === 'development') {
            // Mock token response for development
            tokenResponse = {
                access_token: generateDevelopmentToken({
                    sub: 'dev-user-' + Date.now(),
                    healthId: '91-1234-5678-9012',
                    name: 'Dr. Development User',
                    userType: 'practitioner',
                    facilityId: 'dev-facility'
                }),
                token_type: 'Bearer',
                expires_in: 3600,
                refresh_token: crypto.randomBytes(32).toString('hex'),
                scope: parsedState.scope
            };
        } else {
            // Real ABHA token exchange
            const abhaResponse = await axios.post(`${process.env.ABHA_BASE_URL}/v0.5/users/auth/token`, {
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirect_uri,
                client_id: process.env.ABHA_CLIENT_ID,
                client_secret: process.env.ABHA_CLIENT_SECRET
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-CM-ID': process.env.ABHA_CM_ID || 'sbx'
                }
            });

            tokenResponse = abhaResponse.data;
        }

        // Store token information
        const tokenHash = crypto.createHash('sha256').update(tokenResponse.access_token).digest('hex');
        await redis.setEx(`token:${tokenHash}`, tokenResponse.expires_in, JSON.stringify({
            expires_at: new Date(Date.now() + (tokenResponse.expires_in * 1000)).toISOString(),
            scope: tokenResponse.scope,
            created_at: new Date().toISOString()
        }));

        // Clean up state
        await redis.del(`auth-state:${state}`);

        logger.auth('abha-token-exchange-success', {
            scope: tokenResponse.scope,
            expires_in: tokenResponse.expires_in,
            ip: req.ip
        });

        res.json(tokenResponse);

    } catch (error) {
        logger.error('ABHA token exchange failed:', error);
        
        if (error.response) {
            return res.status(error.response.status).json({
                error: 'invalid_grant',
                error_description: 'ABHA token exchange failed',
                details: error.response.data
            });
        }

        res.status(500).json({
            error: 'server_error',
            error_description: 'Token exchange failed'
        });
    }
});

// Token Refresh
router.post('/abha/refresh', async (req, res) => {
    try {
        const { refresh_token } = req.body;
        
        if (!refresh_token) {
            return res.status(400).json({
                error: 'invalid_request',
                error_description: 'refresh_token is required'
            });
        }

        let refreshResponse;

        if (process.env.NODE_ENV === 'development') {
            // Mock refresh for development
            refreshResponse = {
                access_token: generateDevelopmentToken({
                    sub: 'dev-user-refreshed',
                    healthId: '91-1234-5678-9012',
                    name: 'Dr. Development User',
                    userType: 'practitioner',
                    facilityId: 'dev-facility'
                }),
                token_type: 'Bearer',
                expires_in: 3600,
                refresh_token: crypto.randomBytes(32).toString('hex'),
                scope: 'abha-enrol'
            };
        } else {
            // Real ABHA refresh
            const abhaResponse = await axios.post(`${process.env.ABHA_BASE_URL}/v0.5/users/auth/token`, {
                grant_type: 'refresh_token',
                refresh_token: refresh_token,
                client_id: process.env.ABHA_CLIENT_ID,
                client_secret: process.env.ABHA_CLIENT_SECRET
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-CM-ID': process.env.ABHA_CM_ID || 'sbx'
                }
            });

            refreshResponse = abhaResponse.data;
        }

        logger.auth('abha-token-refresh-success', {
            expires_in: refreshResponse.expires_in,
            ip: req.ip
        });

        res.json(refreshResponse);

    } catch (error) {
        logger.error('ABHA token refresh failed:', error);
        res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Token refresh failed'
        });
    }
});

// Token Validation/Introspection
router.post('/abha/introspect', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({
                error: 'invalid_request',
                error_description: 'token parameter is required'
            });
        }

        let userInfo;

        if (process.env.NODE_ENV === 'development') {
            try {
                // Validate development token
                userInfo = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
                userInfo.active = true;
            } catch (jwtError) {
                userInfo = { active: false };
            }
        } else {
            // Real ABHA introspection
            const abhaResponse = await axios.post(`${process.env.ABHA_BASE_URL}/v0.5/users/auth/verify`, {}, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-CM-ID': process.env.ABHA_CM_ID || 'sbx'
                }
            });

            userInfo = { ...abhaResponse.data, active: true };
        }

        res.json(userInfo);

    } catch (error) {
        logger.warn('Token introspection failed:', error.message);
        res.json({ active: false });
    }
});

// ===============================================
// DEVELOPMENT & TESTING ENDPOINTS
// ===============================================

// Generate Development Token (Development only)
router.post('/generate-token', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({
            error: 'not_found',
            error_description: 'Endpoint not available in production'
        });
    }

    try {
        const {
            user = 'test-user',
            role = 'practitioner',
            facilityId = 'test-facility',
            healthId = '91-1234-5678-9012',
            name = 'Dr. Test User',
            expiresIn = '24h'
        } = req.body;

        const token = generateDevelopmentToken({
            sub: user,
            healthId,
            name,
            userType: role,
            facilityId
        }, expiresIn);

        logger.auth('development-token-generated', {
            user,
            role,
            facilityId,
            ip: req.ip
        });

        res.json({
            access_token: token,
            token_type: 'Bearer',
            expires_in: parseExpiresIn(expiresIn),
            scope: 'test-scope',
            user_info: {
                sub: user,
                healthId,
                name,
                userType: role,
                facilityId
            }
        });

    } catch (error) {
        logger.error('Development token generation failed:', error);
        res.status(500).json({
            error: 'server_error',
            error_description: 'Token generation failed'
        });
    }
});

// Validate Token (Development helper)
router.post('/validate', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({
                error: 'invalid_request',
                error_description: 'token is required'
            });
        }

        // Try development token first
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
            return res.json({
                valid: true,
                type: 'development',
                user: decoded,
                expires_at: new Date(decoded.exp * 1000).toISOString()
            });
        } catch (jwtError) {
            // Not a development token, try ABHA validation
        }

        // Validate with ABHA
        const introspectResponse = await axios.post(`${req.protocol}://${req.get('host')}/auth/abha/introspect`, {
            token: token
        });

        if (introspectResponse.data.active) {
            res.json({
                valid: true,
                type: 'abha',
                user: introspectResponse.data
            });
        } else {
            res.json({
                valid: false,
                type: 'unknown'
            });
        }

    } catch (error) {
        logger.error('Token validation failed:', error);
        res.json({
            valid: false,
            error: error.message
        });
    }
});

// ===============================================
// LOGOUT & SESSION MANAGEMENT
// ===============================================

// Logout (Token Revocation)
router.post('/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(400).json({
                error: 'invalid_request',
                error_description: 'Authorization token required'
            });
        }

        // Add token to blacklist
        const redis = getRedis();
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        
        // Blacklist for 24 hours (longer than max token lifetime)
        await redis.setEx(`blacklist:${tokenHash}`, 86400, 'revoked');

        logger.auth('user-logout', {
            tokenHash: tokenHash.substring(0, 8),
            ip: req.ip
        });

        res.json({
            message: 'Successfully logged out'
        });

    } catch (error) {
        logger.error('Logout failed:', error);
        res.status(500).json({
            error: 'server_error',
            error_description: 'Logout failed'
        });
    }
});

// Session Info
router.get('/session', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                error: 'unauthorized',
                error_description: 'Authorization token required'
            });
        }

        // Get session info from middleware (set by auth middleware)
        if (req.user) {
            res.json({
                active: true,
                user: {
                    id: req.user.sub || req.user.healthId,
                    name: req.user.name,
                    userType: req.user.userType,
                    facilityId: req.user.facilityId,
                    healthId: req.user.healthId
                },
                token_info: {
                    expires_at: req.user.exp ? new Date(req.user.exp * 1000).toISOString() : null,
                    issued_at: req.user.iat ? new Date(req.user.iat * 1000).toISOString() : null
                }
            });
        } else {
            res.status(401).json({
                error: 'unauthorized',
                error_description: 'Invalid session'
            });
        }

    } catch (error) {
        logger.error('Session info retrieval failed:', error);
        res.status(500).json({
            error: 'server_error',
            error_description: 'Failed to get session info'
        });
    }
});

// ===============================================
// HELPER FUNCTIONS
// ===============================================

function generateDevelopmentToken(payload, expiresIn = '24h') {
    const tokenPayload = {
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + parseExpiresIn(expiresIn),
        iss: 'namaste-fhir-dev',
        aud: 'terminology-server'
    };

    return jwt.sign(tokenPayload, process.env.JWT_SECRET || 'dev-secret');
}

function parseExpiresIn(expiresIn) {
    if (typeof expiresIn === 'number') return expiresIn;
    if (typeof expiresIn === 'string') {
        const match = expiresIn.match(/^(\d+)([smhd])$/);
        if (match) {
            const [, num, unit] = match;
            const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
            return parseInt(num) * (multipliers[unit] || 3600);
        }
    }
    return 3600; // Default 1 hour
}

module.exports = router;