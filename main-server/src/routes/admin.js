// ===============================================
// ENHANCED ADMIN ROUTES (src/routes/admin.js)
// ===============================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimit');
const NAMASTEService = require('../services/namasteService');
const ICD11Service = require('../services/icd11Service');
const SearchService = require('../services/searchService');
const FHIRService = require('../services/fhirService');
const logger = require('../utils/logger');

// Apply admin authentication and rate limiting to all routes
router.use(requireAdmin);
router.use(adminLimiter);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        
        // Ensure upload directory exists
        require('fs').mkdirSync(uploadDir, { recursive: true });
        
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext);
        const safeName = baseName.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}-${safeName}${ext}`);
    }
});
const fileFilter = (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv', '.json'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (allowedExtensions.includes(fileExtension)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${fileExtension} not allowed. Allowed types: ${allowedExtensions.join(', ')}`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
        files: 5
    }
});

// ===============================================
// SYSTEM OVERVIEW & DASHBOARD
// ===============================================

// Admin dashboard overview
router.get('/dashboard', async (req, res) => {
    try {
        logger.audit('admin-dashboard-accessed', { 
            userId: req.auditContext.userId,
            userType: req.auditContext.userType 
        });

        const { getDB } = require('../config/database');
        const db = getDB();
        
        // Gather comprehensive system statistics
        const [
            codeSystemStats,
            valueSetStats,
            conceptMapStats,
            auditStats,
            recentActivity,
            systemHealth
        ] = await Promise.all([
            // CodeSystem statistics
            db.collection('codesystems').aggregate([
                {
                    $group: {
                        _id: null,
                        totalCodeSystems: { $sum: 1 },
                        totalConcepts: { $sum: '$count' },
                        namasteCount: {
                            $sum: {
                                $cond: [{ $regexMatch: { input: '$url', regex: /namaste/ } }, 1, 0]
                            }
                        },
                        icd11Count: {
                            $sum: {
                                $cond: [{ $regexMatch: { input: '$url', regex: /icd/ } }, 1, 0]
                            }
                        }
                    }
                }
            ]).toArray(),

            // ValueSet statistics
            db.collection('valuesets').countDocuments(),

            // ConceptMap statistics
            db.collection('conceptmaps').aggregate([
                {
                    $group: {
                        _id: null,
                        totalMaps: { $sum: 1 },
                        totalMappings: {
                            $sum: {
                                $reduce: {
                                    input: '$group',
                                    initialValue: 0,
                                    in: { $add: ['$value', { $size: { $ifNull: ['$this.element', []] } }] }
                                }
                            }
                        }
                    }
                }
            ]).toArray(),

            // Audit statistics (last 30 days)
            db.collection('audit').aggregate([
                {
                    $match: {
                        timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalRequests: { $sum: 1 },
                        uniqueUsers: { $addToSet: '$userId' },
                        searchRequests: {
                            $sum: { $cond: [{ $eq: ['$category', 'terminology-search'] }, 1, 0] }
                        },
                        lookupRequests: {
                            $sum: { $cond: [{ $eq: ['$category', 'terminology-lookup'] }, 1, 0] }
                        },
                        translationRequests: {
                            $sum: { $cond: [{ $eq: ['$category', 'terminology-translate'] }, 1, 0] }
                        },
                        bundleSubmissions: {
                            $sum: { $cond: [{ $eq: ['$category', 'data-submission'] }, 1, 0] }
                        }
                    }
                }
            ]).toArray(),

            // Recent activity (last 24 hours)
            db.collection('audit').find(
                { timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
                { sort: { timestamp: -1 }, limit: 20 }
            ).toArray(),

            // System health checks
            Promise.resolve().then(async () => {
                const searchService = new SearchService();
                await searchService.initialize();
                return searchService.validateSearchHealth();
            })
        ]);

        const dashboard = {
            timestamp: new Date().toISOString(),
            overview: {
                codeSystems: codeSystemStats[0] || {
                    totalCodeSystems: 0,
                    totalConcepts: 0,
                    namasteCount: 0,
                    icd11Count: 0
                },
                valueSets: valueSetStats,
                conceptMaps: conceptMapStats[0] || { totalMaps: 0, totalMappings: 0 },
                usage: auditStats[0] || {
                    totalRequests: 0,
                    uniqueUsers: [],
                    searchRequests: 0,
                    lookupRequests: 0,
                    translationRequests: 0,
                    bundleSubmissions: 0
                }
            },
            recentActivity: recentActivity.map(activity => ({
                timestamp: activity.timestamp,
                category: activity.category,
                method: activity.method,
                path: activity.path,
                outcome: activity.outcome,
                userId: activity.userId,
                responseTime: activity.responseTime
            })),
            systemHealth: systemHealth
        };

        // Calculate additional metrics
        dashboard.overview.usage.uniqueUserCount = dashboard.overview.usage.uniqueUsers.length;
        delete dashboard.overview.usage.uniqueUsers;

        res.json(dashboard);

    } catch (error) {
        logger.error('Failed to generate admin dashboard:', error);
        res.status(500).json({
            error: 'Failed to generate dashboard',
            details: error.message
        });
    }
});

// ===============================================
// NAMASTE DATA MANAGEMENT
// ===============================================

// Upload and process NAMASTE Excel file
router.post('/upload-namaste', async (req, res, next) => {
    try {
        // Verify database connection before processing upload
        const { getDB } = require('../config/database');
        const db = getDB();
        await db.admin().ping();
        next();
    } catch (dbError) {
        return res.status(503).json({
            error: 'Database connection failed',
            message: 'Cannot process uploads while database is unavailable',
            details: dbError.message
        });
    }
}, upload.single('namasteFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'No file uploaded',
                message: 'Please upload a NAMASTE Excel file (.xlsx or .xls)'
            });
        }

        logger.audit('namaste-file-uploaded', {
            userId: req.auditContext.userId,
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size
        });

        // Validate file before processing
        if (!req.file.path || !require('fs').existsSync(req.file.path)) {
            throw new Error('Uploaded file not found or corrupted');
        }

        // Initialize service with retry logic
        const namasteService = new NAMASTEService();
        let retries = 3;
        while (retries > 0) {
            try {
                await namasteService.initialize();
                break;
            } catch (initError) {
                retries--;
                if (retries === 0) throw initError;
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
            }
        }
        
        // Process with detailed error reporting
        const result = await namasteService.processExcelFile(req.file.path);
        
        // Verify processing succeeded
        if (!result || result.concepts === 0) {
            throw new Error('No valid concepts found in uploaded file');
        }

        // Clean up uploaded file after successful processing
        setTimeout(async () => {
            try {
                await require('fs').promises.unlink(req.file.path);
            } catch (cleanupError) {
                logger.warn('Failed to cleanup uploaded file:', cleanupError);
            }
        }, 60000);

        logger.audit('namaste-data-processed', {
            userId: req.auditContext.userId,
            conceptsProcessed: result.concepts,
            valueSetsCreated: result.valueSets
        });

        res.json({
            success: true,
            message: 'NAMASTE data processed successfully',
            result,
            file: {
                originalName: req.file.originalname,
                size: req.file.size,
                processedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        logger.error('NAMASTE processing failed:', {
            error: error.message,
            stack: error.stack,
            file: req.file?.originalname,
            userId: req.auditContext?.userId
        });
        
        // Clean up file on error
        if (req.file?.path) {
            try {
                await require('fs').promises.unlink(req.file.path);
            } catch (cleanupError) {
                logger.warn('Failed to cleanup file after error:', cleanupError);
            }
        }

        res.status(500).json({
            success: false,
            error: 'NAMASTE processing failed',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            troubleshooting: {
                fileFormat: 'Ensure file is .xlsx or .xls format',
                columns: 'Verify required columns: Code, Display, Definition',
                encoding: 'Check file encoding is UTF-8',
                size: 'File should be under 50MB'
            }
        });
    }
});

