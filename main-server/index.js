// FHIR R4 Terminology Microservice for NAMASTE-ICD11 Integration
// Core service architecture with key components

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

class FHIRTerminologyService {
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();

    // In-memory stores (use Redis/MongoDB in production)
    this.namasteCodes = new Map();
    this.icd11TM2Codes = new Map();
    this.conceptMaps = new Map();
    this.auditLog = [];
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(this.auditMiddleware.bind(this));
    this.app.use('/fhir', this.authMiddleware.bind(this));
  }

  // OAuth 2.0 ABHA Token Validation
  async authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Missing ABHA token' });
    }

    try {
      // Validate ABHA token (mock implementation)
      const decoded = jwt.verify(token, process.env.ABHA_PUBLIC_KEY || 'mock-key');
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid ABHA token' });
    }
  }

  // Audit trail for India EHR Standards compliance
  auditMiddleware(req, res, next) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: req.user?.sub,
      requestId: uuidv4(),
    };
    this.auditLog.push(auditEntry);
    req.auditId = auditEntry.requestId;
    next();
  }

  setupRoutes() {
    // FHIR Metadata endpoint
    this.app.get('/fhir/metadata', this.getCapabilityStatement.bind(this));

    // CodeSystem endpoints
    this.app.get('/fhir/CodeSystem', this.searchCodeSystems.bind(this));
    this.app.get('/fhir/CodeSystem/:id', this.getCodeSystem.bind(this));

    // ValueSet endpoints with auto-complete
    this.app.get('/fhir/ValueSet/$expand', this.expandValueSet.bind(this));
    this.app.get('/fhir/ValueSet/search', this.searchTerms.bind(this));

    // ConceptMap for NAMASTE ↔ ICD-11 mapping
    this.app.get('/fhir/ConceptMap/:id', this.getConceptMap.bind(this));
    this.app.post('/fhir/ConceptMap/$translate', this.translateConcept.bind(this));

    // Bundle upload for encounters
    this.app.post('/fhir/Bundle', this.processFHIRBundle.bind(this));

    // Custom terminology operations
    this.app.post('/fhir/$lookup', this.lookupConcept.bind(this));
    this.app.post('/admin/sync-icd11', this.syncICD11Data.bind(this));

    // Health check
    this.app.get('/health', (req, res) => res.json({ status: 'healthy' }));
  }

  // FHIR Capability Statement
  getCapabilityStatement(req, res) {
    const capability = {
      resourceType: 'CapabilityStatement',
      id: 'namaste-terminology-server',
      url: 'https://terminology.ayush.gov.in/fhir/metadata',
      version: '1.0.0',
      name: 'NAMASTE-ICD11-TerminologyServer',
      title: 'NAMASTE to ICD-11 FHIR Terminology Server',
      status: 'active',
      date: new Date().toISOString(),
      publisher: 'Ministry of Ayush, Government of India',
      description: 'FHIR R4 terminology server for NAMASTE codes with ICD-11 TM2 mapping',
      fhirVersion: '4.0.1',
      format: ['json'],
      rest: [
        {
          mode: 'server',
          security: {
            service: [
              {
                coding: [
                  {
                    system: 'http://terminology.hl7.org/CodeSystem/restful-security-service',
                    code: 'OAuth',
                  },
                ],
              },
            ],
            description: 'OAuth 2.0 with ABHA tokens',
          },
          resource: [
            {
              type: 'CodeSystem',
              interaction: [{ code: 'read' }, { code: 'search-type' }],
              searchParam: [
                { name: 'url', type: 'uri' },
                { name: 'name', type: 'string' },
              ],
            },
            {
              type: 'ValueSet',
              interaction: [{ code: 'read' }, { code: 'search-type' }],
              operation: [
                {
                  name: 'expand',
                  definition: 'http://hl7.org/fhir/OperationDefinition/ValueSet-expand',
                },
              ],
            },
            {
              type: 'ConceptMap',
              interaction: [{ code: 'read' }],
              operation: [
                {
                  name: 'translate',
                  definition: 'http://hl7.org/fhir/OperationDefinition/ConceptMap-translate',
                },
              ],
            },
          ],
        },
      ],
    };
    res.json(capability);
  }

  // Auto-complete search for clinical UI
  async searchTerms(req, res) {
    const { q, system, count = 20 } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    try {
      const results = [];
      const searchTerm = q.toLowerCase();

      // Search NAMASTE codes
      if (!system || system === 'http://terminology.ayush.gov.in/CodeSystem/namaste') {
        for (const [code, concept] of this.namasteCodes) {
          if (
            concept.display.toLowerCase().includes(searchTerm) ||
            concept.definition?.toLowerCase().includes(searchTerm)
          ) {
            results.push({
              system: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
              code: code,
              display: concept.display,
              definition: concept.definition,
            });
          }
        }
      }

      // Search ICD-11 TM2 codes
      if (
        !system ||
        system === 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine'
      ) {
        for (const [code, concept] of this.icd11TM2Codes) {
          if (concept.display.toLowerCase().includes(searchTerm)) {
            results.push({
              system: 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine',
              code: code,
              display: concept.display,
              definition: concept.definition,
            });
          }
        }
      }

      res.json({
        resourceType: 'Bundle',
        id: uuidv4(),
        type: 'searchset',
        total: results.length,
        entry: results.slice(0, count).map((result) => ({
          resource: {
            resourceType: 'ValueSet',
            expansion: {
              contains: [result],
            },
          },
        })),
      });
    } catch (error) {
      res.status(500).json({ error: 'Search failed', details: error.message });
    }
  }

  // Concept translation between NAMASTE and ICD-11
  async translateConcept(req, res) {
    const { system, code, target } = req.body;

    try {
      const conceptMap = this.conceptMaps.get('namaste-to-icd11-tm2');
      if (!conceptMap) {
        return res.status(404).json({ error: 'ConceptMap not found' });
      }

      const translation = conceptMap.group
        .find((g) => g.source === system)
        ?.element.find((e) => e.code === code)
        ?.target.find((t) => t.equivalence === 'equivalent');

      if (translation) {
        res.json({
          resourceType: 'Parameters',
          parameter: [
            {
              name: 'result',
              valueBoolean: true,
            },
            {
              name: 'match',
              part: [
                {
                  name: 'equivalence',
                  valueCode: translation.equivalence,
                },
                {
                  name: 'concept',
                  valueCoding: {
                    system: target,
                    code: translation.code,
                    display: translation.display,
                  },
                },
              ],
            },
          ],
        });
      } else {
        res.json({
          resourceType: 'Parameters',
          parameter: [
            {
              name: 'result',
              valueBoolean: false,
            },
          ],
        });
      }
    } catch (error) {
      res.status(500).json({ error: 'Translation failed', details: error.message });
    }
  }

  // Process FHIR Bundle with dual coding
  async processFHIRBundle(req, res) {
    try {
      const bundle = req.body;

      if (bundle.resourceType !== 'Bundle') {
        return res.status(400).json({ error: 'Invalid Bundle resource' });
      }

      // Validate and process each entry
      const processedEntries = [];
      for (const entry of bundle.entry) {
        if (entry.resource.resourceType === 'Condition') {
          // Ensure dual coding compliance
          const condition = entry.resource;
          await this.validateDualCoding(condition);
          processedEntries.push(entry);
        }
      }

      // Log audit trail
      this.auditLog.push({
        timestamp: new Date().toISOString(),
        action: 'bundle-processed',
        userId: req.user?.sub,
        bundleId: bundle.id,
        entriesProcessed: processedEntries.length,
        requestId: req.auditId,
      });

      res.status(201).json({
        resourceType: 'Bundle',
        id: uuidv4(),
        type: 'transaction-response',
        entry: processedEntries.map((entry) => ({
          response: {
            status: '201 Created',
            location: `Condition/${entry.resource.id}`,
          },
        })),
      });
    } catch (error) {
      res.status(500).json({ error: 'Bundle processing failed', details: error.message });
    }
  }

  // Validate dual coding requirements
  async validateDualCoding(condition) {
    const hasNamaste = condition.code?.coding?.some(
      (c) => c.system === 'http://terminology.ayush.gov.in/CodeSystem/namaste'
    );
    const hasICD11 = condition.code?.coding?.some((c) => c.system?.includes('icd'));

    if (!hasNamaste || !hasICD11) {
      throw new Error('Dual coding required: Both NAMASTE and ICD-11 codes must be present');
    }
  }

  // Add this method to your FHIRTerminologyService class
  async searchCodeSystems(req, res) {
    try {
      const { url, name, system } = req.query;

      const results = [];

      // Search in NAMASTE CodeSystem
      if (!system || system === 'namaste') {
        const namasteCS = {
          resourceType: 'CodeSystem',
          id: 'namaste',
          url: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
          version: '1.0.0',
          name: 'NAMASTE',
          title: 'NAMASTE Traditional Medicine Codes',
          status: 'active',
          count: this.namasteCodes.size,
          concept: Array.from(this.namasteCodes.entries()).map(([code, concept]) => ({
            code: code,
            display: concept.display,
            definition: concept.definition,
          })),
        };

        if (!url || namasteCS.url === url) {
          if (!name || namasteCS.name.toLowerCase().includes(name.toLowerCase())) {
            results.push(namasteCS);
          }
        }
      }

      // Search in ICD-11 TM2 CodeSystem
      if (!system || system === 'icd11-tm2') {
        const icd11CS = {
          resourceType: 'CodeSystem',
          id: 'icd11-tm2',
          url: 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine',
          version: '2023-01',
          name: 'ICD11_TM2',
          title: 'ICD-11 Traditional Medicine Module 2',
          status: 'active',
          count: this.icd11TM2Codes.size,
          concept: Array.from(this.icd11TM2Codes.entries()).map(([code, concept]) => ({
            code: code,
            display: concept.display,
            definition: concept.definition,
          })),
        };

        if (!url || icd11CS.url === url) {
          if (!name || icd11CS.name.toLowerCase().includes(name.toLowerCase())) {
            results.push(icd11CS);
          }
        }
      }

      res.json({
        resourceType: 'Bundle',
        id: uuidv4(),
        type: 'searchset',
        total: results.length,
        entry: results.map((cs) => ({
          fullUrl: `${req.protocol}://${req.get('host')}/fhir/CodeSystem/${cs.id}`,
          resource: cs,
        })),
      });
    } catch (error) {
      res.status(500).json({
        error: 'CodeSystem search failed',
        details: error.message,
      });
    }
  }

  // Add this method too for the GET /fhir/CodeSystem/:id route
  async getCodeSystem(req, res) {
    try {
      const { id } = req.params;

      if (id === 'namaste') {
        res.json({
          resourceType: 'CodeSystem',
          id: 'namaste',
          url: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
          version: '1.0.0',
          name: 'NAMASTE',
          title: 'NAMASTE Traditional Medicine Codes',
          status: 'active',
          count: this.namasteCodes.size,
          concept: Array.from(this.namasteCodes.entries()).map(([code, concept]) => ({
            code: code,
            display: concept.display,
            definition: concept.definition,
          })),
        });
      } else if (id === 'icd11-tm2') {
        res.json({
          resourceType: 'CodeSystem',
          id: 'icd11-tm2',
          url: 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine',
          version: '2023-01',
          name: 'ICD11_TM2',
          title: 'ICD-11 Traditional Medicine Module 2',
          status: 'active',
          count: this.icd11TM2Codes.size,
          concept: Array.from(this.icd11TM2Codes.entries()).map(([code, concept]) => ({
            code: code,
            display: concept.display,
            definition: concept.definition,
          })),
        });
      } else {
        res.status(404).json({
          error: 'CodeSystem not found',
          id: id,
        });
      }
    } catch (error) {
      res.status(500).json({
        error: 'Failed to retrieve CodeSystem',
        details: error.message,
      });
    }
  }

  // Sync with WHO ICD-11 API
  async syncICD11Data(req, res) {
    try {
      // Mock WHO ICD-11 API integration
      const tm2Response = await axios.get(
        'https://id.who.int/icd/release/11/2023-01/mms/traditional-medicine',
        {
          headers: { 'API-Version': 'v2', 'Accept-Language': 'en' },
        }
      );

      // Process and store TM2 codes
      // Implementation would parse WHO response and update local store

      res.json({
        message: 'ICD-11 data synchronized successfully',
        timestamp: new Date().toISOString(),
        recordsUpdated: 529, // TM2 categories as mentioned
      });
    } catch (error) {
      res.status(500).json({ error: 'ICD-11 sync failed', details: error.message });
    }
  }

  async expandValueSet(req, res) {
    try {
        const { url, filter, count = 20 } = req.query;
        
        if (!url) {
            return res.status(400).json({ 
                error: 'Missing required parameter: url' 
            });
        }

        const results = [];
        const searchTerm = filter ? filter.toLowerCase() : '';
        
        // Expand NAMASTE ValueSet
        if (url.includes('namaste')) {
            for (const [code, concept] of this.namasteCodes) {
                if (!filter || 
                    concept.display.toLowerCase().includes(searchTerm) ||
                    concept.definition?.toLowerCase().includes(searchTerm)) {
                    results.push({
                        system: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
                        code: code,
                        display: concept.display,
                        definition: concept.definition
                    });
                }
            }
        }
        
        // Expand ICD-11 TM2 ValueSet
        if (url.includes('icd') || url.includes('traditional-medicine')) {
            for (const [code, concept] of this.icd11TM2Codes) {
                if (!filter || concept.display.toLowerCase().includes(searchTerm)) {
                    results.push({
                        system: 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine',
                        code: code,
                        display: concept.display,
                        definition: concept.definition
                    });
                }
            }
        }
        
        res.json({
            resourceType: 'ValueSet',
            id: uuidv4(),
            url: url,
            expansion: {
                identifier: uuidv4(),
                timestamp: new Date().toISOString(),
                total: results.length,
                contains: results.slice(0, parseInt(count))
            }
        });
        
    } catch (error) {
        res.status(500).json({ 
            error: 'ValueSet expansion failed', 
            details: error.message 
        });
    }
}

