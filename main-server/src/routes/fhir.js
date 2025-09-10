// ===============================================
// ENHANCED FHIR ROUTES WITH VALUESET SUPPORT (src/routes/fhir.js)
// ===============================================

const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const NAMASTEService = require('../services/namasteService');
const ICD11Service = require('../services/icd11Service');
const FHIRService = require('../services/fhirService');
const SearchService = require('../services/searchService');
const { searchLimiter, bundleLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');

// Initialize services
const namasteService = new NAMASTEService();
const icd11Service = new ICD11Service();
const fhirService = new FHIRService();
const searchService = new SearchService();

// ValueSet generator helper
class ValueSetGenerator {
    constructor(db) {
        this.db = db;
    }

    // Sanitize ID to be FHIR-compliant
    sanitizeId(input) {
        return input
            .toLowerCase()
            .replace(/[^a-z0-9\-\.]/g, '-')  // Replace invalid chars with hyphens
            .replace(/-+/g, '-')             // Replace multiple hyphens with single
            .replace(/^-|-$/g, '')           // Remove leading/trailing hyphens
            .substring(0, 64);               // Limit length to 64 chars
    }

    // Clean up system names for better categorization
    cleanSystemName(systemName) {
        if (!systemName || systemName === 'Unknown') {
            return 'uncategorized';
        }
        
        // Remove "Note:" prefixes and extract meaningful categories
        const cleaned = systemName
            .replace(/^note:\s*also\s*classif?ied\s*under\s*/i, '')
            .replace(/\[.*?\]$/g, '')        // Remove bracketed suffixes
            .trim();
            
        return cleaned || 'uncategorized';
    }

    // Create meaningful categories from NAMASTE data
    extractMedicalCategories(concepts) {
        const categories = new Map();
        
        for (const concept of concepts) {
            const display = concept.display || '';
            const definition = concept.definition || '';
            const systemName = this.cleanSystemName(concept.system);
            
            // Categorize by medical domain
            const category = this.categorizeByMedicalDomain(display, definition, systemName);
            
            if (!categories.has(category)) {
                categories.set(category, []);
            }
            categories.get(category).push(concept);
        }
        
        return categories;
    }

    categorizeByMedicalDomain(display, definition, systemName) {
        const text = (display + ' ' + definition + ' ' + systemName).toLowerCase();
        
        // Respiratory conditions
        if (text.includes('respiratory') || text.includes('lung') || text.includes('breath') || 
            text.includes('cough') || text.includes('asthma') || text.includes('prāṇa')) {
            return 'respiratory-disorders';
        }
        
        // Digestive conditions
        if (text.includes('digestive') || text.includes('gastro') || text.includes('stomach') ||
            text.includes('intestin') || text.includes('anna') || text.includes('agni')) {
            return 'digestive-disorders';
        }
        
        // Circulatory/Blood conditions
        if (text.includes('blood') || text.includes('cardiac') || text.includes('heart') ||
            text.includes('circulation') || text.includes('rakta') || text.includes('śōṇita')) {
            return 'circulatory-disorders';
        }
        
        // Nervous system/Mental conditions
        if (text.includes('mental') || text.includes('nervous') || text.includes('brain') ||
            text.includes('mind') || text.includes('manas') || text.includes('buddhi')) {
            return 'neurological-disorders';
        }
        
        // Skin conditions
        if (text.includes('skin') || text.includes('dermat') || text.includes('rash') ||
            text.includes('tvak') || text.includes('kuṣṭha')) {
            return 'dermatological-disorders';
        }
        
        // Musculoskeletal
        if (text.includes('bone') || text.includes('joint') || text.includes('muscle') ||
            text.includes('asthi') || text.includes('sandhi')) {
            return 'musculoskeletal-disorders';
        }
        
        // Gynecological/Reproductive
        if (text.includes('gynec') || text.includes('reproductive') || text.includes('menstr') ||
            text.includes('strī') || text.includes('yoni')) {
            return 'reproductive-disorders';
        }
        
        // Pediatric
        if (text.includes('child') || text.includes('pediatric') || text.includes('infant') ||
            text.includes('bāla')) {
            return 'pediatric-disorders';
        }
        
        // Eye conditions
        if (text.includes('eye') || text.includes('vision') || text.includes('netra') ||
            text.includes('akṣi')) {
            return 'ophthalmological-disorders';
        }
        
        // Ear/Throat conditions
        if (text.includes('ear') || text.includes('throat') || text.includes('hearing') ||
            text.includes('karṇa') || text.includes('kaṇṭha')) {
            return 'ent-disorders';
        }
        
        return 'general-conditions';
    }

    async generateValueSetsFromCodeSystems() {
        try {
            logger.info('Generating improved ValueSets from CodeSystems...');
            
            // Clear existing problematic ValueSets
            await this.db.collection('valuesets').deleteMany({
                id: { $regex: /^namaste-note:/i }
            });
            
            // Get NAMASTE CodeSystem
            const namasteCodeSystem = await this.db.collection('codesystems').findOne({
                url: 'http://terminology.ayush.gov.in/CodeSystem/namaste'
            });
            
            if (!namasteCodeSystem || !namasteCodeSystem.concept) {
                logger.warn('NAMASTE CodeSystem not found or empty');
                return;
            }
            
            // Create main NAMASTE ValueSet
            await this.createMainNAMASTEValueSet(namasteCodeSystem);
            
            // Create category-based ValueSets
            await this.createCategoryValueSets(namasteCodeSystem.concept);
            
            // Create ICD-11 ValueSets
            await this.createICD11ValueSets();
            
            // Create combined ValueSets
            await this.createCombinedValueSets();
            
            logger.info('Improved ValueSet generation completed');
            
        } catch (error) {
            logger.error('ValueSet generation failed:', error);
            throw error;
        }
    }

    async createMainNAMASTEValueSet(codeSystem) {
        const valueSet = {
            resourceType: 'ValueSet',
            id: 'namaste-all-conditions',
            url: 'http://terminology.ayush.gov.in/ValueSet/namaste-all-conditions',
            version: '1.0.0',
            name: 'NAMASTEAllConditions',
            title: 'All NAMASTE Traditional Medicine Conditions',
            status: 'active',
            experimental: false,
            date: new Date().toISOString(),
            publisher: 'Ministry of Ayush, Government of India',
            description: 'Complete set of NAMASTE codes for all traditional medicine conditions across all systems (Ayurveda, Yoga, Unani, Siddha, Homeopathy)',
            jurisdiction: [{
                coding: [{
                    system: 'urn:iso:std:iso:3166',
                    code: 'IN',
                    display: 'India'
                }]
            }],
            compose: {
                include: [{
                    system: 'http://terminology.ayush.gov.in/CodeSystem/namaste'
                }]
            },
            expansion: {
                identifier: require('uuid').v4(),
                timestamp: new Date().toISOString(),
                total: codeSystem.concept.length,
                contains: codeSystem.concept.map(concept => ({
                    system: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
                    code: concept.code,
                    display: concept.display,
                    definition: concept.definition
                }))
            }
        };

        await this.db.collection('valuesets').replaceOne(
            { url: valueSet.url },
            valueSet,
            { upsert: true }
        );

        logger.info(`Created main NAMASTE ValueSet with ${codeSystem.concept.length} concepts`);
    }

    async createCategoryValueSets(concepts) {
        const categories = this.extractMedicalCategories(concepts);
        
        for (const [categoryName, categoryConcepts] of categories) {
            if (categoryConcepts.length === 0) continue;
            
            const valueSet = {
                resourceType: 'ValueSet',
                id: `namaste-${categoryName}`,
                url: `http://terminology.ayush.gov.in/ValueSet/namaste-${categoryName}`,
                version: '1.0.0',
                name: `NAMASTE${categoryName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`,
                title: `NAMASTE ${categoryName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
                status: 'active',
                experimental: false,
                date: new Date().toISOString(),
                publisher: 'Ministry of Ayush, Government of India',
                description: `NAMASTE traditional medicine codes for ${categoryName.replace(/-/g, ' ')}`,
                jurisdiction: [{
                    coding: [{
                        system: 'urn:iso:std:iso:3166',
                        code: 'IN',
                        display: 'India'
                    }]
                }],
                compose: {
                    include: [{
                        system: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
                        concept: categoryConcepts.map(c => ({
                            code: c.code,
                            display: c.display
                        }))
                    }]
                },
                expansion: {
                    identifier: require('uuid').v4(),
                    timestamp: new Date().toISOString(),
                    total: categoryConcepts.length,
                    contains: categoryConcepts.map(concept => ({
                        system: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
                        code: concept.code,
                        display: concept.display,
                        definition: concept.definition
                    }))
                }
            };

            await this.db.collection('valuesets').replaceOne(
                { url: valueSet.url },
                valueSet,
                { upsert: true }
            );

            logger.info(`Created category ValueSet: ${categoryName} (${categoryConcepts.length} concepts)`);
        }
    }

    async createICD11ValueSets() {
        // Create ValueSets for ICD-11 systems
        const icdSystems = [
            {
                url: 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine',
                id: 'icd11-traditional-medicine',
                title: 'ICD-11 Traditional Medicine Module 2'
            },
            {
                url: 'http://id.who.int/icd/release/11/2023-01/mms',
                id: 'icd11-biomedicine',
                title: 'ICD-11 Biomedicine (Subset)'
            }
        ];

        for (const systemInfo of icdSystems) {
            const codeSystem = await this.db.collection('codesystems').findOne({
                url: systemInfo.url
            });

            if (!codeSystem) continue;

            const valueSet = {
                resourceType: 'ValueSet',
                id: systemInfo.id,
                url: `${systemInfo.url}/vs`,
                version: codeSystem.version || '2023-01',
                name: systemInfo.id.replace(/-/g, '').toUpperCase(),
                title: systemInfo.title,
                status: 'active',
                experimental: false,
                date: new Date().toISOString(),
                publisher: 'World Health Organization',
                description: `ValueSet containing all concepts from ${systemInfo.title}`,
                compose: {
                    include: [{
                        system: systemInfo.url
                    }]
                }
            };

            if (codeSystem.concept && codeSystem.concept.length > 0) {
                valueSet.expansion = {
                    identifier: require('uuid').v4(),
                    timestamp: new Date().toISOString(),
                    total: codeSystem.concept.length,
                    contains: codeSystem.concept.map(concept => ({
                        system: systemInfo.url,
                        code: concept.code,
                        display: concept.display,
                        definition: concept.definition
                    }))
                };
            }

            await this.db.collection('valuesets').replaceOne(
                { url: valueSet.url },
                valueSet,
                { upsert: true }
            );

            logger.info(`Created ICD-11 ValueSet: ${systemInfo.id}`);
        }
    }

    async createCombinedValueSets() {
        // Create combined traditional medicine ValueSet
        const combinedValueSet = {
            resourceType: 'ValueSet',
            id: 'combined-traditional-medicine',
            url: 'http://terminology.ayush.gov.in/ValueSet/combined-traditional-medicine',
            version: '1.0.0',
            name: 'CombinedTraditionalMedicine',
            title: 'Combined Traditional Medicine Conditions (NAMASTE + ICD-11 TM2)',
            status: 'active',
            experimental: false,
            date: new Date().toISOString(),
            publisher: 'Ministry of Ayush, Government of India',
            description: 'Combined ValueSet containing both NAMASTE and ICD-11 Traditional Medicine Module 2 codes for comprehensive traditional medicine terminology',
            jurisdiction: [{
                coding: [{
                    system: 'urn:iso:std:iso:3166',
                    code: 'IN',
                    display: 'India'
                }]
            }],
            compose: {
                include: [
                    {
                        system: 'http://terminology.ayush.gov.in/CodeSystem/namaste'
                    },
                    {
                        system: 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine'
                    }
                ]
            }
        };

        await this.db.collection('valuesets').replaceOne(
            { url: combinedValueSet.url },
            combinedValueSet,
            { upsert: true }
        );

        logger.info('Created combined traditional medicine ValueSet');
    }

    // Method to clean up existing problematic ValueSets
    async cleanupProblematicValueSets() {
        const result = await this.db.collection('valuesets').deleteMany({
            $or: [
                { id: { $regex: /^namaste-note:/i } },
                { id: { $regex: /[^a-zA-Z0-9\-\.]/ } },  // Contains invalid characters
                { id: { $regex: /^namaste-unknown$/i } }
            ]
        });

        logger.info(`Cleaned up ${result.deletedCount} problematic ValueSets`);
        return result.deletedCount;
    }
}

// Initialize services and ValueSets on first request
router.use(async (req, res, next) => {
    try {
        if (!namasteService.db) {
            await namasteService.initialize();
        }
        if (!icd11Service.db) {
            await icd11Service.initialize();
        }
        if (!fhirService.db) {
            await fhirService.initialize();
        }
        if (!searchService.db) {
            await searchService.initialize();
        }

        // Initialize ValueSets if not present
        const db = getDB();
        const valueSetCount = await db.collection('valuesets').countDocuments();
        
        if (valueSetCount === 0) {
            logger.info('No ValueSets found, generating from CodeSystems...');
            const generator = new ValueSetGenerator(db);
            await generator.generateValueSetsFromCodeSystems();
        }

        next();
    } catch (error) {
        logger.error('Service initialization failed:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Service initialization failed' }
            }]
        });
    }
});

// ===============================================
// FHIR METADATA ENDPOINT
// ===============================================

router.get('/metadata', async (req, res) => {
    try {
        logger.fhir('capability-statement-requested', { 
            userAgent: req.get('User-Agent'),
            ip: req.ip 
        });

        const capability = {
            resourceType: 'CapabilityStatement',
            id: 'namaste-terminology-server',
            url: 'http://terminology.ayush.gov.in/fhir/metadata',
            version: '1.0.0',
            name: 'NAMASTE_ICD11_TerminologyServer',
            title: 'NAMASTE to ICD-11 FHIR Terminology Server',
            status: 'active',
            date: new Date().toISOString(),
            publisher: 'Ministry of Ayush, Government of India',
            contact: [{
                name: 'Ministry of Ayush',
                telecom: [{
                    system: 'url',
                    value: 'https://www.ayush.gov.in'
                }, {
                    system: 'email',
                    value: 'support@ayush.gov.in'
                }]
            }],
            description: 'FHIR R4 terminology server for NAMASTE codes with ICD-11 TM2 mapping supporting dual coding for traditional medicine',
            jurisdiction: [{
                coding: [{
                    system: 'urn:iso:std:iso:3166',
                    code: 'IN',
                    display: 'India'
                }]
            }],
            purpose: 'Enable interoperability between traditional medicine (NAMASTE) and international medical coding (WHO ICD-11)',
            copyright: '© 2024 Ministry of Ayush, Government of India',
            kind: 'instance',
            implementation: {
                description: 'NAMASTE-ICD11 Terminology Microservice',
                url: process.env.FHIR_BASE_URL || 'http://localhost:3000/fhir'
            },
            fhirVersion: '4.0.1',
            format: ['json', 'application/fhir+json'],
            patchFormat: ['application/json-patch+json'],
            rest: [{
                mode: 'server',
                documentation: 'FHIR R4 Terminology Server with NAMASTE-ICD11 integration',
                security: {
                    service: [{
                        coding: [{
                            system: 'http://terminology.hl7.org/CodeSystem/restful-security-service',
                            code: 'OAuth',
                            display: 'OAuth 2.0'
                        }]
                    }],
                    description: 'OAuth 2.0 with ABHA (Ayushman Bharat Health Account) tokens for authenticated access'
                },
                resource: [
                    {
                        type: 'CodeSystem',
                        profile: 'http://hl7.org/fhir/StructureDefinition/CodeSystem',
                        documentation: 'NAMASTE and ICD-11 code systems',
                        interaction: [
                            { code: 'read', documentation: 'Read CodeSystem by ID or URL' },
                            { code: 'search-type', documentation: 'Search CodeSystems' }
                        ],
                        searchParam: [
                            { name: 'url', type: 'uri', documentation: 'Canonical URL of the code system' },
                            { name: 'name', type: 'string', documentation: 'Computationally friendly name' },
                            { name: 'title', type: 'string', documentation: 'Human-friendly title' },
                            { name: 'status', type: 'token', documentation: 'active | draft | retired' },
                            { name: 'code', type: 'token', documentation: 'Code in the code system' }
                        ],
                        operation: [{
                            name: 'lookup',
                            definition: 'http://hl7.org/fhir/OperationDefinition/CodeSystem-lookup',
                            documentation: 'Look up a code in a code system'
                        }]
                    },
                    {
                        type: 'ValueSet',
                        profile: 'http://hl7.org/fhir/StructureDefinition/ValueSet',
                        documentation: 'Value sets for NAMASTE and ICD-11 codes',
                        interaction: [
                            { code: 'read', documentation: 'Read ValueSet by ID' },
                            { code: 'search-type', documentation: 'Search ValueSets' }
                        ],
                        searchParam: [
                            { name: 'url', type: 'uri', documentation: 'Canonical URL of the value set' },
                            { name: 'name', type: 'string', documentation: 'Computationally friendly name' },
                            { name: 'title', type: 'string', documentation: 'Human-friendly title' },
                            { name: 'status', type: 'token', documentation: 'active | draft | retired' }
                        ],
                        operation: [{
                            name: 'expand',
                            definition: 'http://hl7.org/fhir/OperationDefinition/ValueSet-expand',
                            documentation: 'Expand a value set to show all included codes'
                        }]
                    },
                    {
                        type: 'ConceptMap',
                        profile: 'http://hl7.org/fhir/StructureDefinition/ConceptMap',
                        documentation: 'Mappings between NAMASTE and ICD-11 codes',
                        interaction: [
                            { code: 'read', documentation: 'Read ConceptMap by ID' },
                            { code: 'search-type', documentation: 'Search ConceptMaps' }
                        ],
                        searchParam: [
                            { name: 'url', type: 'uri', documentation: 'Canonical URL of the concept map' },
                            { name: 'source', type: 'reference', documentation: 'Source code system' },
                            { name: 'target', type: 'reference', documentation: 'Target code system' }
                        ],
                        operation: [{
                            name: 'translate',
                            definition: 'http://hl7.org/fhir/OperationDefinition/ConceptMap-translate',
                            documentation: 'Translate codes between systems'
                        }]
                    },
                    {
                        type: 'Bundle',
                        profile: 'http://hl7.org/fhir/StructureDefinition/Bundle',
                        documentation: 'Submit clinical data with dual coding validation',
                        interaction: [
                            { code: 'create', documentation: 'Submit Bundle with FHIR resources' }
                        ]
                    }
                ],
                operation: [
                    {
                        name: 'search-autocomplete',
                        definition: 'http://terminology.ayush.gov.in/OperationDefinition/terminology-search',
                        documentation: 'Auto-complete search across all terminology systems'
                    },
                    {
                        name: 'dual-coding-lookup',
                        definition: 'http://terminology.ayush.gov.in/OperationDefinition/dual-coding-lookup',
                        documentation: 'Look up NAMASTE code with corresponding ICD-11 mappings'
                    }
                ]
            }],
            document: [{
                mode: 'consumer',
                documentation: 'Process clinical documents with dual-coded conditions'
            }]
        };

        res.json(capability);
        
        logger.fhir('capability-statement-served', {
            version: capability.version,
            resources: capability.rest[0].resource.length
        });

    } catch (error) {
        logger.error('Error generating capability statement:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Failed to generate capability statement' }
            }]
        });
    }
});

// ===============================================
// CODESYSTEM ENDPOINTS
// ===============================================

// Get CodeSystem by ID or URL
router.get('/CodeSystem/:id?', async (req, res) => {
    try {
        const { id } = req.params;
        const { url, version, _summary, _elements } = req.query;
        
        logger.fhir('codesystem-read-requested', { id, url, version });
        
        const db = getDB();
        let codeSystem;
        
        if (url) {
            codeSystem = await db.collection('codesystems').findOne({ url: url });
        } else if (id) {
            codeSystem = await db.collection('codesystems').findOne({ 
                $or: [{ id: id }, { url: { $regex: new RegExp(id + '$') } }]
            });
        } else {
            // Return all CodeSystems
            const codeSystems = await db.collection('codesystems').find({}).toArray();
            
            logger.fhir('codesystem-search-completed', { count: codeSystems.length });
            
            return res.json({
                resourceType: 'Bundle',
                id: require('uuid').v4(),
                type: 'searchset',
                total: codeSystems.length,
                link: [{
                    relation: 'self',
                    url: `${req.protocol}://${req.get('host')}/fhir/CodeSystem`
                }],
                entry: codeSystems.map(cs => ({
                    fullUrl: `${req.protocol}://${req.get('host')}/fhir/CodeSystem/${cs.id}`,
                    resource: cs
                }))
            });
        }

        if (!codeSystem) {
            logger.fhir('codesystem-not-found', { id, url });
            return res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    details: { text: 'CodeSystem not found' }
                }]
            });
        }

        // Apply summary or elements filtering if requested
        if (_summary === 'true') {
            const summary = {
                resourceType: codeSystem.resourceType,
                id: codeSystem.id,
                url: codeSystem.url,
                version: codeSystem.version,
                name: codeSystem.name,
                title: codeSystem.title,
                status: codeSystem.status,
                count: codeSystem.count
            };
            res.json(summary);
        } else if (_elements) {
            const elements = _elements.split(',');
            const filtered = {};
            elements.forEach(element => {
                if (codeSystem[element] !== undefined) {
                    filtered[element] = codeSystem[element];
                }
            });
            res.json(filtered);
        } else {
            res.json(codeSystem);
        }

        logger.fhir('codesystem-read-completed', { 
            id: codeSystem.id, 
            conceptCount: codeSystem.count 
        });

    } catch (error) {
        logger.error('Error retrieving CodeSystem:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Failed to retrieve CodeSystem' }
            }]
        });
    }
});

