// ===============================================
// SEARCH SERVICE (src/services/searchService.js)
// ===============================================

const { getDB, getRedis } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class SearchService {
    constructor() {
        this.db = null;
        this.redis = null;
        this.searchIndex = new Map();
        this.indexVersion = null;
    }

    async initialize() {
        this.db = getDB();
        this.redis = getRedis();
        await this.buildSearchIndex();
    }

    async buildSearchIndex() {
        try {
            logger.info('Building comprehensive search index...');
            
            // Check if cached index exists and is current
            const cachedIndex = await this.redis.get('search-index');
            const cachedVersion = await this.redis.get('search-index-version');
            
            if (cachedIndex && cachedVersion) {
                const indexData = JSON.parse(cachedIndex);
                this.searchIndex = new Map(indexData);
                this.indexVersion = cachedVersion;
                logger.info(`Loaded search index from cache: ${this.searchIndex.size} entries`);
                return;
            }

            // Build fresh index from all CodeSystems
            const codeSystems = await this.db.collection('codesystems').find({}).toArray();
            
            for (const codeSystem of codeSystems) {
                if (codeSystem.concept) {
                    for (const concept of codeSystem.concept) {
                        const searchEntry = this.createSearchEntry(concept, codeSystem);
                        this.searchIndex.set(`${codeSystem.url}|${concept.code}`, searchEntry);
                    }
                }
            }

            // Add concept mappings to search entries
            await this.enhanceWithMappings();

            // Cache the index for 2 hours
            const indexArray = Array.from(this.searchIndex.entries());
            this.indexVersion = new Date().toISOString();
            
            await this.redis.setEx('search-index', 7200, JSON.stringify(indexArray));
            await this.redis.setEx('search-index-version', 7200, this.indexVersion);
            
            logger.info(`Built search index: ${this.searchIndex.size} entries`);
        } catch (error) {
            logger.error('Failed to build search index:', error);
            throw error;
        }
    }

    createSearchEntry(concept, codeSystem) {
        const searchTerms = [
            concept.code.toLowerCase(),
            concept.display.toLowerCase(),
            ...(concept.definition ? [concept.definition.toLowerCase()] : [])
        ];

        // Add property values to search terms
        if (concept.property) {
            concept.property.forEach(prop => {
                if (prop.valueString) {
                    searchTerms.push(prop.valueString.toLowerCase());
                }
                if (prop.valueCode) {
                    searchTerms.push(prop.valueCode.toLowerCase());
                }
            });
        }

        // Extract system type for better categorization
        let systemType = 'unknown';
        if (codeSystem.url.includes('namaste')) {
            systemType = 'namaste';
        } else if (codeSystem.url.includes('traditional-medicine')) {
            systemType = 'icd11-tm2';
        } else if (codeSystem.url.includes('icd')) {
            systemType = 'icd11-bio';
        }

        return {
            system: codeSystem.url,
            systemType: systemType,
            systemName: codeSystem.name,
            code: concept.code,
            display: concept.display,
            definition: concept.definition || '',
            searchTerms: [...new Set(searchTerms)], // Remove duplicates
            properties: concept.property || [],
            mappings: [] // Will be populated by enhanceWithMappings
        };
    }

    async enhanceWithMappings() {
        try {
            const conceptMaps = await this.db.collection('conceptmaps').find({}).toArray();
            
            for (const conceptMap of conceptMaps) {
                if (conceptMap.group) {
                    for (const group of conceptMap.group) {
                        if (group.element) {
                            for (const element of group.element) {
                                const sourceKey = `${group.source}|${element.code}`;
                                const sourceEntry = this.searchIndex.get(sourceKey);
                                
                                if (sourceEntry && element.target) {
                                    sourceEntry.mappings = element.target.map(target => ({
                                        targetSystem: group.target,
                                        targetCode: target.code,
                                        targetDisplay: target.display,
                                        equivalence: target.equivalence,
                                        comment: target.comment
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            logger.error('Failed to enhance search index with mappings:', error);
        }
    }

    async searchTerms(query, options = {}) {
        try {
            const {
                systemFilter = null,
                systemType = null,
                includeMapppings = true,
                limit = 20,
                fuzzy = false
            } = options;

            const searchTerm = query.toLowerCase().trim();
            const results = [];

            if (searchTerm.length < 2) {
                return this.createEmptySearchBundle('Query too short');
            }

            for (const [key, entry] of this.searchIndex) {
                // Apply system filter if specified
                if (systemFilter && !entry.system.includes(systemFilter)) {
                    continue;
                }

                // Apply system type filter
                if (systemType && entry.systemType !== systemType) {
                    continue;
                }

                // Check if any search term matches
                const score = this.calculateRelevanceScore(searchTerm, entry, fuzzy);
                
                if (score > 0) {
                    results.push({ ...entry, score });
                }

                if (results.length >= limit * 3) {
                    break; // Get more than needed for better sorting
                }
            }

            // Sort by relevance and limit results
            results.sort((a, b) => b.score - a.score);
            const limitedResults = results.slice(0, limit);

            return this.createSearchBundle(limitedResults, query, results.length);

        } catch (error) {
            logger.error('Search operation failed:', error);
            throw error;
        }
    }

    calculateRelevanceScore(searchTerm, entry, fuzzy = false) {
        let score = 0;

        // Exact code match gets highest score
        if (entry.code.toLowerCase() === searchTerm) {
            score += 100;
        } else if (entry.code.toLowerCase().includes(searchTerm)) {
            score += 50;
        }

        // Display name matches
        if (entry.display.toLowerCase() === searchTerm) {
            score += 80;
        } else if (entry.display.toLowerCase().startsWith(searchTerm)) {
            score += 60;
        } else if (entry.display.toLowerCase().includes(searchTerm)) {
            score += 40;
        }

        // Definition matches
        if (entry.definition && entry.definition.toLowerCase().includes(searchTerm)) {
            score += 20;
        }

        // Property matches
        entry.searchTerms.forEach(term => {
            if (term.includes(searchTerm) && 
                term !== entry.code.toLowerCase() && 
                term !== entry.display.toLowerCase()) {
                score += 10;
            }
        });

        // Fuzzy matching for spelling variations
        if (fuzzy && score === 0) {
            const fuzzyScore = this.calculateFuzzyScore(searchTerm, entry);
            if (fuzzyScore > 0.7) {
                score += Math.floor(fuzzyScore * 30);
            }
        }

        // Boost score for NAMASTE codes (priority in traditional medicine context)
        if (entry.systemType === 'namaste') {
            score += 5;
        }

        return score;
    }

    calculateFuzzyScore(searchTerm, entry) {
        // Simple Levenshtein distance-based fuzzy matching
        const targets = [entry.display.toLowerCase(), entry.code.toLowerCase()];
        let maxScore = 0;

        for (const target of targets) {
            const distance = this.levenshteinDistance(searchTerm, target);
            const maxLength = Math.max(searchTerm.length, target.length);
            const similarity = 1 - (distance / maxLength);
            maxScore = Math.max(maxScore, similarity);
        }

        return maxScore;
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    createSearchBundle(results, query, total) {
        return {
            resourceType: 'Bundle',
            id: uuidv4(),
            meta: {
                lastUpdated: new Date().toISOString(),
                profile: ['http://terminology.ayush.gov.in/StructureDefinition/search-result-bundle']
            },
            type: 'searchset',
            total: total,
            link: [{
                relation: 'self',
                url: `ValueSet/search?q=${encodeURIComponent(query)}`
            }],
            entry: results.map(result => ({
                fullUrl: `${result.system}/${result.code}`,
                resource: {
                    resourceType: 'Basic',
                    id: `search-result-${uuidv4()}`,
                    meta: {
                        profile: ['http://terminology.ayush.gov.in/StructureDefinition/search-result']
                    },
                    code: {
                        coding: [{
                            system: result.system,
                            code: result.code,
                            display: result.display
                        }]
                    },
                    subject: {
                        reference: `CodeSystem/${result.systemName}`
                    },
                    extension: [
                        {
                            url: 'http://terminology.ayush.gov.in/StructureDefinition/search-metadata',
                            extension: [
                                {
                                    url: 'definition',
                                    valueString: result.definition
                                },
                                {
                                    url: 'relevanceScore',
                                    valueDecimal: result.score
                                },
                                {
                                    url: 'systemType',
                                    valueString: result.systemType
                                }
                            ]
                        },
                        ...(result.mappings.length > 0 ? [{
                            url: 'http://terminology.ayush.gov.in/StructureDefinition/concept-mappings',
                            extension: result.mappings.map(mapping => ({
                                url: 'mapping',
                                extension: [
                                    {
                                        url: 'targetSystem',
                                        valueUri: mapping.targetSystem
                                    },
                                    {
                                        url: 'targetCode',
                                        valueString: mapping.targetCode
                                    },
                                    {
                                        url: 'targetDisplay',
                                        valueString: mapping.targetDisplay
                                    },
                                    {
                                        url: 'equivalence',
                                        valueString: mapping.equivalence
                                    }
                                ]
                            }))
                        }] : [])
                    ]
                },
                search: {
                    mode: 'match',
                    score: result.score / 100
                }
            }))
        };
    }

    createEmptySearchBundle(message) {
        return {
            resourceType: 'Bundle',
            id: uuidv4(),
            type: 'searchset',
            total: 0,
            entry: [],
            issue: [{
                severity: 'information',
                code: 'informational',
                details: { text: message }
            }]
        };
    }

    async searchByCategory(category, systemType = null, limit = 50) {
        try {
            const results = [];

            for (const [key, entry] of this.searchIndex) {
                // Apply system type filter
                if (systemType && entry.systemType !== systemType) {
                    continue;
                }

                // Check if category matches
                const categoryMatch = entry.properties.some(prop => 
                    prop.code === 'category' && 
                    prop.valueString?.toLowerCase().includes(category.toLowerCase())
                );

                if (categoryMatch) {
                    results.push(entry);
                }

                if (results.length >= limit) {
                    break;
                }
            }

            return this.createSearchBundle(results, `category:${category}`, results.length);

        } catch (error) {
            logger.error('Category search failed:', error);
            throw error;
        }
    }

    async searchWithDualCoding(query, limit = 20) {
        try {
            // Search for NAMASTE codes first
            const namasteResults = await this.searchTerms(query, {
                systemType: 'namaste',
                limit: limit
            });

            const enhancedResults = [];

            for (const entry of namasteResults.entry) {
                const resource = entry.resource;
                const coding = resource.code.coding[0];

                // Find mappings for this NAMASTE code
                const mappings = await this.findMappingsForCode(coding.system, coding.code);

                enhancedResults.push({
                    namaste: {
                        system: coding.system,
                        code: coding.code,
                        display: coding.display
                    },
                    icd11TM2: mappings.tm2 || null,
                    icd11Bio: mappings.bio || null,
                    relevanceScore: entry.search.score
                });
            }

            return {
                resourceType: 'Bundle',
                id: uuidv4(),
                type: 'searchset',
                total: enhancedResults.length,
                entry: enhancedResults.map(result => ({
                    resource: {
                        resourceType: 'Parameters',
                        parameter: [
                            {
                                name: 'namaste-coding',
                                valueCoding: result.namaste
                            },
                            ...(result.icd11TM2 ? [{
                                name: 'icd11-tm2-coding',
                                valueCoding: result.icd11TM2
                            }] : []),
                            ...(result.icd11Bio ? [{
                                name: 'icd11-bio-coding',
                                valueCoding: result.icd11Bio
                            }] : []),
                            {
                                name: 'relevance-score',
                                valueDecimal: result.relevanceScore
                            }
                        ]
                    }
                }))
            };

        } catch (error) {
            logger.error('Dual coding search failed:', error);
            throw error;
        }
    }

    async findMappingsForCode(sourceSystem, sourceCode) {
        try {
            const mappings = { tm2: null, bio: null };

            const conceptMaps = await this.db.collection('conceptmaps').find({
                sourceUri: sourceSystem
            }).toArray();

            for (const conceptMap of conceptMaps) {
                if (conceptMap.group) {
                    for (const group of conceptMap.group) {
                        if (group.source === sourceSystem && group.element) {
                            const element = group.element.find(e => e.code === sourceCode);
                            
                            if (element && element.target && element.target.length > 0) {
                                const target = element.target[0];
                                
                                if (group.target.includes('traditional-medicine')) {
                                    mappings.tm2 = {
                                        system: group.target,
                                        code: target.code,
                                        display: target.display
                                    };
                                } else if (group.target.includes('mms')) {
                                    mappings.bio = {
                                        system: group.target,
                                        code: target.code,
                                        display: target.display
                                    };
                                }
                            }
                        }
                    }
                }
            }

            return mappings;

        } catch (error) {
            logger.error('Failed to find mappings:', error);
            return { tm2: null, bio: null };
        }
    }

    async refreshIndex() {
        logger.info('Refreshing search index...');
        await this.redis.del('search-index');
        await this.redis.del('search-index-version');
        this.searchIndex.clear();
        await this.buildSearchIndex();
    }

    async getIndexStats() {
        try {
            const stats = {
                totalEntries: this.searchIndex.size,
                indexVersion: this.indexVersion,
                systemBreakdown: {},
                lastRefresh: null
            };

            // Count entries by system type
            for (const [key, entry] of this.searchIndex) {
                stats.systemBreakdown[entry.systemType] = 
                    (stats.systemBreakdown[entry.systemType] || 0) + 1;
            }

            // Get last refresh time from Redis
            const lastRefresh = await this.redis.get('search-index-version');
            if (lastRefresh) {
                stats.lastRefresh = lastRefresh;
            }

            return stats;

        } catch (error) {
            logger.error('Failed to get index stats:', error);
            throw error;
        }
    }

    async validateSearchHealth() {
        try {
            const health = {
                status: 'healthy',
                checks: {
                    indexLoaded: this.searchIndex.size > 0,
                    redisConnected: false,
                    databaseConnected: false
                },
                details: {}
            };

            // Check Redis connection
            try {
                await this.redis.ping();
                health.checks.redisConnected = true;
            } catch (error) {
                health.checks.redisConnected = false;
                health.details.redisError = error.message;
            }

            // Check database connection
            try {
                await this.db.collection('codesystems').countDocuments({}, { limit: 1 });
                health.checks.databaseConnected = true;
            } catch (error) {
                health.checks.databaseConnected = false;
                health.details.databaseError = error.message;
            }

            // Overall health status
            if (!health.checks.indexLoaded || !health.checks.redisConnected || !health.checks.databaseConnected) {
                health.status = 'unhealthy';
            }

            return health;

        } catch (error) {
            logger.error('Search health check failed:', error);
            return {
                status: 'error',
                error: error.message
            };
        }
    }
}

module.exports = SearchService;