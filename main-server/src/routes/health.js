// ===============================================
// HEALTH ROUTES (src/routes/health.js)
// ===============================================

const express = require('express');
const router = express.Router();
const { getDB, getRedis } = require('../config/database');
const SearchService = require('../services/searchService');
const NAMASTEService = require('../services/namasteService');
const ICD11Service = require('../services/icd11Service');
const logger = require('../utils/logger');

// Basic health check endpoint (no auth required)
router.get('/', async (req, res) => {
    try {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'NAMASTE FHIR Terminology Server',
            version: '1.0.0',
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development'
        };

        // Quick database ping
        try {
            const db = getDB();
            await db.admin().ping();
            health.database = 'connected';
        } catch (error) {
            health.database = 'disconnected';
            health.status = 'unhealthy';
        }

        // Quick Redis ping
        try {
            const redis = getRedis();
            await redis.ping();
            health.cache = 'connected';
        } catch (error) {
            health.cache = 'disconnected';
            health.status = 'degraded';
        }

        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);

    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Detailed health check with component status
router.get('/detailed', async (req, res) => {
    try {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'NAMASTE FHIR Terminology Server',
            version: '1.0.0',
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development',
            components: {}
        };

        // Database health
        try {
            const db = getDB();
            const startTime = Date.now();
            await db.admin().ping();
            const responseTime = Date.now() - startTime;
            
            const stats = await db.stats();
            
            health.components.database = {
                status: 'healthy',
                responseTime: `${responseTime}ms`,
                collections: {
                    codesystems: await db.collection('codesystems').countDocuments(),
                    valuesets: await db.collection('valuesets').countDocuments(),
                    conceptmaps: await db.collection('conceptmaps').countDocuments(),
                    audit: await db.collection('audit').countDocuments()
                },
                size: `${Math.round(stats.dataSize / 1024 / 1024)}MB`
            };
        } catch (error) {
            health.components.database = {
                status: 'unhealthy',
                error: error.message
            };
            health.status = 'unhealthy';
        }

        // Redis health
        try {
            const redis = getRedis();
            const startTime = Date.now();
            await redis.ping();
            const responseTime = Date.now() - startTime;
            
            const info = await redis.info('memory');
            const memoryMatch = info.match(/used_memory_human:(.+)/);
            const memory = memoryMatch ? memoryMatch[1].trim() : 'unknown';
            
            health.components.cache = {
                status: 'healthy',
                responseTime: `${responseTime}ms`,
                memory: memory
            };
        } catch (error) {
            health.components.cache = {
                status: 'unhealthy',
                error: error.message
            };
            if (health.status === 'healthy') {
                health.status = 'degraded';
            }
        }

        // Search service health
        try {
            const searchService = new SearchService();
            await searchService.initialize();
            const searchHealth = await searchService.validateSearchHealth();
            health.components.search = searchHealth;
            
            if (searchHealth.status !== 'healthy') {
                health.status = 'degraded';
            }
        } catch (error) {
            health.components.search = {
                status: 'unhealthy',
                error: error.message
            };
            health.status = 'degraded';
        }

        // NAMASTE service health
        try {
            const namasteService = new NAMASTEService();
            await namasteService.initialize();
            const stats = await namasteService.getSystemStats();
            
            health.components.namaste = {
                status: stats ? 'healthy' : 'degraded',
                concepts: stats?.totalConcepts || 0,
                systems: Object.keys(stats?.systems || {}).length
            };
        } catch (error) {
            health.components.namaste = {
                status: 'unhealthy',
                error: error.message
            };
        }

        // ICD-11 service health
        try {
            const icd11Service = new ICD11Service();
            await icd11Service.initialize();
            const codeSystems = await icd11Service.getAvailableCodeSystems();
            
            health.components.icd11 = {
                status: 'healthy',
                codeSystems: codeSystems.length,
                tm2Available: codeSystems.some(cs => cs.url.includes('traditional-medicine')),
                biomedicineAvailable: codeSystems.some(cs => cs.url.includes('mms') && !cs.url.includes('traditional-medicine'))
            };
        } catch (error) {
            health.components.icd11 = {
                status: 'degraded',
                error: error.message
            };
        }

        const statusCode = health.status === 'healthy' ? 200 : 
                          health.status === 'degraded' ? 200 : 503;
        
        res.status(statusCode).json(health);

    } catch (error) {
        logger.error('Detailed health check failed:', error);
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Readiness probe for Kubernetes
router.get('/ready', async (req, res) => {
    try {
        // Check if essential services are ready
        const checks = {
            database: false,
            namaste: false,
            search: false
        };

        // Database readiness
        try {
            const db = getDB();
            const namasteCS = await db.collection('codesystems').findOne({
                url: 'http://terminology.ayush.gov.in/CodeSystem/namaste'
            });
            checks.database = !!namasteCS;
        } catch (error) {
            logger.warn('Database readiness check failed:', error.message);
        }

        // NAMASTE service readiness
        try {
            const namasteService = new NAMASTEService();
            await namasteService.initialize();
            const stats = await namasteService.getSystemStats();
            checks.namaste = stats && stats.totalConcepts > 0;
        } catch (error) {
            logger.warn('NAMASTE service readiness check failed:', error.message);
        }

        // Search service readiness
        try {
            const searchService = new SearchService();
            await searchService.initialize();
            const stats = await searchService.getIndexStats();
            checks.search = stats && stats.totalEntries > 0;
        } catch (error) {
            logger.warn('Search service readiness check failed:', error.message);
        }

        const ready = Object.values(checks).every(Boolean);
        const statusCode = ready ? 200 : 503;

        res.status(statusCode).json({
            ready: ready,
            timestamp: new Date().toISOString(),
            checks: checks
        });

    } catch (error) {
        logger.error('Readiness check failed:', error);
        res.status(503).json({
            ready: false,
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Liveness probe for Kubernetes
router.get('/live', (req, res) => {
    // Simple liveness check - if we can respond, we're alive
    res.json({
        alive: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// System metrics endpoint
router.get('/metrics', async (req, res) => {
    try {
        const metrics = {
            timestamp: new Date().toISOString(),
            system: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
                platform: process.platform,
                nodeVersion: process.version
            },
            database: {},
            cache: {},
            terminology: {}
        };

        // Database metrics
        try {
            const db = getDB();
            const stats = await db.stats();
            metrics.database = {
                collections: stats.collections,
                dataSize: stats.dataSize,
                indexSize: stats.indexSize,
                storageSize: stats.storageSize
            };
        } catch (error) {
            metrics.database.error = error.message;
        }

        // Cache metrics
        try {
            const redis = getRedis();
            const info = await redis.info();
            const lines = info.split('\r\n');
            
            metrics.cache = {};
            lines.forEach(line => {
                if (line.includes(':')) {
                    const [key, value] = line.split(':');
                    if (key.startsWith('used_memory') || key.startsWith('connected_clients') || 
                        key.startsWith('total_commands') || key.startsWith('keyspace_hits')) {
                        metrics.cache[key] = value;
                    }
                }
            });
        } catch (error) {
            metrics.cache.error = error.message;
        }

        // Terminology metrics
        try {
            const db = getDB();
            metrics.terminology = {
                codeSystems: await db.collection('codesystems').countDocuments(),
                valueSets: await db.collection('valuesets').countDocuments(),
                conceptMaps: await db.collection('conceptmaps').countDocuments(),
                auditEvents: await db.collection('audit').countDocuments(),
                recentActivity: await db.collection('audit').countDocuments({
                    timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
                })
            };
        } catch (error) {
            metrics.terminology.error = error.message;
        }

        res.json(metrics);

    } catch (error) {
        logger.error('Metrics collection failed:', error);
        res.status(500).json({
            error: 'Failed to collect metrics',
            timestamp: new Date().toISOString()
        });
    }
});

// Service dependencies status
router.get('/dependencies', async (req, res) => {
    try {
        const dependencies = {
            timestamp: new Date().toISOString(),
            internal: {},
            external: {}
        };

        // Internal dependencies
        dependencies.internal.database = {
            name: 'MongoDB',
            required: true,
            status: 'unknown'
        };

        dependencies.internal.cache = {
            name: 'Redis',
            required: false,
            status: 'unknown'
        };

        // Test internal dependencies
        try {
            const db = getDB();
            await db.admin().ping();
            dependencies.internal.database.status = 'healthy';
        } catch (error) {
            dependencies.internal.database.status = 'unhealthy';
            dependencies.internal.database.error = error.message;
        }

        try {
            const redis = getRedis();
            await redis.ping();
            dependencies.internal.cache.status = 'healthy';
        } catch (error) {
            dependencies.internal.cache.status = 'unhealthy';
            dependencies.internal.cache.error = error.message;
        }

        // External dependencies
        dependencies.external.icd11api = {
            name: 'WHO ICD-11 API',
            required: false,
            status: 'unknown',
            url: process.env.ICD11_API_URL || 'https://id.who.int/icd/release/11/2023-01'
        };

        dependencies.external.abha = {
            name: 'ABHA Authentication',
            required: true,
            status: 'unknown',
            url: process.env.ABHA_BASE_URL || 'https://abhasbx.abdm.gov.in'
        };

        // Test external dependencies (with timeout)
        const testPromises = [];

        // Test ICD-11 API
        testPromises.push(
            Promise.race([
                fetch(dependencies.external.icd11api.url + '/mms', { method: 'HEAD' })
                    .then(() => 'healthy')
                    .catch(() => 'unreachable'),
                new Promise(resolve => setTimeout(() => resolve('timeout'), 5000))
            ]).then(status => {
                dependencies.external.icd11api.status = status;
            })
        );

        // Test ABHA endpoint
        testPromises.push(
            Promise.race([
                fetch(dependencies.external.abha.url + '/health', { method: 'HEAD' })
                    .then(() => 'healthy')
                    .catch(() => 'unreachable'),
                new Promise(resolve => setTimeout(() => resolve('timeout'), 5000))
            ]).then(status => {
                dependencies.external.abha.status = status;
            })
        );

        await Promise.all(testPromises);

        res.json(dependencies);

    } catch (error) {
        logger.error('Dependencies check failed:', error);
        res.status(500).json({
            error: 'Failed to check dependencies',
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;