// CodeSystem $lookup operation
router.post('/CodeSystem/$lookup', async (req, res) => {
    try {
        const { system, code, version, property } = req.body;
        
        logger.fhir('codesystem-lookup-requested', { system, code, version });
        
        if (!system || !code) {
            return res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'invalid',
                    details: { text: 'Missing required parameters: system and code' }
                }]
            });
        }

        const result = await fhirService.lookupConcept(system, code);
        
        logger.fhir('codesystem-lookup-completed', { 
            system, 
            code, 
            found: result.parameter?.find(p => p.name === 'result')?.valueBoolean 
        });
        
        res.json(result);

    } catch (error) {
        logger.error('Error in CodeSystem lookup:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Lookup operation failed' }
            }]
        });
    }
});

// ===============================================
// VALUESET ENDPOINTS (FIXED)
// ===============================================

// Get all ValueSets
router.get('/ValueSet', async (req, res) => {
    try {
        const { url, name, title, status, _summary, _count = 20, _offset = 0 } = req.query;
        
        logger.fhir('valueset-search-requested', { url, name, title, status });
        
        const db = getDB();
        const query = {};
        
        if (url) query.url = url;
        if (name) query.name = { $regex: name, $options: 'i' };
        if (title) query.title = { $regex: title, $options: 'i' };
        if (status) query.status = status;
        
        const count = parseInt(_count);
        const offset = parseInt(_offset);
        
        const total = await db.collection('valuesets').countDocuments(query);
        const valueSets = await db.collection('valuesets')
            .find(query)
            .skip(offset)
            .limit(count)
            .toArray();
        
        logger.fhir('valueset-search-completed', { 
            total, 
            returned: valueSets.length,
            offset,
            count 
        });
        
        const bundle = {
            resourceType: 'Bundle',
            id: require('uuid').v4(),
            type: 'searchset',
            total: total,
            link: [
                {
                    relation: 'self',
                    url: `${req.protocol}://${req.get('host')}/fhir/ValueSet${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`
                }
            ],
            entry: valueSets.map(vs => ({
                fullUrl: `${req.protocol}://${req.get('host')}/fhir/ValueSet/${vs.id}`,
                resource: _summary === 'true' ? {
                    resourceType: vs.resourceType,
                    id: vs.id,
                    url: vs.url,
                    version: vs.version,
                    name: vs.name,
                    title: vs.title,
                    status: vs.status
                } : vs
            }))
        };
        
        // Add pagination links
        if (offset + count < total) {
            bundle.link.push({
                relation: 'next',
                url: `${req.protocol}://${req.get('host')}/fhir/ValueSet?_offset=${offset + count}&_count=${count}`
            });
        }
        
        if (offset > 0) {
            bundle.link.push({
                relation: 'previous', 
                url: `${req.protocol}://${req.get('host')}/fhir/ValueSet?_offset=${Math.max(0, offset - count)}&_count=${count}`
            });
        }
        
        res.json(bundle);

    } catch (error) {
        logger.error('Error searching ValueSets:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Failed to search ValueSets' }
            }]
        });
    }
});

