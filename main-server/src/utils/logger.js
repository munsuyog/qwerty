// ===============================================
// LOGGER UTILITY (src/utils/logger.js)
// ===============================================

const winston = require('winston');
const path = require('path');

// Custom log format for FHIR terminology server
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    winston.format.errors({ stack: true }),
    winston.format.metadata({
        fillExcept: ['message', 'level', 'timestamp', 'label']
    }),
    winston.format.printf(({ timestamp, level, message, metadata, stack }) => {
        let logMessage = `${timestamp} [${level.toUpperCase()}]`;
        
        // Add service label
        if (metadata.service) {
            logMessage += ` [${metadata.service}]`;
        }
        
        logMessage += `: ${message}`;
        
        // Add metadata if present
        if (Object.keys(metadata).length > 0) {
            logMessage += ` | ${JSON.stringify(metadata)}`;
        }
        
        // Add stack trace for errors
        if (stack) {
            logMessage += `\n${stack}`;
        }
        
        return logMessage;
    })
);

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
require('fs').mkdirSync(logsDir, { recursive: true });

// Winston logger configuration
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: {
        service: 'namaste-fhir-terminology'
    },
    transports: [
        // Error log file
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 50 * 1024 * 1024, // 50MB
            maxFiles: 5,
            tailable: true
        }),
        
        // Combined log file
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 100 * 1024 * 1024, // 100MB
            maxFiles: 10,
            tailable: true
        }),
        
        // Audit log file (for compliance)
        new winston.transports.File({
            filename: path.join(logsDir, 'audit.log'),
            level: 'info',
            maxsize: 200 * 1024 * 1024, // 200MB
            maxFiles: 20,
            tailable: true,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            )
        })
    ],
    
    // Handle exceptions and rejections
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'exceptions.log'),
            maxsize: 50 * 1024 * 1024,
            maxFiles: 3
        })
    ],
    
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'rejections.log'),
            maxsize: 50 * 1024 * 1024,
            maxFiles: 3
        })
    ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ timestamp, level, message, metadata }) => {
                let logMessage = `${timestamp} [${level}]: ${message}`;
                
                if (metadata && Object.keys(metadata).length > 0) {
                    logMessage += ` ${JSON.stringify(metadata, null, 2)}`;
                }
                
                return logMessage;
            })
        )
    }));
}

// Custom logging methods for specific contexts
logger.terminology = (action, details) => {
    logger.info(`TERMINOLOGY: ${action}`, {
        category: 'terminology',
        action,
        ...details
    });
};

logger.fhir = (operation, details) => {
    logger.info(`FHIR: ${operation}`, {
        category: 'fhir',
        operation,
        ...details
    });
};

logger.auth = (event, details) => {
    logger.info(`AUTH: ${event}`, {
        category: 'authentication',
        event,
        ...details
    });
};

logger.audit = (event, details) => {
    logger.info(`AUDIT: ${event}`, {
        category: 'audit',
        event,
        ...details
    });
};

logger.performance = (metric, value, unit = 'ms') => {
    logger.info(`PERFORMANCE: ${metric}`, {
        category: 'performance',
        metric,
        value,
        unit
    });
};

logger.security = (event, details) => {
    logger.warn(`SECURITY: ${event}`, {
        category: 'security',
        event,
        ...details
    });
};

logger.integration = (system, event, details) => {
    logger.info(`INTEGRATION: ${system} - ${event}`, {
        category: 'integration',
        system,
        event,
        ...details
    });
};

// Structured logging for compliance
logger.compliance = (event, details) => {
    const complianceLog = {
        timestamp: new Date().toISOString(),
        category: 'compliance',
        event,
        ...details
    };
    
    // Write to audit transport
    logger.info(`COMPLIANCE: ${event}`, complianceLog);
};

// Health monitoring logs
logger.health = (component, status, details) => {
    const level = status === 'healthy' ? 'info' : 
                 status === 'degraded' ? 'warn' : 'error';
    
    logger.log(level, `HEALTH: ${component} - ${status}`, {
        category: 'health',
        component,
        status,
        ...details
    });
};

// Request correlation logging
logger.request = (requestId, method, url, details) => {
    logger.info(`REQUEST: ${method} ${url}`, {
        category: 'request',
        requestId,
        method,
        url,
        ...details
    });
};

logger.response = (requestId, statusCode, responseTime, details) => {
    const level = statusCode >= 500 ? 'error' :
                 statusCode >= 400 ? 'warn' : 'info';
    
    logger.log(level, `RESPONSE: ${statusCode} (${responseTime}ms)`, {
        category: 'response',
        requestId,
        statusCode,
        responseTime,
        ...details
    });
};

// Database operation logging
logger.database = (operation, collection, details) => {
    logger.debug(`DATABASE: ${operation} on ${collection}`, {
        category: 'database',
        operation,
        collection,
        ...details
    });
};

// Cache operation logging
logger.cache = (operation, key, details) => {
    logger.debug(`CACHE: ${operation} - ${key}`, {
        category: 'cache',
        operation,
        key,
        ...details
    });
};

// External service integration logging
logger.external = (service, operation, details) => {
    logger.info(`EXTERNAL: ${service} - ${operation}`, {
        category: 'external',
        service,
        operation,
        ...details
    });
};

// Error context logging
logger.errorContext = (error, context) => {
    logger.error(error.message, {
        category: 'error',
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: error.code
        },
        context
    });
};

// Create child logger with additional context
logger.child = (context) => {
    return {
        info: (message, meta = {}) => logger.info(message, { ...context, ...meta }),
        warn: (message, meta = {}) => logger.warn(message, { ...context, ...meta }),
        error: (message, meta = {}) => logger.error(message, { ...context, ...meta }),
        debug: (message, meta = {}) => logger.debug(message, { ...context, ...meta })
    };
};

// Log rotation and cleanup
const logCleanup = () => {
    const fs = require('fs');
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    const now = Date.now();
    
    try {
        const files = fs.readdirSync(logsDir);
        files.forEach(file => {
            const filePath = path.join(logsDir, file);
            const stats = fs.statSync(filePath);
            
            if (now - stats.mtime.getTime() > maxAge) {
                fs.unlinkSync(filePath);
                logger.info(`Cleaned up old log file: ${file}`);
            }
        });
    } catch (error) {
        logger.error('Log cleanup failed:', error);
    }
};

// Run cleanup daily
setInterval(logCleanup, 24 * 60 * 60 * 1000);

// Export logger with custom methods
module.exports = logger;