// Process NAMASTE from file path (for scheduled updates)
router.post('/process-namaste', async (req, res) => {
    try {
        const { filePath, validateOnly = false } = req.body;
        
        if (!filePath) {
            return res.status(400).json({
                error: 'File path is required'
            });
        }

        logger.audit('namaste-processing-started', {
            userId: req.auditContext.userId,
            filePath,
            validateOnly
        });

        const namasteService = new NAMASTEService();
        await namasteService.initialize();
        
        const result = await namasteService.processExcelFile(filePath);
        
        res.json({
            message: 'NAMASTE data processed successfully',
            result
        });

    } catch (error) {
        logger.error('NAMASTE processing failed:', error);
        res.status(500).json({
            error: 'Processing failed',
            details: error.message
        });
    }
});

// Get NAMASTE system statistics
router.get('/namaste/stats', async (req, res) => {
    try {
        const namasteService = new NAMASTEService();
        await namasteService.initialize();
        
        const stats = await namasteService.getSystemStats();
        
        res.json({
            namaste: stats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Failed to get NAMASTE stats:', error);
        res.status(500).json({
            error: 'Failed to get NAMASTE statistics',
            details: error.message
        });
    }
});

// ===============================================
// ICD-11 INTEGRATION MANAGEMENT
// ===============================================

// Sync ICD-11 data from WHO API
router.post('/sync-icd11', async (req, res) => {
    try {
        const { syncTraditionalMedicine = true, syncBiomedicine = true, regenerateMappings = true } = req.body;

        logger.audit('icd11-sync-started', {
            userId: req.auditContext.userId,
            syncTraditionalMedicine,
            syncBiomedicine,
            regenerateMappings
        });

        const icd11Service = new ICD11Service();
        await icd11Service.initialize();
        
        const result = await icd11Service.syncTraditionalMedicine();
        
        logger.audit('icd11-sync-completed', {
            userId: req.auditContext.userId,
            result
        });
        
        res.json({
            message: 'ICD-11 sync completed successfully',
            result
        });

    } catch (error) {
        logger.error('ICD-11 sync failed:', error);
        res.status(500).json({
            error: 'ICD-11 sync failed',
            details: error.message
        });
    }
});

// Test ICD-11 API connectivity
router.get('/test-icd11-connection', async (req, res) => {
    try {
        const icd11Service = new ICD11Service();
        await icd11Service.initialize();
        
        // Test authentication
        await icd11Service.authenticate();
        
        // Test API access
        const testSearch = await icd11Service.searchICD11('test', 'tm2', 1);
        
        res.json({
            status: 'connected',
            authenticated: true,
            apiResponsive: true,
            testSearchResults: testSearch.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('ICD-11 connection test failed:', error);
        res.status(200).json({
            status: 'error',
            authenticated: false,
            apiResponsive: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get ICD-11 system status
router.get('/icd11/status', async (req, res) => {
    try {
        const icd11Service = new ICD11Service();
        await icd11Service.initialize();
        
        const codeSystems = await icd11Service.getAvailableCodeSystems();
        
        res.json({
            codeSystems: codeSystems,
            tm2Available: codeSystems.some(cs => cs.url.includes('traditional-medicine')),
            biomedicineAvailable: codeSystems.some(cs => cs.url.includes('mms') && !cs.url.includes('traditional-medicine')),
            lastSync: await getLastSyncTime('icd11-sync'),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Failed to get ICD-11 status:', error);
        res.status(500).json({
            error: 'Failed to get ICD-11 status',
            details: error.message
        });
    }
});

// ===============================================
// CONCEPT MAPPING MANAGEMENT
// ===============================================

// Generate concept mappings
router.post('/generate-mappings', async (req, res) => {
    try {
        const { sourceSystem, targetSystem, regenerateExisting = false } = req.body;

        logger.audit('mapping-generation-started', {
            userId: req.auditContext.userId,
            sourceSystem,
            targetSystem,
            regenerateExisting
        });

        const icd11Service = new ICD11Service();
        await icd11Service.initialize();
        
        await icd11Service.generateConceptMaps();
        
        logger.audit('mapping-generation-completed', {
            userId: req.auditContext.userId,
            sourceSystem,
            targetSystem
        });
        
        res.json({
            message: 'Concept mappings generated successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Mapping generation failed:', error);
        res.status(500).json({
            error: 'Mapping generation failed',
            details: error.message
        });
    }
});

// Validate concept mappings
router.post('/validate-mappings', async (req, res) => {
    try {
        const { conceptMapId, sampleSize = 10 } = req.body;

        const { getDB } = require('../config/database');
        const db = getDB();
        
        let query = {};
        if (conceptMapId) {
            query = { id: conceptMapId };
        }

        const conceptMaps = await db.collection('conceptmaps').find(query).toArray();
        const validationResults = [];

        for (const conceptMap of conceptMaps) {
            const validation = await validateConceptMap(conceptMap, sampleSize);
            validationResults.push({
                conceptMapId: conceptMap.id,
                sourceSystem: conceptMap.sourceUri,
                targetSystem: conceptMap.targetUri,
                ...validation
            });
        }

        res.json({
            validationResults,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Mapping validation failed:', error);
        res.status(500).json({
            error: 'Mapping validation failed',
            details: error.message
        });
    }
});

// ===============================================
// SEARCH INDEX MANAGEMENT
// ===============================================

// Refresh search index
router.post('/refresh-search-index', async (req, res) => {
    try {
        logger.audit('search-index-refresh-started', {
            userId: req.auditContext.userId
        });

        const searchService = new SearchService();
        await searchService.initialize();
        await searchService.refreshIndex();
        
        const stats = await searchService.getIndexStats();
        
        logger.audit('search-index-refresh-completed', {
            userId: req.auditContext.userId,
            indexStats: stats
        });
        
        res.json({
            message: 'Search index refreshed successfully',
            stats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Search index refresh failed:', error);
        res.status(500).json({
            error: 'Index refresh failed',
            details: error.message
        });
    }
});

// Get search index statistics
router.get('/search/stats', async (req, res) => {
    try {
        const searchService = new SearchService();
        await searchService.initialize();
        
        const stats = await searchService.getIndexStats();
        
        res.json({
            searchIndex: stats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Failed to get search stats:', error);
        res.status(500).json({
            error: 'Failed to get search statistics',
            details: error.message
        });
    }
});

// ===============================================
// SYSTEM STATISTICS & MONITORING
// ===============================================

// Get comprehensive system statistics
router.get('/stats', async (req, res) => {
    try {
        const { getDB } = require('../config/database');
        const db = getDB();
        
        const stats = {
            codeSystems: await db.collection('codesystems').countDocuments(),
            valueSets: await db.collection('valuesets').countDocuments(),
            conceptMaps: await db.collection('conceptmaps').countDocuments(),
            auditEvents: await db.collection('audit').countDocuments(),
            lastSync: await getLastSyncTime('icd11-sync'),
            lastNAMASTEUpdate: await getLastSyncTime('namaste-update'),
            systemUptime: process.uptime(),
            timestamp: new Date().toISOString()
        };

        // Get usage statistics for last 30 days
        const usageStats = await db.collection('audit').aggregate([
            {
                $match: {
                    timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: { $dateFromString: { dateString: '$timestamp' } } } },
                    requests: { $sum: 1 },
                    uniqueUsers: { $addToSet: '$userId' }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        stats.usage = {
            daily: usageStats.map(day => ({
                date: day._id,
                requests: day.requests,
                uniqueUsers: day.uniqueUsers.length
            }))
        };

        res.json(stats);

    } catch (error) {
        logger.error('Failed to get system stats:', error);
        res.status(500).json({
            error: 'Failed to get system statistics',
            details: error.message
        });
    }
});

// ===============================================
// AUDIT & COMPLIANCE
// ===============================================

// Get audit logs with filtering
router.get('/audit', async (req, res) => {
    try {
        const { 
            startDate, 
            endDate, 
            userId, 
            category, 
            outcome,
            limit = 100,
            offset = 0 
        } = req.query;

        const { getDB } = require('../config/database');
        const db = getDB();
        
        const filter = {};
        
        if (startDate || endDate) {
            filter.timestamp = {};
            if (startDate) filter.timestamp.$gte = new Date(startDate);
            if (endDate) filter.timestamp.$lte = new Date(endDate);
        }
        
        if (userId) filter.userId = userId;
        if (category) filter.category = category;
        if (outcome) filter.outcome = outcome;

        const auditLogs = await db.collection('audit')
            .find(filter)
            .sort({ timestamp: -1 })
            .skip(parseInt(offset))
            .limit(parseInt(limit))
            .toArray();

        const total = await db.collection('audit').countDocuments(filter);

        res.json({
            auditLogs,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: (parseInt(offset) + parseInt(limit)) < total
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Failed to get audit logs:', error);
        res.status(500).json({
            error: 'Failed to get audit logs',
            details: error.message
        });
    }
});

// Export audit logs for compliance
router.get('/audit/export', async (req, res) => {
    try {
        const { startDate, endDate, format = 'json' } = req.query;

        logger.audit('audit-export-requested', {
            userId: req.auditContext.userId,
            startDate,
            endDate,
            format
        });

        const { getDB } = require('../config/database');
        const db = getDB();
        
        const filter = {};
        if (startDate || endDate) {
            filter.timestamp = {};
            if (startDate) filter.timestamp.$gte = new Date(startDate);
            if (endDate) filter.timestamp.$lte = new Date(endDate);
        }

        const auditLogs = await db.collection('audit')
            .find(filter)
            .sort({ timestamp: -1 })
            .toArray();

        if (format === 'csv') {
            const csv = convertToCSV(auditLogs);
            res.set({
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="audit-export-${new Date().toISOString().split('T')[0]}.csv"`
            });
            res.send(csv);
        } else {
            res.set({
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="audit-export-${new Date().toISOString().split('T')[0]}.json"`
            });
            res.json(auditLogs);
        }

    } catch (error) {
        logger.error('Failed to export audit logs:', error);
        res.status(500).json({
            error: 'Failed to export audit logs',
            details: error.message
        });
    }
});

// ===============================================
// HELPER FUNCTIONS
// ===============================================

async function getLastSyncTime(action) {
    try {
        const { getDB } = require('../config/database');
        const db = getDB();
        
        const lastSync = await db.collection('audit').findOne(
            { action: action },
            { sort: { timestamp: -1 } }
        );
        
        return lastSync ? lastSync.timestamp : null;
    } catch (error) {
        logger.error(`Failed to get last sync time for ${action}:`, error);
        return null;
    }
}

async function validateConceptMap(conceptMap, sampleSize) {
    // Implementation for concept map validation
    // This would check if source and target codes exist in their respective systems
    return {
        totalMappings: conceptMap.group?.reduce((acc, g) => acc + (g.element?.length || 0), 0) || 0,
        validMappings: 0, // Would be calculated through actual validation
        invalidMappings: 0,
        warnings: []
    };
}

function convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                const value = row[header];
                if (typeof value === 'string' && value.includes(',')) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',')
        )
    ].join('\n');
    
    return csvContent;
}

module.exports = router;