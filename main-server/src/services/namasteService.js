// ===============================================
// NAMASTE SERVICE (src/services/namasteService.js)
// ===============================================

const XLSX = require('xlsx');
const { getDB } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class NAMASTEService {
  constructor() {
    this.db = null;
    this.namasteCodeSystem = null;
  }

  async initialize() {
    this.db = getDB();
    await this.loadNAMASTECodeSystem();
  }

  async loadNAMASTECodeSystem() {
    try {
      this.namasteCodeSystem = await this.db.collection('codesystems').findOne({
        url: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
      });
    } catch (error) {
      logger.error('Failed to load NAMASTE CodeSystem:', error);
    }
  }

  getValueFromRow(row, possibleColumns) {
    for (const column of possibleColumns) {
      // Try exact match first
      if (row[column] !== undefined && row[column] !== null && row[column] !== '') {
        return row[column];
      }

      // Try case-insensitive match
      const lowerColumn = column.toLowerCase();
      for (const [key, value] of Object.entries(row)) {
        if (
          key.toLowerCase().replace(/\*/g, '').replace(/\s+/g, '_') ===
          lowerColumn.replace(/\*/g, '').replace(/\s+/g, '_')
        ) {
          if (value !== undefined && value !== null && value !== '') {
            return value;
          }
        }
      }
    }
    return null;
  }
  validateAndCleanCode(code) {
    if (!code) return null;

    // Convert to string and clean
    let cleanCode = code.toString().trim().toUpperCase();

    // Remove any prefixes like "NAMC_" if present
    cleanCode = cleanCode.replace(/^NAMC[_-]?/i, '');

    // NAMC codes might be numbers or alphanumeric
    if (/^[A-Z0-9]{1,10}$/.test(cleanCode)) {
      return cleanCode;
    }

    // If it's just numbers, pad to at least 3 digits
    if (/^\d+$/.test(cleanCode)) {
      return cleanCode.padStart(3, '0');
    }

    logger.warn(`Unusual code format, accepting as-is: ${cleanCode}`);
    return cleanCode;
  }

  // Enhanced namasteService.js processExcelFile method
  async processExcelFile(filePath) {
    try {
      logger.info(`Processing NAMASTE Excel file: ${filePath}`);

      // File validation (same as before)
      const fs = require('fs');
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        throw new Error('File is empty');
      }

      if (stats.size > 50 * 1024 * 1024) {
        throw new Error('File too large (max 50MB)');
      }

      // Read Excel file
      let workbook;
      try {
        workbook = XLSX.readFile(filePath, {
          cellDates: true,
          cellNF: false,
          cellText: false,
          raw: false, // Convert everything to strings
        });
      } catch (xlsxError) {
        throw new Error(`Invalid Excel file format: ${xlsxError.message}`);
      }

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('Excel file contains no worksheets');
      }

      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) {
        throw new Error('Cannot read first worksheet');
      }

      // Convert to JSON
      let data;
      try {
        data = XLSX.utils.sheet_to_json(worksheet, {
          defval: '', // Default value for empty cells
          blankrows: false, // Skip blank rows
          raw: false, // Convert all values to strings
        });
      } catch (parseError) {
        throw new Error(`Failed to parse Excel data: ${parseError.message}`);
      }

      if (data.length === 0) {
        throw new Error('Excel file contains no data rows');
      }

      // Get headers from first data object
      const headers = Object.keys(data[0]);
      logger.info(`Found columns: ${headers.join(', ')}`);

      // Check if we have the required NAMC columns
      const hasNamcCode = headers.some(
        (h) => h.toLowerCase().includes('namc_code') || h.toLowerCase().includes('namc_id')
      );

      const hasNamcTerm = headers.some(
        (h) => h.toLowerCase().includes('namc_term') || h.toLowerCase().includes('term')
      );

      if (!hasNamcCode) {
        throw new Error(
          `Missing NAMC code column. Expected 'NAMC_CODE' or 'NAMC_ID'. Found: ${headers.join(', ')}`
        );
      }

      if (!hasNamcTerm) {
        throw new Error(
          `Missing NAMC term column. Expected 'NAMC_term' or similar. Found: ${headers.join(', ')}`
        );
      }

      // Add row indexes for error reporting
      const rowData = data.map((row, index) => ({
        ...row,
        _rowIndex: index + 2, // Excel row number (accounting for header)
      }));

      // Filter out completely empty rows
      const validRows = rowData.filter((row) => {
        const values = Object.values(row).filter((v) => v !== '' && v !== null && v !== undefined);
        return values.length > 1; // Must have more than just row index
      });

      logger.info(`Processing ${validRows.length} valid rows out of ${data.length} total rows`);

      // Transform data with validation
      const { concepts, errors } = this.transformToFHIRConceptsWithValidation(validRows);

      if (concepts.length === 0) {
        throw new Error(`No valid concepts found. Sample errors: ${errors.slice(0, 5).join('; ')}`);
      }

      if (errors.length > 0) {
        logger.warn(
          `Processing completed with ${errors.length} errors. Sample errors:`,
          errors.slice(0, 10)
        );
      }

      // Continue with CodeSystem creation
      const codeSystem = await this.createNAMASTECodeSystem(concepts);
      await this.saveCodeSystemSafely(codeSystem);

      const valueSets = await this.createNAMASTEValueSets(concepts);
      await this.saveValueSetsSafely(valueSets);

      // Refresh search index
      try {
        const SearchService = require('./searchService');
        const searchService = new SearchService();
        await searchService.initialize();
        await searchService.refreshIndex();
      } catch (searchError) {
        logger.warn('Failed to refresh search index:', searchError);
      }

      logger.info(
        `Successfully processed ${concepts.length} NAMASTE concepts with ${errors.length} warnings`
      );

      return {
        success: true,
        concepts: concepts.length,
        codeSystemId: codeSystem.id,
        valueSets: valueSets.length,
        warnings: errors.length,
        warningDetails: errors.slice(0, 20), // First 20 errors for debugging
        timestamp: new Date().toISOString(),
        sampleConcepts: concepts.slice(0, 3).map((c) => ({
          // Sample for verification
          code: c.code,
          display: c.display,
          definition: c.definition,
        })),
      };
    } catch (error) {
      logger.error('NAMASTE Excel processing failed:', {
        error: error.message,
        stack: error.stack,
        filePath,
      });
      throw error;
    }
  }
  // Helper method to create flexible header mapping
  createHeaderMap(headers) {
    const map = {};
    const headerAliases = {
      code: [
        'code',
        'namaste_code',
        'concept_code',
        'id',
        'namc_code',
        'namc_id', // Added NAMC format
      ],
      display: [
        'display',
        'title',
        'name',
        'term',
        'description',
        'namc_term',
        'namc *term*',
        'namc *term*diacritical', // Added NAMC format
      ],
      definition: [
        'definition',
        'meaning',
        'explanation',
        'desc',
        'short_definition',
        'long_definition', // Added NAMC format
      ],
      system: [
        'system',
        'medicine_system',
        'ayush_system',
        'ontology_branches', // Added NAMC format
      ],
      category: ['category', 'class', 'type', 'classification'],
      hindi_display: [
        'hindi_display',
        'hindi',
        'hindi_name',
        'namc *term*devanagari', // Added NAMC format
      ],
      sanskrit_display: ['sanskrit_display', 'sanskrit', 'sanskrit_name'],
    };

    headers.forEach((header, index) => {
      const normalizedHeader = header
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\*/g, '') // Remove asterisks
        .replace(/\s+/g, '_'); // Replace spaces with underscores

      Object.entries(headerAliases).forEach(([key, aliases]) => {
        aliases.forEach((alias) => {
          const normalizedAlias = alias.toLowerCase().replace(/\*/g, '').replace(/\s+/g, '_');
          if (
            normalizedHeader.includes(normalizedAlias) ||
            normalizedAlias.includes(normalizedHeader)
          ) {
            if (!map[key]) {
              // Only set if not already mapped
              map[key] = header;
            }
          }
        });
      });
    });

    return map;
  }

  transformToFHIRConcepts(excelData) {
    const concepts = [];
    const errors = [];

    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];
      const rowNumber = i + 2; // Excel row number

      try {
        // Map NAMC columns to expected fields
        let code = null;
        let display = null;
        let definition = null;
        let system = null;
        let hindiDisplay = null;

        // Extract values from NAMC format columns
        Object.keys(row).forEach((key) => {
          const lowerKey = key.toLowerCase().replace(/\*/g, '').trim();
          const value = row[key];

          if (value !== null && value !== undefined && value.toString().trim() !== '') {
            if (lowerKey.includes('namc_code') || lowerKey.includes('namc_id')) {
              code = value.toString().trim();
            } else if (lowerKey.includes('namc_term') || lowerKey === 'namc term') {
              display = value.toString().trim();
            } else if (lowerKey.includes('short_definition')) {
              definition = value.toString().trim();
            } else if (lowerKey.includes('long_definition') && !definition) {
              definition = value.toString().trim();
            } else if (lowerKey.includes('ontology_branches')) {
              system = value.toString().trim();
            } else if (lowerKey.includes('devanagari')) {
              hindiDisplay = value.toString().trim();
            }
          }
        });

        // Validate required fields
        if (!code) {
          errors.push(`Row ${rowNumber}: Missing NAMC_CODE`);
          continue;
        }

        if (!display) {
          errors.push(`Row ${rowNumber}: Missing NAMC_term for code ${code}`);
          continue;
        }

        // Clean the code
        let cleanCode = code.toUpperCase().replace(/^NAMC[_-]?/i, '');

        // Validate code format - be more flexible
        if (!/^[A-Z0-9]{1,15}$/.test(cleanCode)) {
          // If it contains only numbers, that's okay
          if (/^\d+$/.test(cleanCode)) {
            cleanCode = cleanCode.padStart(3, '0');
          } else {
            errors.push(`Row ${rowNumber}: Invalid code format: ${code}`);
            continue;
          }
        }

        const concept = {
          code: cleanCode,
          display: display,
          definition: definition || '',
          property: [],
        };

        // Add system property if available
        if (system) {
          concept.property.push({
            code: 'system',
            valueString: system,
          });
        }

        // Add Hindi display if available
        if (hindiDisplay) {
          concept.property.push({
            code: 'hindi-display',
            valueString: hindiDisplay,
          });
        }

        // Add original NAMC code as property
        concept.property.push({
          code: 'original-namc-code',
          valueString: code,
        });

        concepts.push(concept);
      } catch (error) {
        errors.push(`Row ${rowNumber}: Processing error - ${error.message}`);
      }
    }

    console.log(`Processed ${concepts.length} concepts with ${errors.length} errors`);
    if (errors.length > 0) {
      console.log('Sample errors:', errors.slice(0, 5));
    }

    return concepts.filter((c) => c.code && c.display);
  }

  // Enhanced transformation with validation
  transformToFHIRConceptsWithValidation(excelData) {
    const concepts = [];
    const errors = [];

    for (const row of excelData) {
      try {
        // Get values using multiple possible column names
        const code = this.getValueFromRow(row, ['namc_code', 'namc_id', 'code', 'namaste_code']);

        const display = this.getValueFromRow(row, [
          'namc_term',
          'namc *term*',
          'namc *term*diacritical',
          'display',
          'title',
          'name',
          'term',
        ]);

        const definition = this.getValueFromRow(row, [
          'short_definition',
          'long_definition',
          'definition',
          'meaning',
        ]);

        const system = this.getValueFromRow(row, [
          'ontology_branches',
          'system',
          'medicine_system',
        ]);

        const hindiDisplay = this.getValueFromRow(row, [
          'namc *term*devanagari',
          'hindi_display',
          'hindi',
        ]);

        // Validate required fields
        if (!code || code.toString().trim() === '') {
          errors.push(`Row ${row._rowIndex}: Missing NAMC_CODE`);
          continue;
        }

        if (!display || display.toString().trim() === '') {
          errors.push(`Row ${row._rowIndex}: Missing NAMC_term for code ${code}`);
          continue;
        }

        // Clean and validate code
        const cleanCode = this.validateAndCleanCode(code);
        if (!cleanCode) {
          errors.push(`Row ${row._rowIndex}: Invalid code format: ${code}`);
          continue;
        }

        const concept = {
          code: cleanCode,
          display: display.toString().trim(),
          definition: definition ? definition.toString().trim() : '',
          property: [],
        };

        // Add optional properties with null checks
        this.addPropertyIfExists(concept, 'system', system);
        this.addPropertyIfExists(concept, 'hindi-display', hindiDisplay);

        // Add original NAMC ID if different from code
        const namcId = this.getValueFromRow(row, ['namc_id']);
        if (namcId && namcId !== cleanCode) {
          this.addPropertyIfExists(concept, 'namc-id', namcId);
        }

        concepts.push(concept);
      } catch (conceptError) {
        errors.push(`Row ${row._rowIndex}: ${conceptError.message}`);
      }
    }

    return { concepts, errors };
  }

  // Helper to safely add properties
  addPropertyIfExists(concept, code, value) {
    if (value && value.toString().trim()) {
      concept.property.push({
        code: code,
        valueString: value.toString().trim(),
      });
    }
  }

  // Safe database operations
  async saveCodeSystemSafely(codeSystem) {
    try {
      // Simple save without transactions for standalone MongoDB
      await this.db
        .collection('codesystems')
        .replaceOne({ url: codeSystem.url }, codeSystem, { upsert: true });

      this.namasteCodeSystem = codeSystem;
      logger.info(`Saved NAMASTE CodeSystem with ${codeSystem.count} concepts`);
    } catch (error) {
      logger.error('Failed to save CodeSystem:', error);
      throw error;
    }
  }

  async saveValueSetsSafely(valueSets) {
    try {
      // Save each ValueSet without transactions
      for (const valueSet of valueSets) {
        await this.db
          .collection('valuesets')
          .replaceOne({ url: valueSet.url }, valueSet, { upsert: true });
      }

      logger.info(`Saved ${valueSets.length} NAMASTE ValueSets`);
    } catch (error) {
      logger.error('Failed to save ValueSets:', error);
      throw error;
    }
  }

  transformToFHIRConcepts(excelData) {
    const concepts = [];

    for (const row of excelData) {
      // Expected Excel columns: Code, Display, Definition, System, Category, Hindi_Display, Sanskrit_Display
      const concept = {
        code: this.validateCode(row.Code || row.code),
        display: row.Display || row.display || '',
        definition: row.Definition || row.definition || '',
        property: [],
      };

      // Add system-specific properties
      if (row.System || row.system) {
        concept.property.push({
          code: 'system',
          valueString: row.System || row.system,
        });
      }

      // Add category classification
      if (row.Category || row.category) {
        concept.property.push({
          code: 'category',
          valueString: row.Category || row.category,
        });
      }

      // Add multilingual support
      if (row.Hindi_Display || row.hindi_display) {
        concept.property.push({
          code: 'hindi-display',
          valueString: row.Hindi_Display || row.hindi_display,
        });
      }

      if (row.Sanskrit_Display || row.sanskrit_display) {
        concept.property.push({
          code: 'sanskrit-display',
          valueString: row.Sanskrit_Display || row.sanskrit_display,
        });
      }

      // Add WHO terminology mapping if available
      if (row.WHO_Code || row.who_code) {
        concept.property.push({
          code: 'who-terminology-code',
          valueString: row.WHO_Code || row.who_code,
        });
      }

      concepts.push(concept);
    }

    return concepts.filter((c) => c.code && c.display);
  }

  validateCode(code) {
    if (!code) return null;

    // NAMASTE codes follow pattern: AAA, AAB, etc.
    const codeStr = code.toString().trim().toUpperCase();

    // Validate format - should be 3 characters
    if (!/^[A-Z]{3}$/.test(codeStr)) {
      logger.warn(`Invalid NAMASTE code format: ${code}`);
      return codeStr; // Return as-is but log warning
    }

    return codeStr;
  }

  async createNAMASTECodeSystem(concepts) {
    const codeSystem = {
      resourceType: 'CodeSystem',
      id: 'namaste',
      url: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
      version: '1.0.0',
      name: 'NAMASTE',
      title: 'National AYUSH Morbidity & Standardized Terminologies Electronic',
      status: 'active',
      experimental: false,
      date: new Date().toISOString(),
      publisher: 'Ministry of Ayush, Government of India',
      contact: [
        {
          name: 'Ministry of Ayush',
          telecom: [
            {
              system: 'url',
              value: 'https://www.ayush.gov.in',
            },
          ],
        },
      ],
      description:
        'Standardized terminology for Ayurveda, Siddha, and Unani medical conditions and treatments',
      jurisdiction: [
        {
          coding: [
            {
              system: 'urn:iso:std:iso:3166',
              code: 'IN',
              display: 'India',
            },
          ],
        },
      ],
      caseSensitive: true,
      content: 'complete',
      count: concepts.length,
      property: [
        {
          code: 'system',
          uri: 'http://terminology.ayush.gov.in/CodeSystem/namaste/property/system',
          description: 'Traditional medicine system (Ayurveda, Siddha, Unani)',
          type: 'string',
        },
        {
          code: 'category',
          uri: 'http://terminology.ayush.gov.in/CodeSystem/namaste/property/category',
          description: 'Clinical category or classification',
          type: 'string',
        },
        {
          code: 'hindi-display',
          uri: 'http://terminology.ayush.gov.in/CodeSystem/namaste/property/hindi-display',
          description: 'Display name in Hindi',
          type: 'string',
        },
        {
          code: 'sanskrit-display',
          uri: 'http://terminology.ayush.gov.in/CodeSystem/namaste/property/sanskrit-display',
          description: 'Display name in Sanskrit',
          type: 'string',
        },
        {
          code: 'who-terminology-code',
          uri: 'http://terminology.ayush.gov.in/CodeSystem/namaste/property/who-terminology-code',
          description: 'WHO International Terminologies of Ayurveda code',
          type: 'string',
        },
      ],
      concept: concepts,
    };

    return codeSystem;
  }

  async createNAMASTEValueSets(concepts) {
    const valueSets = [];

    // Group concepts by system (Ayurveda, Siddha, Unani)
    const systemGroups = this.groupConceptsBySystem(concepts);

    for (const [system, systemConcepts] of Object.entries(systemGroups)) {
      const valueSet = {
        resourceType: 'ValueSet',
        id: `namaste-${system.toLowerCase()}`,
        url: `http://terminology.ayush.gov.in/ValueSet/namaste-${system.toLowerCase()}`,
        version: '1.0.0',
        name: `NAMASTE_${system.toUpperCase()}`,
        title: `NAMASTE ${system} Conditions`,
        status: 'active',
        experimental: false,
        date: new Date().toISOString(),
        publisher: 'Ministry of Ayush, Government of India',
        description: `NAMASTE codes specific to ${system} medical system`,
        jurisdiction: [
          {
            coding: [
              {
                system: 'urn:iso:std:iso:3166',
                code: 'IN',
                display: 'India',
              },
            ],
          },
        ],
        compose: {
          include: [
            {
              system: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
              filter: [
                {
                  property: 'system',
                  op: '=',
                  value: system,
                },
              ],
            },
          ],
        },
      };

      valueSets.push(valueSet);
    }

    // Create comprehensive ValueSet
    const comprehensiveValueSet = {
      resourceType: 'ValueSet',
      id: 'namaste-all',
      url: 'http://terminology.ayush.gov.in/ValueSet/namaste-all',
      version: '1.0.0',
      name: 'NAMASTE_ALL',
      title: 'All NAMASTE Conditions',
      status: 'active',
      experimental: false,
      date: new Date().toISOString(),
      publisher: 'Ministry of Ayush, Government of India',
      description: 'Complete set of NAMASTE codes for all traditional medicine systems',
      jurisdiction: [
        {
          coding: [
            {
              system: 'urn:iso:std:iso:3166',
              code: 'IN',
              display: 'India',
            },
          ],
        },
      ],
      compose: {
        include: [
          {
            system: 'http://terminology.ayush.gov.in/CodeSystem/namaste',
          },
        ],
      },
    };

    valueSets.push(comprehensiveValueSet);

    return valueSets;
  }

  groupConceptsBySystem(concepts) {
    const groups = {};

    for (const concept of concepts) {
      const systemProp = concept.property?.find((p) => p.code === 'system');
      const system = systemProp?.valueString || 'Unknown';

      if (!groups[system]) {
        groups[system] = [];
      }
      groups[system].push(concept);
    }

    return groups;
  }

  async saveCodeSystem(codeSystem) {
    try {
      await this.db
        .collection('codesystems')
        .replaceOne({ url: codeSystem.url }, codeSystem, { upsert: true });

      this.namasteCodeSystem = codeSystem;
      logger.info(`Saved NAMASTE CodeSystem with ${codeSystem.count} concepts`);
    } catch (error) {
      logger.error('Failed to save CodeSystem:', error);
      throw error;
    }
  }

  async saveValueSets(valueSets) {
    try {
      for (const valueSet of valueSets) {
        await this.db
          .collection('valuesets')
          .replaceOne({ url: valueSet.url }, valueSet, { upsert: true });
      }

      logger.info(`Saved ${valueSets.length} NAMASTE ValueSets`);
    } catch (error) {
      logger.error('Failed to save ValueSets:', error);
      throw error;
    }
  }

  async getCodeSystem(url) {
    if (url === 'http://terminology.ayush.gov.in/CodeSystem/namaste') {
      return this.namasteCodeSystem || (await this.db.collection('codesystems').findOne({ url }));
    }

    return await this.db.collection('codesystems').findOne({ url });
  }

  async lookupConcept(code) {
    if (!this.namasteCodeSystem) {
      await this.loadNAMASTECodeSystem();
    }

    if (!this.namasteCodeSystem) {
      return null;
    }

    return this.namasteCodeSystem.concept?.find((c) => c.code === code);
  }

  async searchConcepts(query, system = null, limit = 20) {
    try {
      if (!this.namasteCodeSystem) {
        await this.loadNAMASTECodeSystem();
      }

      if (!this.namasteCodeSystem || !this.namasteCodeSystem.concept) {
        return [];
      }

      const searchTerm = query.toLowerCase();
      let results = this.namasteCodeSystem.concept.filter((concept) => {
        // Text matching
        const matches = [
          concept.code.toLowerCase().includes(searchTerm),
          concept.display.toLowerCase().includes(searchTerm),
          concept.definition?.toLowerCase().includes(searchTerm),
        ];

        // Property matching
        if (concept.property) {
          concept.property.forEach((prop) => {
            if (prop.valueString && prop.valueString.toLowerCase().includes(searchTerm)) {
              matches.push(true);
            }
          });
        }

        return matches.some(Boolean);
      });

      // Filter by system if specified
      if (system) {
        results = results.filter((concept) => {
          const systemProp = concept.property?.find((p) => p.code === 'system');
          return systemProp?.valueString?.toLowerCase() === system.toLowerCase();
        });
      }

      return results.slice(0, limit);
    } catch (error) {
      logger.error('NAMASTE concept search failed:', error);
      throw error;
    }
  }

  async getSystemStats() {
    try {
      if (!this.namasteCodeSystem) {
        await this.loadNAMASTECodeSystem();
      }

      if (!this.namasteCodeSystem) {
        return null;
      }

      const stats = {
        totalConcepts: this.namasteCodeSystem.count || 0,
        systems: {},
        categories: {},
      };

      // Analyze by system and category
      if (this.namasteCodeSystem.concept) {
        for (const concept of this.namasteCodeSystem.concept) {
          if (concept.property) {
            const systemProp = concept.property.find((p) => p.code === 'system');
            const categoryProp = concept.property.find((p) => p.code === 'category');

            if (systemProp?.valueString) {
              stats.systems[systemProp.valueString] =
                (stats.systems[systemProp.valueString] || 0) + 1;
            }

            if (categoryProp?.valueString) {
              stats.categories[categoryProp.valueString] =
                (stats.categories[categoryProp.valueString] || 0) + 1;
            }
          }
        }
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get NAMASTE stats:', error);
      throw error;
    }
  }
}

module.exports = NAMASTEService;