// Get ValueSet by ID
router.get('/ValueSet/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { _summary, _elements } = req.query;
        
        logger.fhir('valueset-read-requested', { id });
        
        const db = getDB();
        const valueSet = await db.collection('valuesets').findOne({ 
            $or: [
                { id: id },
                { url: id },
                { url: { $regex: new RegExp(id + '$') } }
            ]
        });
        
        if (!valueSet) {
            logger.fhir('valueset-not-found', { id });
            return res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    details: { text: `ValueSet '${id}' not found` }
                }]
            });
        }

        // Apply filtering
        let response = valueSet;
        if (_summary === 'true') {
            response = {
                resourceType: valueSet.resourceType,
                id: valueSet.id,
                url: valueSet.url,
                version: valueSet.version,
                name: valueSet.name,
                title: valueSet.title,
                status: valueSet.status
            };
        } else if (_elements) {
            const elements = _elements.split(',');
            response = { resourceType: 'ValueSet' };
            elements.forEach(element => {
                if (valueSet[element] !== undefined) {
                    response[element] = valueSet[element];
                }
            });
        }

        res.json(response);
        
        logger.fhir('valueset-read-completed', { id: valueSet.id });

    } catch (error) {
        logger.error('Error retrieving ValueSet:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Failed to retrieve ValueSet' }
            }]
        });
    }
});

