// ===============================================
// AUDIT MIDDLEWARE (src/middleware/audit.js)
// ===============================================

const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../config/database');
const logger = require('../utils/logger');

const auditMiddleware = (req, res, next) => {
    const auditEntry = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl,
        path: req.path,
        query: req.query,
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress || req.socket.remoteAddress,
        requestId: uuidv4(),
        contentType: req.get('Content-Type'),
        contentLength: req.get('Content-Length'),
        xForwardedFor: req.get('X-Forwarded-For'),
        referer: req.get('Referer')
    };

    req.auditId = auditEntry.requestId;
    req.auditEntry = auditEntry;
    
    // Capture response details
    const originalSend = res.send;
    res.send = function(data) {
        auditEntry.statusCode = res.statusCode;
        auditEntry.responseTime = Date.now() - req.startTime;
        auditEntry.responseSize = data ? Buffer.byteLength(data, 'utf8') : 0;
        
        // Log to database asynchronously
        setImmediate(async () => {
            try {
                const db = getDB();
                
                // Add user context if available from auth middleware
                if (req.auditContext) {
                    Object.assign(auditEntry, req.auditContext);
                }
                
                // Categorize the audit entry
                auditEntry.category = categorizeRequest(req);
                auditEntry.outcome = res.statusCode < 400 ? 'success' : 'failure';
                
                // Store sensitive data flags
                auditEntry.sensitiveData = containsSensitiveData(req, data);
                
                await db.collection('audit').insertOne(auditEntry);
            } catch (error) {
                logger.error('Audit logging failed:', error);
            }
        });
        
        return originalSend.call(this, data);
    };

    // Record request start time
    req.startTime = Date.now();
    
    next();
};

const categorizeRequest = (req) => {
    const path = req.path.toLowerCase();
    
    if (path.includes('/health')) return 'health-check';
    if (path.includes('/metadata')) return 'capability-statement';
    if (path.includes('/codesystem')) return 'terminology-read';
    if (path.includes('/valueset')) return 'terminology-search';
    if (path.includes('/conceptmap')) return 'terminology-translate';
    if (path.includes('/bundle')) return 'data-submission';
    if (path.includes('/admin')) return 'administration';
    if (path.includes('/$lookup')) return 'terminology-lookup';
    if (path.includes('/$expand')) return 'valueset-expansion';
    if (path.includes('/$translate')) return 'concept-translation';
    
    return 'other';
};

const containsSensitiveData = (req, responseData) => {
    // Check for potentially sensitive information
    const sensitivePatterns = [
        /patient/i,
        /health.?id/i,
        /abha/i,
        /token/i,
        /authorization/i
    ];
    
    const requestString = JSON.stringify(req.body || {});
    const responseString = typeof responseData === 'string' ? responseData : JSON.stringify(responseData || {});
    
    return sensitivePatterns.some(pattern => 
        pattern.test(requestString) || pattern.test(responseString)
    );
};

module.exports = auditMiddleware;