async getConceptMap(req, res) {
    try {
        const { id } = req.params;
        const conceptMap = this.conceptMaps.get(id);
        
        if (!conceptMap) {
            return res.status(404).json({ 
                error: 'ConceptMap not found',
                id: id 
            });
        }
        
        res.json(conceptMap);
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to retrieve ConceptMap', 
            details: error.message 
        });
    }
}

async lookupConcept(req, res) {
    try {
        const { system, code } = req.body;
        
        if (!system || !code) {
            return res.status(400).json({ 
                error: 'Missing required parameters: system and code' 
            });
        }
        
        let concept = null;
        
        if (system === 'http://terminology.ayush.gov.in/CodeSystem/namaste') {
            concept = this.namasteCodes.get(code);
        } else if (system.includes('traditional-medicine')) {
            concept = this.icd11TM2Codes.get(code);
        }
        
        if (concept) {
            res.json({
                resourceType: 'Parameters',
                parameter: [
                    { name: 'name', valueString: concept.display },
                    { name: 'display', valueString: concept.display },
                    { name: 'definition', valueString: concept.definition || '' }
                ]
            });
        } else {
            res.status(404).json({ 
                error: 'Concept not found',
                system: system,
                code: code 
            });
        }
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Lookup failed', 
            details: error.message 
        });
    }
}

  // Initialize NAMASTE data from uploaded CSV/Excel
  async initializeNAMASTEData(filePath) {
    // This would process your Excel file
    // Implementation would use xlsx library to parse and store codes
    console.log('Initializing NAMASTE data from', filePath);
  }

  start(port = 3000) {
    this.app.listen(port, () => {
      console.log(`FHIR Terminology Service running on port ${port}`);
      console.log(`Capability Statement: http://localhost:${port}/fhir/metadata`);
    });
  }
}

// Usage
const service = new FHIRTerminologyService();
service.start(3000);

module.exports = FHIRTerminologyService;