// ValueSet $expand operation
router.get('/ValueSet/$expand', async (req, res) => {
    try {
        const { url, filter, count = 20, offset = 0, includeDesignations = false } = req.query;
        
        logger.fhir('valueset-expand-requested', { url, filter, count, offset });
        
        if (!url) {
            return res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'invalid',
                    details: { text: 'Missing required parameter: url' }
                }]
            });
        }

        const db = getDB();
        const generator = new ValueSetGenerator(db);
        
        try {
            const expansion = await generator.expandValueSet(
                url, 
                filter, 
                parseInt(count), 
                parseInt(offset)
            );
            
            logger.fhir('valueset-expand-completed', { 
                url, 
                totalConcepts: expansion.expansion?.total || 0,
                returnedConcepts: expansion.expansion?.contains?.length || 0
            });
            
            res.json(expansion);
        } catch (expandError) {
            if (expandError.message === 'ValueSet not found') {
                return res.status(404).json({
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error',
                        code: 'not-found',
                        details: { text: `ValueSet with URL '${url}' not found` }
                    }]
                });
            }
            throw expandError;
        }

    } catch (error) {
        logger.error('Error expanding ValueSet:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'ValueSet expansion failed' }
            }]
        });
    }
});

// ValueSet $expand operation (POST version)
router.post('/ValueSet/$expand', async (req, res) => {
    try {
        const { url, valueSet, filter, count = 20, offset = 0 } = req.body;
        
        logger.fhir('valueset-expand-post-requested', { url, filter, count, offset });
        
        if (!url && !valueSet) {
            return res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'invalid',
                    details: { text: 'Either url parameter or valueSet resource is required' }
                }]
            });
        }

        const db = getDB();
        const generator = new ValueSetGenerator(db);
        
        let targetUrl = url;
        if (valueSet) {
            // Save the provided ValueSet temporarily and use its URL
            targetUrl = valueSet.url;
            await db.collection('valuesets').replaceOne(
                { url: valueSet.url },
                valueSet,
                { upsert: true }
            );
        }
        
        const expansion = await generator.expandValueSet(
            targetUrl, 
            filter, 
            parseInt(count), 
            parseInt(offset)
        );
        
        logger.fhir('valueset-expand-post-completed', { 
            url: targetUrl, 
            totalConcepts: expansion.expansion?.total || 0,
            returnedConcepts: expansion.expansion?.contains?.length || 0
        });
        
        res.json(expansion);

    } catch (error) {
        logger.error('Error expanding ValueSet (POST):', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'ValueSet expansion failed' }
            }]
        });
    }
});

