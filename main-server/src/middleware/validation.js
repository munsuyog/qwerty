
// ===============================================
// VALIDATION MIDDLEWARE (src/middleware/validation.js)
// ===============================================

const logger = require('../utils/logger');

const validationMiddleware = (req, res, next) => {
    // FHIR Content-Type validation for POST/PUT requests
    if (req.method === 'POST' || req.method === 'PUT') {
        const contentType = req.get('Content-Type');
        
        if (!contentType) {
            return res.status(400).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'invalid',
                    details: { 
                        text: 'Content-Type header is required for FHIR resources',
                        coding: [{
                            system: 'http://terminology.hl7.org/CodeSystem/operation-outcome',
                            code: 'MSG_CONTENT_TYPE_MISSING'
                        }]
                    }
                }]
            });
        }
        
        if (!contentType.includes('application/json') && !contentType.includes('application/fhir+json')) {
            return res.status(415).json({
                resourceType: 'OperationOutcome',
                issue: [{
                    severity: 'error',
                    code: 'not-supported',
                    details: { 
                        text: 'Content-Type must be application/json or application/fhir+json for FHIR resources',
                        coding: [{
                            system: 'http://terminology.hl7.org/CodeSystem/operation-outcome',
                            code: 'MSG_CONTENT_TYPE_INVALID'
                        }]
                    }
                }]
            });
        }

        // Validate JSON structure for FHIR operations
        if (req.body && typeof req.body === 'object') {
            const validationResult = validateFHIRStructure(req.body, req.path);
            if (!validationResult.valid) {
                return res.status(400).json({
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error',
                        code: 'structure',
                        details: { text: validationResult.message }
                    }]
                });
            }
        }
    }

    // FHIR Accept header validation
    const accept = req.get('Accept');
    if (accept && 
        !accept.includes('application/json') && 
        !accept.includes('application/fhir+json') && 
        !accept.includes('*/*')) {
        return res.status(406).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'not-supported',
                details: { 
                    text: 'Only application/json and application/fhir+json are supported',
                    coding: [{
                        system: 'http://terminology.hl7.org/CodeSystem/operation-outcome',
                        code: 'MSG_CONTENT_TYPE_NOT_SUPPORTED'
                    }]
                }
            }]
        });
    }

    // FHIR version validation
    const fhirVersion = req.get('Fhir-Version');
    if (fhirVersion && !fhirVersion.startsWith('4.0')) {
        return res.status(412).json({
            resourceType: 'OperationOutcome',
            issue: [{
                severity: 'error',
                code: 'not-supported',
                details: { 
                    text: 'Only FHIR R4 (4.0.x) is supported',
                    coding: [{
                        system: 'http://terminology.hl7.org/CodeSystem/operation-outcome',
                        code: 'MSG_VERSION_NOT_SUPPORTED'
                    }]
                }
            }]
        });
    }

    // Set FHIR response headers
    res.set({
        'Content-Type': 'application/fhir+json; fhirVersion=4.0',
        'X-Fhir-Version': '4.0.1'
    });

    next();
};

const validateFHIRStructure = (body, path) => {
    try {
        // Basic FHIR resource validation
        if (path.includes('/Bundle') && body.resourceType !== 'Bundle') {
            return { valid: false, message: 'Expected Bundle resource' };
        }

        if (path.includes('/$lookup') || path.includes('/$expand') || path.includes('/$translate')) {
            if (body.resourceType && body.resourceType !== 'Parameters') {
                return { valid: false, message: 'FHIR operations require Parameters resource' };
            }
        }

        // Validate Bundle structure
        if (body.resourceType === 'Bundle') {
            if (!body.type) {
                return { valid: false, message: 'Bundle.type is required' };
            }
            
            if (!body.entry || !Array.isArray(body.entry)) {
                return { valid: false, message: 'Bundle.entry must be an array' };
            }

            // Validate each entry
            for (let i = 0; i < body.entry.length; i++) {
                const entry = body.entry[i];
                if (!entry.resource) {
                    return { valid: false, message: `Bundle.entry[${i}].resource is required` };
                }
                
                if (!entry.resource.resourceType) {
                    return { valid: false, message: `Bundle.entry[${i}].resource.resourceType is required` };
                }
            }
        }

        // Validate Condition resource for dual coding requirements
        if (body.resourceType === 'Condition') {
            if (!body.code || !body.code.coding || !Array.isArray(body.code.coding)) {
                return { valid: false, message: 'Condition.code.coding is required and must be an array' };
            }

            if (body.code.coding.length < 1) {
                return { valid: false, message: 'At least one coding is required for Condition' };
            }

            // Check for required system and code
            for (const coding of body.code.coding) {
                if (!coding.system) {
                    return { valid: false, message: 'Coding.system is required' };
                }
                if (!coding.code) {
                    return { valid: false, message: 'Coding.code is required' };
                }
            }
        }

        return { valid: true };

    } catch (error) {
        return { valid: false, message: 'Invalid JSON structure' };
    }
};

module.exports = validationMiddleware;
