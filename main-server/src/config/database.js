// ===============================================
// DATABASE CONFIGURATION (src/config/database.js)
// ===============================================

const { MongoClient } = require('mongodb');
const redis = require('redis');
const logger = require('../utils/logger');

let mongoClient;
let mongoDb;
let redisClient;

const connectDB = async () => {
    try {
        // MongoDB connection with enhanced configuration
        const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/namaste-fhir';
        const mongoOptions = {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4, // Use IPv4, skip trying IPv6
            retryWrites: true,
            writeConcern: {
                w: 'majority'
            }
        };

        logger.info(`Connecting to MongoDB: ${mongoUrl.replace(/\/\/.*@/, '//***:***@')}`);
        
        mongoClient = new MongoClient(mongoUrl, mongoOptions);
        await mongoClient.connect();
        mongoDb = mongoClient.db();
        
        // Test the connection
        await mongoDb.admin().ping();
        
        // Create indexes
        await createIndexes();
        
        logger.info('MongoDB connected successfully');

        // Redis connection for caching
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        const redisOptions = {
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries >= 3) {
                        logger.error('Redis reconnection failed after 3 attempts');
                        return false;
                    }
                    return Math.min(retries * 50, 500);
                }
            },
            // Redis configuration for terminology caching
            database: parseInt(process.env.REDIS_DB || '0'),
            lazyConnect: true
        };

        logger.info(`Connecting to Redis: ${redisUrl.replace(/\/\/.*@/, '//***:***@')}`);
        
        redisClient = redis.createClient({
            url: redisUrl,
            ...redisOptions
        });

        // Redis event handlers
        redisClient.on('error', (err) => {
            logger.error('Redis client error:', err);
        });

        redisClient.on('connect', () => {
            logger.info('Redis client connected');
        });

        redisClient.on('ready', () => {
            logger.info('Redis client ready');
        });

        redisClient.on('end', () => {
            logger.warn('Redis client connection ended');
        });

        await redisClient.connect();
        
        // Test Redis connection
        await redisClient.ping();
        
        logger.info('Redis connected successfully');

    } catch (error) {
        logger.error('Database connection failed:', error);
        throw error;
    }
};

const createIndexes = async () => {
    try {
        logger.info('Creating database indexes...');
        
        const collections = {
            codesystems: [
                { 'url': 1 },  // Primary identifier
                { 'id': 1 },   // FHIR ID
                { 'name': 1 }, // CodeSystem name
                { 'version': 1 }, // Version tracking
                { 'status': 1 }, // Active/inactive
                { 'concept.code': 1 }, // Individual concept codes
                { 'concept.display': 'text' }, // Text search on display names
                { 'concept.definition': 'text' }, // Text search on definitions
                // Compound indexes for common queries
                { 'url': 1, 'version': 1 },
                { 'concept.code': 1, 'url': 1 },
                // Property-based searches
                { 'concept.property.code': 1, 'concept.property.valueString': 1 }
            ],
            valuesets: [
                { 'url': 1 },  // Primary identifier
                { 'id': 1 },   // FHIR ID
                { 'name': 1 }, // ValueSet name
                { 'version': 1 }, // Version tracking
                { 'status': 1 }, // Active/inactive
                { 'compose.include.system': 1 }, // Referenced CodeSystems
                // Compound indexes
                { 'url': 1, 'version': 1 },
                { 'compose.include.system': 1, 'status': 1 }
            ],
            conceptmaps: [
                { 'url': 1 },  // Primary identifier
                { 'id': 1 },   // FHIR ID
                { 'sourceUri': 1 }, // Source CodeSystem
                { 'targetUri': 1 }, // Target CodeSystem
                { 'version': 1 }, // Version tracking
                { 'status': 1 }, // Active/inactive
                // Mapping-specific indexes
                { 'group.source': 1, 'group.target': 1 },
                { 'group.element.code': 1 }, // Source codes
                { 'group.element.target.code': 1 }, // Target codes
                // Compound indexes for translation queries
                { 'sourceUri': 1, 'targetUri': 1, 'status': 1 },
                { 'group.source': 1, 'group.element.code': 1 }
            ],
            audit: [
                { 'timestamp': 1 }, // Time-based queries
                { 'timestamp': -1 }, // Reverse chronological
                { 'userId': 1 }, // User activity tracking
                { 'userType': 1 }, // User type filtering
                { 'action': 1 }, // Action type filtering
                { 'resourceType': 1 }, // Resource type filtering
                { 'outcome': 1 }, // Success/failure filtering
                // Compound indexes for common audit queries
                { 'userId': 1, 'timestamp': -1 },
                { 'action': 1, 'timestamp': -1 },
                { 'outcome': 1, 'timestamp': -1 },
                // TTL index for automatic cleanup (90 days)
                { 'timestamp': 1, expireAfterSeconds: 90 * 24 * 60 * 60 }
            ],
            // Search optimization collection for pre-computed search data
            searchindex: [
                { 'searchTerms': 'text' }, // Full-text search
                { 'systemType': 1 }, // Filter by system type
                { 'category': 1 }, // Category-based filtering
                { 'lastUpdated': 1 }, // Cache invalidation
                // Compound indexes for filtered searches
                { 'systemType': 1, 'searchTerms': 'text' },
                { 'category': 1, 'searchTerms': 'text' }
            ],
            // Session management for ABHA tokens
            sessions: [
                { 'tokenHash': 1 }, // Token lookup
                { 'userId': 1 }, // User session tracking
                { 'createdAt': 1, expireAfterSeconds: 3600 }, // 1 hour TTL
                { 'lastAccessed': 1 } // Session activity
            ]
        };

        for (const [collectionName, indexes] of Object.entries(collections)) {
            logger.info(`Creating indexes for collection: ${collectionName}`);
            
            for (const index of indexes) {
                try {
                    const options = {};
                    
                    // Handle special index options
                    if (index.expireAfterSeconds) {
                        options.expireAfterSeconds = index.expireAfterSeconds;
                        delete index.expireAfterSeconds;
                    }
                    
                    // Create background indexes to avoid blocking
                    options.background = true;
                    
                    await mongoDb.collection(collectionName).createIndex(index, options);
                } catch (indexError) {
                    // Log index creation errors but don't fail completely
                    logger.warn(`Failed to create index ${JSON.stringify(index)} on ${collectionName}:`, indexError.message);
                }
            }
        }

        logger.info('Database indexes created successfully');
        
    } catch (error) {
        logger.error('Index creation failed:', error);
        // Don't throw here - indexes are optimization, not critical for startup
    }
};