// ===============================================
// ADVANCED SEARCH ENDPOINTS
// ===============================================

// Auto-complete search endpoint with rate limiting
router.get('/ValueSet/search', searchLimiter, async (req, res) => {
    try {
        const { 
            q, 
            system, 
            systemType, 
            count = 20, 
            fuzzy = false,
            includeDefinitions = true,
            includeMappings = true 
        } = req.query;
        
        logger.fhir('search-requested', { q, system, systemType, count });
        
        if (!q || q.length < 2) {
            return res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'invalid',
                    details: { text: 'Query parameter (q) must be at least 2 characters' }
                }]
            });
        }

        const searchOptions = {
            systemFilter: system,
            systemType: systemType,
            includeMapppings: includeMappings === 'true',
            limit: parseInt(count),
            fuzzy: fuzzy === 'true'
        };

        const results = await searchService.searchTerms(q, searchOptions);
        
        logger.fhir('search-completed', { 
            query: q, 
            resultCount: results.total,
            systemType 
        });
        
        res.json(results);

    } catch (error) {
        logger.error('Error in search:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Search operation failed' }
            }]
        });
    }
});

// Dual coding search endpoint
router.get('/ValueSet/dual-coding-search', searchLimiter, async (req, res) => {
    try {
        const { q, count = 20 } = req.query;
        
        logger.fhir('dual-coding-search-requested', { q, count });
        
        if (!q || q.length < 2) {
            return res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'invalid',
                    details: { text: 'Query parameter (q) must be at least 2 characters' }
                }]
            });
        }

        const results = await searchService.searchWithDualCoding(q, parseInt(count));
        
        logger.fhir('dual-coding-search-completed', { 
            query: q, 
            resultCount: results.total 
        });
        
        res.json(results);

    } catch (error) {
        logger.error('Error in dual coding search:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Dual coding search operation failed' }
            }]
        });
    }
});

