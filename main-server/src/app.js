// ===============================================
// MAIN APPLICATION ENTRY POINT (src/app.js)
// ===============================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./utils/logger');
const { connectDB } = require('./config/database');
const authMiddleware = require('./middleware/auth');
const auditMiddleware = require('./middleware/audit');
const validationMiddleware = require('./middleware/validation');
const corsMiddleware = require('./middleware/cors');
const { generalLimiter } = require('./middleware/rateLimit');

// Route imports
const fhirRoutes = require('./routes/fhir');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const feedbackRoutes = require('./routes/feedback');


const healthRoutes = require('./routes/health');

class NAMASTEFHIRServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3001;
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupMiddleware() {
        // Trust proxy for accurate IP addresses
        this.app.set('trust proxy', 1);

        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'"],
                    fontSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'none'"]
                }
            },
            crossOriginEmbedderPolicy: false,
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
        }));

        // CORS configuration
        this.app.use(corsMiddleware);

        // Performance middleware
        this.app.use(compression({
            level: 6,
            threshold: 1024,
            filter: (req, res) => {
                if (req.headers['x-no-compression']) {
                    return false;
                }
                return compression.filter(req, res);
            }
        }));

        // Body parsing middleware
        this.app.use(express.json({ 
            limit: '50mb',
            type: ['application/json', 'application/fhir+json']
        }));
        this.app.use(express.urlencoded({ 
            extended: true, 
            limit: '50mb' 
        }));

        // Logging middleware
        this.app.use(morgan('combined', { 
            stream: { 
                write: msg => logger.info(msg.trim(), { category: 'http' })
            },
            skip: (req, res) => {
                // Skip logging for health checks
                return req.path === '/health' || req.path === '/health/live';
            }
        }));

        // Rate limiting
        this.app.use(generalLimiter);

        // Audit logging
        this.app.use(auditMiddleware);

        // FHIR validation
        this.app.use('/fhir', validationMiddleware);

        // Request ID middleware
        this.app.use((req, res, next) => {
            req.id = require('uuid').v4();
            res.set('X-Request-ID', req.id);
            next();
        });

        // Response time middleware
        this.app.use((req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - start;
                logger.performance('request-duration', duration, 'ms');
            });
            next();
        });
    }

    setupRoutes() {
        // Health check endpoints (no auth required)
        this.app.use('/health', healthRoutes);

        // FHIR endpoints (auth required for most operations)
        this.app.use('/fhir', fhirRoutes);

        // Admin endpoints (admin auth required)
        this.app.use('/admin', authMiddleware, adminRoutes);
        this.app.use('/auth', authRoutes);
        this.app.use('/feedback', feedbackRoutes);



        // Root endpoint with server information
        this.app.get('/', (req, res) => {
            res.json({
                name: 'NAMASTE FHIR Terminology Server',
                version: '1.0.0',
                description: 'FHIR R4 compliant terminology server for NAMASTE codes with ICD-11 TM2 integration',
                fhirVersion: '4.0.1',
                status: 'active',
                implementation: {
                    description: 'NAMASTE-ICD11 Terminology Microservice',
                    url: `${req.protocol}://${req.get('host')}`
                },
                endpoints: {
                    fhir: `${req.protocol}://${req.get('host')}/fhir/metadata`,
                    health: `${req.protocol}://${req.get('host')}/health`,
                    admin: `${req.protocol}://${req.get('host')}/admin`,
                    documentation: `${req.protocol}://${req.get('host')}/docs`
                },
                features: [
                    'NAMASTE code system integration',
                    'ICD-11 Traditional Medicine Module 2 mapping',
                    'ICD-11 Biomedicine mapping',
                    'Dual coding validation',
                    'Auto-complete terminology search',
                    'ABHA OAuth 2.0 authentication',
                    'Real-time WHO ICD-11 synchronization'
                ],
                standards: {
                    fhir: 'R4 (4.0.1)',
                    authentication: 'OAuth 2.0 with ABHA',
                    terminology: ['NAMASTE', 'ICD-11 TM2', 'ICD-11 Biomedicine'],
                    compliance: 'India EHR Standards 2016'
                }
            });
        });

        // API documentation endpoint
        this.app.get('/docs', (req, res) => {
            res.json({
                title: 'NAMASTE FHIR Terminology Server API Documentation',
                description: 'Complete API reference for NAMASTE-ICD11 integration',
                version: '1.0.0',
                baseUrl: `${req.protocol}://${req.get('host')}`,
                endpoints: {
                    capability: 'GET /fhir/metadata',
                    search: 'GET /fhir/ValueSet/search?q={term}',
                    dualCoding: 'GET /fhir/ValueSet/dual-coding-search?q={term}',
                    lookup: 'POST /fhir/CodeSystem/$lookup',
                    translate: 'POST /fhir/ConceptMap/$translate',
                    bundle: 'POST /fhir/Bundle'
                },
                examples: {
                    search: `${req.protocol}://${req.get('host')}/fhir/ValueSet/search?q=vata&count=5`,
                    dualCoding: `${req.protocol}://${req.get('host')}/fhir/ValueSet/dual-coding-search?q=digestive`,
                    codeSystem: `${req.protocol}://${req.get('host')}/fhir/CodeSystem/namaste`
                }
            });
        });

        // Favicon handler
        this.app.get('/favicon.ico', (req, res) => {
            res.status(204).end();
        });

        // 404 handler for unknown routes
        this.app.use('*', (req, res) => {
            logger.warn('Route not found', { 
                path: req.originalUrl, 
                method: req.method,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    details: {
                        text: `Endpoint not found: ${req.method} ${req.originalUrl}`,
                        coding: [{
                            system: 'http://terminology.hl7.org/CodeSystem/operation-outcome',
                            code: 'MSG_UNKNOWN_OPERATION'
                        }]
                    },
                    diagnostics: `Available endpoints: /fhir/metadata, /health, /admin`
                }]
            });
        });
    }

    // Conditional authentication for FHIR endpoints
    conditionalAuth(req, res, next) {
        // Skip auth for metadata and some read operations
        const publicEndpoints = [
            '/fhir/metadata',
            '/fhir/CapabilityStatement'
        ];

        const isPublicEndpoint = publicEndpoints.some(endpoint => 
            req.path === endpoint || req.path.startsWith(endpoint)
        );

        // Allow read operations without auth in development
        const isReadOperation = req.method === 'GET' && process.env.NODE_ENV === 'development';

        if (isPublicEndpoint || isReadOperation) {
            return next();
        }

        // Require authentication for all other operations
        return authMiddleware(req, res, next);
    }

    setupErrorHandling() {
        // Global error handler
        this.app.use((error, req, res, next) => {
            // Log the error with context
            logger.errorContext(error, {
                requestId: req.id,
                path: req.path,
                method: req.method,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                body: req.body ? Object.keys(req.body) : undefined
            });

            // Determine error type and response
            let statusCode = 500;
            let errorCode = 'exception';
            let message = 'Internal server error';

            if (error.name === 'ValidationError') {
                statusCode = 400;
                errorCode = 'invalid';
                message = error.message;
            } else if (error.name === 'AuthenticationError') {
                statusCode = 401;
                errorCode = 'login';
                message = 'Authentication failed';
            } else if (error.name === 'AuthorizationError') {
                statusCode = 403;
                errorCode = 'forbidden';
                message = 'Access denied';
            } else if (error.name === 'NotFoundError') {
                statusCode = 404;
                errorCode = 'not-found';
                message = 'Resource not found';
            } else if (error.code === 'LIMIT_FILE_SIZE') {
                statusCode = 413;
                errorCode = 'too-large';
                message = 'File too large';
            } else if (error.type === 'entity.parse.failed') {
                statusCode = 400;
                errorCode = 'structure';
                message = 'Invalid JSON structure';
            }

            // Create FHIR-compliant OperationOutcome
            const operationOutcome = {
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: errorCode,
                    details: {
                        text: process.env.NODE_ENV === 'production' ? message : error.message,
                        coding: [{
                            system: 'http://terminology.hl7.org/CodeSystem/operation-outcome',
                            code: errorCode.toUpperCase()
                        }]
                    },
                    ...(process.env.NODE_ENV !== 'production' && {
                        diagnostics: error.stack
                    })
                }]
            };

            // Add request correlation
            if (req.id) {
                res.set('X-Request-ID', req.id);
                operationOutcome.id = req.id;
            }

            res.status(statusCode).json(operationOutcome);
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception - shutting down', error);
            this.gracefulShutdown(1);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled rejection - shutting down', { reason, promise });
            this.gracefulShutdown(1);
        });

        // Handle termination signals
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received - starting graceful shutdown');
            this.gracefulShutdown(0);
        });

        process.on('SIGINT', () => {
            logger.info('SIGINT received - starting graceful shutdown');
            this.gracefulShutdown(0);
        });
    }

    async gracefulShutdown(exitCode = 0) {
        logger.info('Starting graceful shutdown...');

        // Stop accepting new connections
        if (this.server) {
            this.server.close(async () => {
                logger.info('HTTP server closed');

                try {
                    // Close database connections
                    const { closeConnections } = require('./config/database');
                    await closeConnections();
                    logger.info('Database connections closed');
                } catch (error) {
                    logger.error('Error closing database connections:', error);
                }

                logger.info('Graceful shutdown completed');
                process.exit(exitCode);
            });

            // Force shutdown after 30 seconds
            setTimeout(() => {
                logger.error('Forceful shutdown - timeout exceeded');
                process.exit(1);
            }, 30000);
        } else {
            process.exit(exitCode);
        }
    }

    async start() {
        try {
            // Connect to database
            await connectDB();
            logger.info('Database connected successfully');

            // Start HTTP server
            this.server = this.app.listen(this.port, () => {
                logger.info(`🚀 NAMASTE FHIR Server running on port ${this.port}`, {
                    environment: process.env.NODE_ENV || 'development',
                    version: '1.0.0'
                });
                
                logger.info(`📍 FHIR Endpoint: http://localhost:${this.port}/fhir/metadata`);
                logger.info(`🏥 Health Check: http://localhost:${this.port}/health`);
                logger.info(`⚙️  Admin Panel: http://localhost:${this.port}/admin`);
                logger.info(`📚 Documentation: http://localhost:${this.port}/docs`);

                // Log startup summary
                logger.info('Server startup completed', {
                    features: [
                        'FHIR R4 Terminology Server',
                        'NAMASTE Code System',
                        'ICD-11 Integration',
                        'Dual Coding Support',
                        'ABHA Authentication',
                        'Auto-complete Search'
                    ]
                });
            });

            // Handle server errors
            this.server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    logger.error(`Port ${this.port} is already in use`);
                } else {
                    logger.error('Server error:', error);
                }
                process.exit(1);
            });

        } catch (error) {
            logger.error('Failed to start server:', error);
            process.exit(1);
        }
    }

    // Method to get server instance for testing
    getApp() {
        return this.app;
    }

    // Method to stop server (for testing)
    async stop() {
        if (this.server) {
            return new Promise((resolve, reject) => {
                this.server.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
        }
    }
}

// Start server if this file is run directly
if (require.main === module) {
    const server = new NAMASTEFHIRServer();
    server.start().catch(error => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

module.exports = NAMASTEFHIRServer;