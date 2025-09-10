const { getDB } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class FHIRService {
    constructor() {
        this.db = null;
    }

    async initialize() {
        this.db = getDB();
    }

    async lookupConcept(system, code) {
        try {
            const codeSystem = await this.db.collection('codesystems').findOne({ url: system });
            
            if (!codeSystem) {
                return {
                    resourceType: 'Parameters',
                    parameter: [{
                        name: 'result',
                        valueBoolean: false
                    }, {
                        name: 'message',
                        valueString: 'CodeSystem not found'
                    }]
                };
            }

            const concept = codeSystem.concept?.find(c => c.code === code);
            
            if (!concept) {
                return {
                    resourceType: 'Parameters',
                    parameter: [{
                        name: 'result',
                        valueBoolean: false
                    }, {
                        name: 'message',
                        valueString: 'Concept not found'
                    }]
                };
            }

            const parameters = [
                {
                    name: 'result',
                    valueBoolean: true
                },
                {
                    name: 'name',
                    valueString: codeSystem.name
                },
                {
                    name: 'version',
                    valueString: codeSystem.version
                },
                {
                    name: 'display',
                    valueString: concept.display
                }
            ];

            if (concept.definition) {
                parameters.push({
                    name: 'definition',
                    valueString: concept.definition
                });
            }

            // Add properties
            if (concept.property) {
                concept.property.forEach(prop => {
                    parameters.push({
                        name: 'property',
                        part: [
                            {
                                name: 'code',
                                valueString: prop.code
                            },
                            {
                                name: 'value',
                                valueString: prop.valueString || prop.valueCode || prop.valueInteger?.toString()
                            }
                        ]
                    });
                });
            }

            return {
                resourceType: 'Parameters',
                parameter: parameters
            };

        } catch (error) {
            logger.error('Lookup operation failed:', error);
            throw error;
        }
    }

    async expandValueSet(url, filter, count = 20, offset = 0) {
        try {
            const valueSet = await this.db.collection('valuesets').findOne({ url });
            
            if (!valueSet) {
                throw new Error('ValueSet not found');
            }

            // Get the included CodeSystem
            const include = valueSet.compose?.include?.[0];
            if (!include || !include.system) {
                throw new Error('ValueSet compose.include not found');
            }

            const codeSystem = await this.db.collection('codesystems').findOne({ url: include.system });
            if (!codeSystem) {
                throw new Error('Referenced CodeSystem not found');
            }

            let concepts = codeSystem.concept || [];

            // Apply filter if provided
            if (filter) {
                const filterTerm = filter.toLowerCase();
                concepts = concepts.filter(concept =>
                    concept.display.toLowerCase().includes(filterTerm) ||
                    concept.code.toLowerCase().includes(filterTerm) ||
                    concept.definition?.toLowerCase().includes(filterTerm)
                );
            }

            // Apply pagination
            const total = concepts.length;
            concepts = concepts.slice(offset, offset + count);

            // Build expansion
            const expansion = {
                resourceType: 'ValueSet',
                id: valueSet.id,
                url: valueSet.url,
                version: valueSet.version,
                name: valueSet.name,
                title: valueSet.title,
                status: valueSet.status,
                expansion: {
                    identifier: uuidv4(),
                    timestamp: new Date().toISOString(),
                    total: total,
                    offset: offset,
                    parameter: []
                }
            };

            if (filter) {
                expansion.expansion.parameter.push({
                    name: 'filter',
                    valueString: filter
                });
            }

            expansion.expansion.contains = concepts.map(concept => ({
                system: include.system,
                code: concept.code,
                display: concept.display
            }));

            return expansion;

        } catch (error) {
            logger.error('ValueSet expansion failed:', error);
            throw error;
        }
    }

    async translateConcept(sourceSystem, sourceCode, targetSystem) {
        try {
            // Find appropriate ConceptMap
            const conceptMap = await this.db.collection('conceptmaps').findOne({
                sourceUri: sourceSystem,
                targetUri: targetSystem
            });

            if (!conceptMap) {
                return {
                    resourceType: 'Parameters',
                    parameter: [{
                        name: 'result',
                        valueBoolean: false
                    }, {
                        name: 'message',
                        valueString: 'No ConceptMap found for the specified systems'
                    }]
                };
            }

            // Find translation
            const group = conceptMap.group?.find(g => g.source === sourceSystem);
            const element = group?.element?.find(e => e.code === sourceCode);
            const target = element?.target?.find(t => t.equivalence === 'equivalent');

            if (!target) {
                return {
                    resourceType: 'Parameters',
                    parameter: [{
                        name: 'result',
                        valueBoolean: false
                    }, {
                        name: 'message',
                        valueString: 'No equivalent mapping found'
                    }]
                };
            }

            return {
                resourceType: 'Parameters',
                parameter: [{
                    name: 'result',
                    valueBoolean: true
                }, {
                    name: 'match',
                    part: [{
                        name: 'equivalence',
                        valueCode: target.equivalence
                    }, {
                        name: 'concept',
                        valueCoding: {
                            system: targetSystem,
                            code: target.code,
                            display: target.display
                        }
                    }]
                }]
            };

        } catch (error) {
            logger.error('Concept translation failed:', error);
            throw error;
        }
    }

    async processBundle(bundle, auditContext) {
        try {
            const processedEntries = [];
            const errors = [];

            for (let i = 0; i < bundle.entry.length; i++) {
                try {
                    const entry = bundle.entry[i];
                    
                    if (entry.resource?.resourceType === 'Condition') {
                        await this.validateDualCoding(entry.resource);
                        processedEntries.push({
                            response: {
                                status: '201 Created',
                                location: `Condition/${entry.resource.id || uuidv4()}`,
                                lastModified: new Date().toISOString()
                            }
                        });
                    } else {
                        processedEntries.push({
                            response: {
                                status: '200 OK',
                                lastModified: new Date().toISOString()
                            }
                        });
                    }
                } catch (error) {
                    errors.push({
                        entry: i,
                        error: error.message
                    });
                    processedEntries.push({
                        response: {
                            status: '400 Bad Request',
                            outcome: {
                                resourceType: 'OperationOutcome',
                                issue: [{
                                    severity: 'error',
                                    code: 'invalid',
                                    details: { text: error.message }
                                }]
                            }
                        }
                    });
                }
            }

            // Log audit event
            await this.logAuditEvent({
                action: 'bundle-processed',
                bundleId: bundle.id,
                entriesProcessed: processedEntries.length,
                errors: errors.length,
                ...auditContext
            });

            return {
                resourceType: 'Bundle',
                id: uuidv4(),
                type: 'transaction-response',
                timestamp: new Date().toISOString(),
                entry: processedEntries
            };

        } catch (error) {
            logger.error('Bundle processing failed:', error);
            throw error;
        }
    }

    async validateDualCoding(condition) {
        if (!condition.code?.coding || condition.code.coding.length < 2) {
            throw new Error('Dual coding required: At least NAMASTE and ICD-11 codes must be present');
        }

        const hasNamaste = condition.code.coding.some(c => 
            c.system === 'http://terminology.ayush.gov.in/CodeSystem/namaste'
        );
        
        const hasICD11 = condition.code.coding.some(c => 
            c.system?.includes('icd') || c.system?.includes('who.int')
        );

        if (!hasNamaste) {
            throw new Error('NAMASTE code required for AYUSH conditions');
        }

        if (!hasICD11) {
            throw new Error('ICD-11 code required for international interoperability');
        }

        return true;
    }

    async logAuditEvent(event) {
        try {
            const auditEvent = {
                resourceType: 'AuditEvent',
                type: {
                    system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
                    code: 'rest'
                },
                action: 'E',
                recorded: new Date().toISOString(),
                outcome: '0',
                agent: [{
                    type: {
                        coding: [{
                            system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
                            code: 'humanuser'
                        }]
                    },
                    who: {
                        identifier: {
                            value: event.userId
                        }
                    },
                    requestor: true
                }],
                source: {
                    site: 'AYUSH Terminology Server',
                    observer: {
                        display: 'FHIR Terminology Microservice'
                    }
                },
                entity: [{
                    what: {
                        identifier: {
                            value: event.bundleId || 'unknown'
                        }
                    },
                    type: {
                        system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type',
                        code: '2'
                    }
                }],
                ...event
            };

            await this.db.collection('audit').insertOne(auditEvent);
        } catch (error) {
            logger.error('Audit logging failed:', error);
            // Don't throw - audit failure shouldn't break the main operation
        }
    }
}

module.exports = FHIRService;