// Category-based search
router.get('/ValueSet/search-by-category', searchLimiter, async (req, res) => {
    try {
        const { category, systemType, count = 50 } = req.query;
        
        logger.fhir('category-search-requested', { category, systemType, count });
        
        if (!category) {
            return res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'invalid',
                    details: { text: 'Missing required parameter: category' }
                }]
            });
        }

        const results = await searchService.searchByCategory(
            category, 
            systemType, 
            parseInt(count)
        );
        
        logger.fhir('category-search-completed', { 
            category, 
            systemType, 
            resultCount: results.total 
        });
        
        res.json(results);

    } catch (error) {
        logger.error('Error in category search:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Category search operation failed' }
            }]
        });
    }
});

// ===============================================
// CONCEPTMAP ENDPOINTS
// ===============================================

// Get all ConceptMaps
router.get('/ConceptMap', async (req, res) => {
    try {
        const { url, source, target, _count = 20, _offset = 0 } = req.query;
        
        logger.fhir('conceptmap-search-requested', { url, source, target });
        
        const db = getDB();
        const query = {};
        
        if (url) query.url = url;
        if (source) query.sourceUri = source;
        if (target) query.targetUri = target;
        
        const count = parseInt(_count);
        const offset = parseInt(_offset);
        
        const total = await db.collection('conceptmaps').countDocuments(query);
        const conceptMaps = await db.collection('conceptmaps')
            .find(query)
            .skip(offset)
            .limit(count)
            .toArray();
        
        logger.fhir('conceptmap-search-completed', { 
            total, 
            returned: conceptMaps.length 
        });
        
        res.json({
            resourceType: 'Bundle',
            id: require('uuid').v4(),
            type: 'searchset',
            total: total,
            link: [{
                relation: 'self',
                url: `${req.protocol}://${req.get('host')}/fhir/ConceptMap${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`
            }],
            entry: conceptMaps.map(cm => ({
                fullUrl: `${req.protocol}://${req.get('host')}/fhir/ConceptMap/${cm.id}`,
                resource: cm
            }))
        });

    } catch (error) {
        logger.error('Error searching ConceptMaps:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Failed to search ConceptMaps' }
            }]
        });
    }
});