const getDB = () => {
    if (!mongoDb) {
        throw new Error('MongoDB not connected. Call connectDB() first.');
    }
    return mongoDb;
};

const getRedis = () => {
    if (!redisClient) {
        throw new Error('Redis not connected. Call connectDB() first.');
    }
    return redisClient;
};

const closeConnections = async () => {
    logger.info('Closing database connections...');
    
    try {
        if (redisClient) {
            await redisClient.disconnect();
            logger.info('Redis connection closed');
        }
    } catch (error) {
        logger.error('Error closing Redis connection:', error);
    }

    try {
        if (mongoClient) {
            await mongoClient.close();
            logger.info('MongoDB connection closed');
        }
    } catch (error) {
        logger.error('Error closing MongoDB connection:', error);
    }
};

// Health check functions
const checkMongoHealth = async () => {
    try {
        if (!mongoDb) return { status: 'disconnected' };
        
        const start = Date.now();
        await mongoDb.admin().ping();
        const responseTime = Date.now() - start;
        
        const stats = await mongoDb.stats();
        
        return {
            status: 'connected',
            responseTime: `${responseTime}ms`,
            collections: stats.collections,
            dataSize: Math.round(stats.dataSize / 1024 / 1024), // MB
            indexSize: Math.round(stats.indexSize / 1024 / 1024) // MB
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
};

const checkRedisHealth = async () => {
    try {
        if (!redisClient) return { status: 'disconnected' };
        
        const start = Date.now();
        await redisClient.ping();
        const responseTime = Date.now() - start;
        
        const info = await redisClient.info('memory');
        const memoryMatch = info.match(/used_memory_human:(.+)/);
        const memory = memoryMatch ? memoryMatch[1].trim() : 'unknown';
        
        return {
            status: 'connected',
            responseTime: `${responseTime}ms`,
            memory: memory
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
};

// Graceful shutdown handler
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await closeConnections();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await closeConnections();
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception:', error);
    await closeConnections();
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    await closeConnections();
    process.exit(1);
});

module.exports = {
    connectDB,
    getDB,
    getRedis,
    closeConnections,
    checkMongoHealth,
    checkRedisHealth,
    createIndexes
};