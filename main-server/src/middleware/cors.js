
// ===============================================
// CORS MIDDLEWARE (src/middleware/cors.js)
// ===============================================

const cors = require('cors');
const logger = require('../utils/logger');

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
            'http://localhost:3000',
            'http://localhost:3001',
            'https://localhost:3000',
            'https://localhost:3001'
        ];
        
        // Add development origins
        if (process.env.NODE_ENV === 'development') {
            allowedOrigins.push(
                '*'
            );
        }
        
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            callback(null, true);
        } else {
            logger.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-FHIR-Version',
        'Fhir-Version',
        'If-None-Exist',
        'If-Modified-Since',
        'If-None-Match',
        'Prefer',
        'ngrok-skip-browser-warning'
    ],
    exposedHeaders: [
        'X-FHIR-Version',
        'Location',
        'Last-Modified',
        'ETag',
        'X-Request-ID',
        'X-Rate-Limit-Limit',
        'X-Rate-Limit-Remaining',
        'X-Rate-Limit-Reset'
    ],
    credentials: true,
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
};

module.exports = cors(corsOptions);