// Get ConceptMap by ID
router.get('/ConceptMap/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        logger.fhir('conceptmap-read-requested', { id });
        
        const db = getDB();
        const conceptMap = await db.collection('conceptmaps').findOne({ 
            $or: [
                { id: id },
                { url: id },
                { url: { $regex: new RegExp(id + '') }}
            ]
        });
        
        if (!conceptMap) {
            logger.fhir('conceptmap-not-found', { id });
            return res.status(404).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-found',
                    details: { text: `ConceptMap '${id}' not found` }
                }]
            });
        }

        res.json(conceptMap);
        
        logger.fhir('conceptmap-read-completed', { 
            id: conceptMap.id,
            mappingCount: conceptMap.group?.reduce((acc, g) => acc + (g.element?.length || 0), 0) || 0
        });

    } catch (error) {
        logger.error('Error retrieving ConceptMap:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Failed to retrieve ConceptMap' }
            }]
        });
    }
});

// ConceptMap $translate operation
router.post('/ConceptMap/$translate', async (req, res) => {
    try {
        const { system, code, target, conceptMapVersion } = req.body;
        
        logger.fhir('conceptmap-translate-requested', { system, code, target });
        
        if (!system || !code) {
            return res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'invalid',
                    details: { text: 'Missing required parameters: system and code' }
                }]
            });
        }

        const translation = await fhirService.translateConcept(system, code, target);
        
        logger.fhir('conceptmap-translate-completed', { 
            system, 
            code, 
            target,
            success: translation.parameter?.find(p => p.name === 'result')?.valueBoolean
        });
        
        res.json(translation);

    } catch (error) {
        logger.error('Error in translation:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Translation operation failed' }
            }]
        });
    }
});

// ===============================================
// BUNDLE ENDPOINT WITH DUAL CODING VALIDATION
// ===============================================

// Process FHIR Bundle with dual coding validation
router.post('/Bundle', bundleLimiter, async (req, res) => {
    try {
        const bundle = req.body;
        
        logger.fhir('bundle-processing-started', { 
            bundleId: bundle.id,
            entryCount: bundle.entry?.length || 0,
            bundleType: bundle.type
        });
        
        if (!bundle || bundle.resourceType !== 'Bundle') {
            return res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'invalid',
                    details: { text: 'Invalid Bundle resource' }
                }]
            });
        }

        const result = await fhirService.processBundle(bundle, req.auditContext);
        
        logger.fhir('bundle-processing-completed', { 
            bundleId: bundle.id,
            processedEntries: result.entry?.length || 0,
            successfulEntries: result.entry?.filter(e => e.response?.status?.startsWith('20')).length || 0
        });
        
        res.status(201).json(result);

    } catch (error) {
        logger.error('Error processing Bundle:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: error.message || 'Bundle processing failed' }
            }]
        });
    }
});

// ===============================================
// UTILITY ENDPOINTS
// ===============================================

// Cleanup problematic ValueSets
router.post('/admin/cleanup-valuesets', async (req, res) => {
    try {
        const db = getDB();
        const generator = new ValueSetGenerator(db);
        
        const deletedCount = await generator.cleanupProblematicValueSets();
        
        res.json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'information',
                code: 'informational',
                details: { text: `Cleaned up ${deletedCount} problematic ValueSets` }
            }]
        });
    } catch (error) {
        logger.error('Cleanup failed:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'Cleanup failed' }
            }]
        });
    }
});

// Manual ValueSet generation endpoint (for debugging)
router.post('/admin/generate-valuesets', async (req, res) => {
    try {
        logger.info('Manual ValueSet generation requested');
        
        const db = getDB();
        const generator = new ValueSetGenerator(db);
        
        await generator.generateValueSetsFromCodeSystems();
        
        const valueSetCount = await db.collection('valuesets').countDocuments();
        
        res.json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'information',
                code: 'informational',
                details: { text: `Successfully generated ${valueSetCount} ValueSets` }
            }]
        });

    } catch (error) {
        logger.error('Error generating ValueSets:', error);
        res.status(500).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'exception',
                details: { text: 'ValueSet generation failed' }
            }]
        });
    }
});

// Health check endpoint
router.get('/health', async (req, res) => {
    try {
        const db = getDB();
        
        const codeSystemCount = await db.collection('codesystems').countDocuments();
        const valueSetCount = await db.collection('valuesets').countDocuments();
        const conceptMapCount = await db.collection('conceptmaps').countDocuments();
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                database: 'connected',
                terminology: 'active'
            },
            statistics: {
                codeSystems: codeSystemCount,
                valueSets: valueSetCount,
                conceptMaps: conceptMapCount
            }
        });

    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

module.exports = router;