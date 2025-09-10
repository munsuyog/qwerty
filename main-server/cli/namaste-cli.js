// ===============================================
// CLI INTERFACE (cli/namaste-cli.js)
// ===============================================

// #!/usr/bin/env node

const { program } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const Table = require('cli-table3');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Import services
const NAMASTEService = require('../src/services/namasteService');
const ICD11Service = require('../src/services/icd11Service');
const SearchService = require('../src/services/searchService');

// CLI Configuration
const DEFAULT_BASE_URL = 'http://localhost:3000';
let baseUrl = process.env.NAMASTE_FHIR_URL || DEFAULT_BASE_URL;
let authToken = process.env.NAMASTE_AUTH_TOKEN;

// ===============================================
// UTILITY FUNCTIONS
// ===============================================

const spinner = ora();

const logSuccess = (message) => console.log(chalk.green('✓'), message);
const logError = (message) => console.log(chalk.red('✗'), message);
const logWarning = (message) => console.log(chalk.yellow('⚠'), message);
const logInfo = (message) => console.log(chalk.blue('ℹ'), message);

const makeRequest = async (endpoint, options = {}) => {
    try {
        const config = {
            baseURL: baseUrl,
            headers: {
                'Content-Type': 'application/json',
                ...(authToken && { Authorization: `Bearer ${authToken}` })
            },
            ...options
        };
        
        const response = await axios(endpoint, config);
        return response.data;
    } catch (error) {
        if (error.response) {
            throw new Error(`API Error: ${error.response.status} - ${error.response.data?.error || error.response.statusText}`);
        }
        throw error;
    }
};

// ===============================================
// SETUP & CONFIGURATION COMMANDS
// ===============================================

program
    .name('namaste-cli')
    .description('CLI for NAMASTE FHIR Terminology Server')
    .version('1.0.0');

program
    .command('config')
    .description('Configure CLI settings')
    .action(async () => {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'baseUrl',
                message: 'FHIR Server Base URL:',
                default: baseUrl
            },
            {
                type: 'password',
                name: 'authToken',
                message: 'Auth Token (optional):',
                default: authToken
            }
        ]);
        
        baseUrl = answers.baseUrl;
        authToken = answers.authToken;
        
        // Save config to file
        const configPath = path.join(process.env.HOME || process.env.USERPROFILE, '.namaste-cli.json');
        const config = { baseUrl, authToken };
        
        try {
            await fs.writeFile(configPath, JSON.stringify(config, null, 2));
            logSuccess('Configuration saved successfully');
        } catch (error) {
            logError(`Failed to save configuration: ${error.message}`);
        }
    });

// ===============================================
// HEALTH & STATUS COMMANDS
// ===============================================

program
    .command('status')
    .description('Check server health and status')
    .option('-d, --detailed', 'Show detailed health information')
    .action(async (options) => {
        spinner.start('Checking server status...');
        
        try {
            const endpoint = options.detailed ? '/health/detailed' : '/health';
            const health = await makeRequest(endpoint);
            
            spinner.stop();
            
            const statusColor = health.status === 'healthy' ? chalk.green : 
                               health.status === 'degraded' ? chalk.yellow : chalk.red;
            
            console.log(`\nServer Status: ${statusColor(health.status.toUpperCase())}`);
            console.log(`Uptime: ${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`);
            console.log(`Environment: ${health.environment}`);
            
            if (options.detailed && health.components) {
                console.log('\nComponent Health:');
                const table = new Table({
                    head: ['Component', 'Status', 'Details'],
                    colWidths: [15, 12, 40]
                });
                
                Object.entries(health.components).forEach(([component, info]) => {
                    const status = info.status === 'healthy' ? chalk.green(info.status) :
                                  info.status === 'degraded' ? chalk.yellow(info.status) :
                                  chalk.red(info.status);
                    
                    const details = info.responseTime || info.error || 'OK';
                    table.push([component, status, details]);
                });
                
                console.log(table.toString());
            }
            
        } catch (error) {
            spinner.stop();
            logError(`Failed to get server status: ${error.message}`);
            process.exit(1);
        }
    });

// ===============================================
// TERMINOLOGY SEARCH COMMANDS
// ===============================================

program
    .command('search <query>')
    .description('Search terminology codes')
    .option('-s, --system <system>', 'Filter by code system')
    .option('-t, --type <type>', 'Filter by system type (namaste, icd11-tm2, icd11-bio)')
    .option('-c, --count <count>', 'Number of results to return', '10')
    .option('--dual-coding', 'Include dual coding mappings')
    .action(async (query, options) => {
        spinner.start(`Searching for "${query}"...`);
        
        try {
            const params = new URLSearchParams({
                q: query,
                count: options.count
            });
            
            if (options.system) params.append('system', options.system);
            if (options.type) params.append('systemType', options.type);
            
            const endpoint = options.dualCoding ? 
                `/fhir/ValueSet/dual-coding-search?${params}` :
                `/fhir/ValueSet/search?${params}`;
            
            const results = await makeRequest(endpoint);
            
            spinner.stop();
            
            if (results.total === 0) {
                logWarning('No results found');
                return;
            }
            
            console.log(`\nFound ${results.total} results:\n`);
            
            if (options.dualCoding) {
                // Display dual coding results
                results.entry.forEach((entry, index) => {
                    const params = entry.resource.parameter;
                    const namaste = params.find(p => p.name === 'namaste-coding')?.valueCoding;
                    const icd11TM2 = params.find(p => p.name === 'icd11-tm2-coding')?.valueCoding;
                    const icd11Bio = params.find(p => p.name === 'icd11-bio-coding')?.valueCoding;
                    const score = params.find(p => p.name === 'relevance-score')?.valueDecimal;
                    
                    console.log(chalk.cyan(`${index + 1}. NAMASTE: ${namaste.code} - ${namaste.display}`));
                    if (icd11TM2) {
                        console.log(chalk.green(`   ICD-11 TM2: ${icd11TM2.code} - ${icd11TM2.display}`));
                    }
                    if (icd11Bio) {
                        console.log(chalk.blue(`   ICD-11 Bio: ${icd11Bio.code} - ${icd11Bio.display}`));
                    }
                    console.log(chalk.gray(`   Relevance: ${(score * 100).toFixed(1)}%\n`));
                });
            } else {
                // Display regular search results
                const table = new Table({
                    head: ['Code', 'Display', 'System', 'Score'],
                    colWidths: [12, 40, 20, 10]
                });
                
                results.entry.forEach(entry => {
                    const coding = entry.resource.code.coding[0];
                    const extensions = entry.resource.extension || [];
                    const searchExt = extensions.find(ext => ext.url.includes('search-metadata'));
                    const score = searchExt?.extension?.find(ext => ext.url === 'relevanceScore')?.valueDecimal || 0;
                    const systemType = searchExt?.extension?.find(ext => ext.url === 'systemType')?.valueString || 'unknown';
                    
                    table.push([
                        coding.code,
                        coding.display.length > 37 ? coding.display.substring(0, 37) + '...' : coding.display,
                        systemType,
                        `${(score * 100).toFixed(1)}%`
                    ]);
                });
                
                console.log(table.toString());
            }
            
        } catch (error) {
            spinner.stop();
            logError(`Search failed: ${error.message}`);
            process.exit(1);
        }
    });

// ===============================================
// CODE LOOKUP COMMANDS
// ===============================================

program
    .command('lookup <system> <code>')
    .description('Look up a specific code in a code system')
    .action(async (system, code) => {
        spinner.start(`Looking up ${code} in ${system}...`);
        
        try {
            const response = await makeRequest('/fhir/CodeSystem/$lookup', {
                method: 'POST',
                data: { system, code }
            });
            
            spinner.stop();
            
            const result = response.parameter?.find(p => p.name === 'result')?.valueBoolean;
            
            if (!result) {
                logError(`Code ${code} not found in system ${system}`);
                return;
            }
            
            console.log(chalk.green(`\nCode found:`));
            
            const table = new Table({ colWidths: [20, 50] });
            
            response.parameter.forEach(param => {
                if (param.name === 'result') return;
                
                if (param.name === 'property' && param.part) {
                    const propCode = param.part.find(p => p.name === 'code')?.valueString;
                    const propValue = param.part.find(p => p.name === 'value')?.valueString;
                    table.push([`Property: ${propCode}`, propValue || '']);
                } else {
                    table.push([param.name, param.valueString || param.valueCode || '']);
                }
            });
            
            console.log(table.toString());
            
        } catch (error) {
            spinner.stop();
            logError(`Lookup failed: ${error.message}`);
            process.exit(1);
        }
    });

// ===============================================
// TRANSLATION COMMANDS
// ===============================================

program
    .command('translate <sourceSystem> <sourceCode> <targetSystem>')
    .description('Translate a code between systems')
    .action(async (sourceSystem, sourceCode, targetSystem) => {
        spinner.start(`Translating ${sourceCode} from ${sourceSystem} to ${targetSystem}...`);
        
        try {
            const response = await makeRequest('/fhir/ConceptMap/$translate', {
                method: 'POST',
                data: {
                    system: sourceSystem,
                    code: sourceCode,
                    target: targetSystem
                }
            });
            
            spinner.stop();
            
            const result = response.parameter?.find(p => p.name === 'result')?.valueBoolean;
            
            if (!result) {
                logWarning('No translation found');
                const message = response.parameter?.find(p => p.name === 'message')?.valueString;
                if (message) console.log(chalk.gray(message));
                return;
            }
            
            const match = response.parameter?.find(p => p.name === 'match');
            if (match && match.part) {
                const equivalence = match.part.find(p => p.name === 'equivalence')?.valueCode;
                const concept = match.part.find(p => p.name === 'concept')?.valueCoding;
                
                console.log(chalk.green('\nTranslation found:'));
                console.log(`Source: ${sourceCode} (${sourceSystem})`);
                console.log(`Target: ${concept.code} - ${concept.display}`);
                console.log(`Equivalence: ${equivalence}`);
                console.log(`Target System: ${concept.system}`);
            }
            
        } catch (error) {
            spinner.stop();
            logError(`Translation failed: ${error.message}`);
            process.exit(1);
        }
    });

// ===============================================
// ADMIN COMMANDS
// ===============================================

program
    .command('admin')
    .description('Administrative commands')
    .addCommand(
        program.createCommand('dashboard')
            .description('Show admin dashboard')
            .action(async () => {
                spinner.start('Loading dashboard...');
                
                try {
                    const dashboard = await makeRequest('/admin/dashboard');
                    
                    spinner.stop();
                    
                    console.log(chalk.bold('\n=== NAMASTE FHIR Server Dashboard ===\n'));
                    
                    // Overview statistics
                    const overview = dashboard.overview;
                    const overviewTable = new Table({
                        head: ['Metric', 'Value'],
                        colWidths: [25, 15]
                    });
                    
                    overviewTable.push(
                        ['Code Systems', overview.codeSystems.totalCodeSystems],
                        ['Total Concepts', overview.codeSystems.totalConcepts],
                        ['NAMASTE Systems', overview.codeSystems.namasteCount],
                        ['ICD-11 Systems', overview.codeSystems.icd11Count],
                        ['Value Sets', overview.valueSets],
                        ['Concept Maps', overview.conceptMaps.totalMaps],
                        ['Total Mappings', overview.conceptMaps.totalMappings]
                    );
                    
                    console.log('System Overview:');
                    console.log(overviewTable.toString());
                    
                    // Usage statistics
                    if (overview.usage) {
                        console.log('\nUsage Statistics (Last 30 days):');
                        const usageTable = new Table({
                            head: ['Metric', 'Count'],
                            colWidths: [25, 15]
                        });
                        
                        usageTable.push(
                            ['Total Requests', overview.usage.totalRequests],
                            ['Unique Users', overview.usage.uniqueUserCount],
                            ['Search Requests', overview.usage.searchRequests],
                            ['Lookup Requests', overview.usage.lookupRequests],
                            ['Translations', overview.usage.translationRequests],
                            ['Bundle Submissions', overview.usage.bundleSubmissions]
                        );
                        
                        console.log(usageTable.toString());
                    }
                    
                    // System health
                    if (dashboard.systemHealth) {
                        console.log('\nSystem Health:');
                        const healthStatus = dashboard.systemHealth.status === 'healthy' ? 
                            chalk.green('HEALTHY') : 
                            dashboard.systemHealth.status === 'degraded' ? 
                            chalk.yellow('DEGRADED') : 
                            chalk.red('UNHEALTHY');
                        console.log(`Status: ${healthStatus}`);
                    }
                    
                } catch (error) {
                    spinner.stop();
                    logError(`Failed to load dashboard: ${error.message}`);
                    process.exit(1);
                }
            })
    )
    .addCommand(
        program.createCommand('sync-icd11')
            .description('Sync ICD-11 data from WHO API')
            .action(async () => {
                spinner.start('Syncing ICD-11 data...');
                
                try {
                    const result = await makeRequest('/admin/sync-icd11', {
                        method: 'POST'
                    });
                    
                    spinner.stop();
                    logSuccess('ICD-11 sync completed successfully');
                    
                    if (result.result) {
                        console.log(`TM2 Categories: ${result.result.tm2Categories}`);
                        console.log(`Biomedicine Categories: ${result.result.biomedicineCategories}`);
                        console.log(`Completed at: ${result.result.timestamp}`);
                    }
                    
                } catch (error) {
                    spinner.stop();
                    logError(`ICD-11 sync failed: ${error.message}`);
                    process.exit(1);
                }
            })
    )
    .addCommand(
        program.createCommand('refresh-index')
            .description('Refresh search index')
            .action(async () => {
                spinner.start('Refreshing search index...');
                
                try {
                    const result = await makeRequest('/admin/refresh-search-index', {
                        method: 'POST'
                    });
                    
                    spinner.stop();
                    logSuccess('Search index refreshed successfully');
                    
                    if (result.stats) {
                        console.log(`Total entries: ${result.stats.totalEntries}`);
                        console.log(`Index version: ${result.stats.indexVersion}`);
                    }
                    
                } catch (error) {
                    spinner.stop();
                    logError(`Index refresh failed: ${error.message}`);
                    process.exit(1);
                }
            })
    )
    .addCommand(
        program.createCommand('upload-namaste <file>')
            .description('Upload and process NAMASTE Excel file')
            .action(async (file) => {
                spinner.start('Uploading and processing NAMASTE file...');
                
                try {
                    const FormData = require('form-data');
                    const form = new FormData();
                    const fileStream = require('fs').createReadStream(file);
                    form.append('namasteFile', fileStream);
                    
                    const result = await makeRequest('/admin/upload-namaste', {
                        method: 'POST',
                        data: form,
                        headers: {
                            ...form.getHeaders(),
                            ...(authToken && { Authorization: `Bearer ${authToken}` })
                        }
                    });
                    
                    spinner.stop();
                    logSuccess('NAMASTE file processed successfully');
                    
                    if (result.result) {
                        console.log(`Concepts processed: ${result.result.concepts}`);
                        console.log(`Value sets created: ${result.result.valueSets}`);
                        console.log(`File: ${result.file.originalName} (${(result.file.size / 1024).toFixed(1)} KB)`);
                    }
                    
                } catch (error) {
                    spinner.stop();
                    logError(`File upload failed: ${error.message}`);
                    process.exit(1);
                }
            })
    )
    .addCommand(
        program.createCommand('stats')
            .description('Show system statistics')
            .action(async () => {
                spinner.start('Loading statistics...');
                
                try {
                    const stats = await makeRequest('/admin/stats');
                    
                    spinner.stop();
                    
                    console.log(chalk.bold('\n=== System Statistics ===\n'));
                    
                    const table = new Table({
                        head: ['Metric', 'Value'],
                        colWidths: [25, 15]
                    });
                    
                    table.push(
                        ['Code Systems', stats.codeSystems],
                        ['Value Sets', stats.valueSets],
                        ['Concept Maps', stats.conceptMaps],
                        ['Audit Events', stats.auditEvents],
                        ['System Uptime', `${Math.floor(stats.systemUptime / 3600)}h ${Math.floor((stats.systemUptime % 3600) / 60)}m`]
                    );
                    
                    console.log(table.toString());
                    
                    if (stats.lastSync) {
                        console.log(`\nLast ICD-11 Sync: ${new Date(stats.lastSync).toLocaleString()}`);
                    }
                    
                    if (stats.lastNAMASTEUpdate) {
                        console.log(`Last NAMASTE Update: ${new Date(stats.lastNAMASTEUpdate).toLocaleString()}`);
                    }
                    
                } catch (error) {
                    spinner.stop();
                    logError(`Failed to load statistics: ${error.message}`);
                    process.exit(1);
                }
            })
    );

// ===============================================
// INTERACTIVE MODE
// ===============================================

async function loadInquirer() {
    if (!inquirer) {
        try {
            // Try dynamic import for newer Node.js versions
            const inquirerModule = await import('inquirer');
            inquirer = inquirerModule.default || inquirerModule;
        } catch (err) {
            logError('Failed to load inquirer module. Please install inquirer:');
            console.log(chalk.gray('npm install inquirer@^8.2.6'));
            process.exit(1);
        }
    }
    return inquirer;
}

program
    .command('interactive')
    .alias('i')
    .description('Start interactive mode')
    .action(async () => {
        await loadInquirer();
        
        console.log(chalk.bold.blue('\n🏥 NAMASTE FHIR Terminology Server CLI\n'));
        console.log(chalk.gray('Welcome to the interactive mode. Choose an operation from the menu below.\n'));
        
        while (true) {
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'What would you like to do?',
                    choices: [
                        { name: '🔍 Search terminology', value: 'search' },
                        { name: '🔎 Lookup specific code', value: 'lookup' },
                        { name: '🔄 Translate between systems', value: 'translate' },
                        { name: '📊 View system status', value: 'status' },
                        { name: '⚙️  Admin dashboard', value: 'admin' },
                        { name: '📈 System statistics', value: 'stats' },
                        { name: '🚪 Exit', value: 'exit' }
                    ]
                }
            ]);
            
            if (action === 'exit') {
                console.log(chalk.green('\n👋 Goodbye! Thank you for using NAMASTE FHIR CLI.\n'));
                break;
            }
            
            try {
                switch (action) {
                    case 'search':
                        await interactiveSearch();
                        break;
                    case 'lookup':
                        await interactiveLookup();
                        break;
                    case 'translate':
                        await interactiveTranslate();
                        break;
                    case 'status':
                        await interactiveStatus();
                        break;
                    case 'admin':
                        await interactiveAdmin();
                        break;
                    case 'stats':
                        await interactiveStats();
                        break;
                }
            } catch (error) {
                logError(`Operation failed: ${error.message}`);
            }
            
            console.log('\n' + chalk.gray('─'.repeat(60)) + '\n');
        }
    });

// ===============================================
// INTERACTIVE FUNCTIONS
// ===============================================

async function interactiveSearch() {
    const { query, systemType, dualCoding, count } = await inquirer.prompt([
        {
            type: 'input',
            name: 'query',
            message: 'Enter search term:',
            validate: input => input.length >= 2 || 'Please enter at least 2 characters'
        },
        {
            type: 'list',
            name: 'systemType',
            message: 'Filter by system type:',
            choices: [
                { name: 'All systems', value: null },
                { name: 'NAMASTE only', value: 'namaste' },
                { name: 'ICD-11 TM2 only', value: 'icd11-tm2' },
                { name: 'ICD-11 Biomedicine only', value: 'icd11-bio' }
            ]
        },
        {
            type: 'confirm',
            name: 'dualCoding',
            message: 'Include dual coding mappings?',
            default: true
        },
        {
            type: 'number',
            name: 'count',
            message: 'Number of results to show:',
            default: 10,
            validate: input => input > 0 && input <= 50 || 'Please enter a number between 1 and 50'
        }
    ]);
    
    const params = new URLSearchParams({ q: query, count: count.toString() });
    if (systemType) params.append('systemType', systemType);
    
    const endpoint = dualCoding ? 
        `/fhir/ValueSet/dual-coding-search?${params}` :
        `/fhir/ValueSet/search?${params}`;
    
    spinner.start('Searching...');
    const results = await makeRequest(endpoint);
    spinner.stop();
    
    if (results.total === 0) {
        logWarning('No results found');
        return;
    }
    
    console.log(chalk.green(`\n✅ Found ${results.total} results (showing ${Math.min(count, results.entry.length)}):\n`));
    
    if (dualCoding) {
        results.entry.slice(0, count).forEach((entry, index) => {
            const params = entry.resource.parameter;
            const namaste = params.find(p => p.name === 'namaste-coding')?.valueCoding;
            const icd11TM2 = params.find(p => p.name === 'icd11-tm2-coding')?.valueCoding;
            const icd11Bio = params.find(p => p.name === 'icd11-bio-coding')?.valueCoding;
            const score = params.find(p => p.name === 'relevance-score')?.valueDecimal;
            
            console.log(chalk.cyan(`${index + 1}. NAMASTE: ${namaste.code} - ${namaste.display}`));
            if (icd11TM2) {
                console.log(chalk.green(`   ↳ ICD-11 TM2: ${icd11TM2.code} - ${icd11TM2.display}`));
            }
            if (icd11Bio) {
                console.log(chalk.blue(`   ↳ ICD-11 Bio: ${icd11Bio.code} - ${icd11Bio.display}`));
            }
            console.log(chalk.gray(`   Relevance: ${(score * 100).toFixed(1)}%\n`));
        });
    } else {
        const table = new Table({
            head: ['#', 'Code', 'Display', 'System', 'Score'],
            colWidths: [3, 10, 35, 15, 8]
        });
        
        results.entry.slice(0, count).forEach((entry, index) => {
            const coding = entry.resource.code.coding[0];
            const extensions = entry.resource.extension || [];
            const searchExt = extensions.find(ext => ext.url.includes('search-metadata'));
            const score = searchExt?.extension?.find(ext => ext.url === 'relevanceScore')?.valueDecimal || 0;
            const systemType = searchExt?.extension?.find(ext => ext.url === 'systemType')?.valueString || 'unknown';
            
            table.push([
                index + 1,
                coding.code,
                coding.display.length > 32 ? coding.display.substring(0, 32) + '...' : coding.display,
                systemType,
                `${(score * 100).toFixed(1)}%`
            ]);
        });
        
        console.log(table.toString());
    }
}

async function interactiveLookup() {
    const { system, code } = await inquirer.prompt([
        {
            type: 'list',
            name: 'system',
            message: 'Select code system:',
            choices: [
                { name: 'NAMASTE', value: 'http://terminology.ayush.gov.in/CodeSystem/namaste' },
                { name: 'ICD-11 Traditional Medicine', value: 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine' },
                { name: 'ICD-11 Biomedicine', value: 'http://id.who.int/icd/release/11/2023-01/mms' },
                { name: 'Custom URL...', value: 'custom' }
            ]
        },
        {
            type: 'input',
            name: 'system',
            message: 'Enter custom system URL:',
            when: (answers) => answers.system === 'custom',
            validate: input => input.length > 0 || 'System URL is required'
        },
        {
            type: 'input',
            name: 'code',
            message: 'Enter code to lookup:',
            validate: input => input.length > 0 || 'Code is required'
        }
    ]);
    
    spinner.start('Looking up code...');
    const response = await makeRequest('/fhir/CodeSystem/$lookup', {
        method: 'POST',
        data: { system, code }
    });
    spinner.stop();
    
    const result = response.parameter?.find(p => p.name === 'result')?.valueBoolean;
    
    if (result) {
        logSuccess(`Code ${code} found!`);
        
        const table = new Table({
            head: ['Property', 'Value'],
            colWidths: [20, 50]
        });
        
        response.parameter.forEach(param => {
            if (param.name === 'result') return;
            
            if (param.name === 'property' && param.part) {
                const propCode = param.part.find(p => p.name === 'code')?.valueString;
                const propValue = param.part.find(p => p.name === 'value')?.valueString;
                table.push([`Property: ${propCode}`, propValue || 'N/A']);
            } else {
                table.push([param.name, param.valueString || param.valueCode || 'N/A']);
            }
        });
        
        console.log(table.toString());
    } else {
        logError(`Code ${code} not found in system`);
        const message = response.parameter?.find(p => p.name === 'message')?.valueString;
        if (message) console.log(chalk.gray(`Details: ${message}`));
    }
}

async function interactiveTranslate() {
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'sourceSystem',
            message: 'Source system:',
            choices: [
                { name: 'NAMASTE', value: 'http://terminology.ayush.gov.in/CodeSystem/namaste' },
                { name: 'ICD-11 TM2', value: 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine' }
            ]
        },
        {
            type: 'input',
            name: 'sourceCode',
            message: 'Source code:',
            validate: input => input.length > 0 || 'Code is required'
        },
        {
            type: 'list',
            name: 'targetSystem',
            message: 'Target system:',
            choices: (answers) => {
                const options = [
                    { name: 'NAMASTE', value: 'http://terminology.ayush.gov.in/CodeSystem/namaste' },
                    { name: 'ICD-11 TM2', value: 'http://id.who.int/icd/release/11/2023-01/mms/traditional-medicine' },
                    { name: 'ICD-11 Biomedicine', value: 'http://id.who.int/icd/release/11/2023-01/mms' }
                ];
                return options.filter(opt => opt.value !== answers.sourceSystem);
            }
        }
    ]);
    
    spinner.start('Translating code...');
    const response = await makeRequest('/fhir/ConceptMap/$translate', {
        method: 'POST',
        data: answers
    });
    spinner.stop();
    
    const result = response.parameter?.find(p => p.name === 'result')?.valueBoolean;
    
    if (result) {
        const match = response.parameter?.find(p => p.name === 'match');
        const concept = match?.part?.find(p => p.name === 'concept')?.valueCoding;
        const equivalence = match?.part?.find(p => p.name === 'equivalence')?.valueCode;
        
        logSuccess('Translation found!');
        
        const table = new Table({
            head: ['Property', 'Value'],
            colWidths: [20, 50]
        });
        
        table.push(
            ['Source Code', answers.sourceCode],
            ['Target Code', concept.code],
            ['Target Display', concept.display],
            ['Equivalence', equivalence],
            ['Target System', concept.system]
        );
        
        console.log(table.toString());
    } else {
        logWarning('No translation available');
        const message = response.parameter?.find(p => p.name === 'message')?.valueString;
        if (message) console.log(chalk.gray(`Details: ${message}`));
    }
}

async function interactiveStatus() {
    spinner.start('Checking system status...');
    const health = await makeRequest('/health/detailed');
    spinner.stop();
    
    const statusColor = health.status === 'healthy' ? chalk.green : 
                       health.status === 'degraded' ? chalk.yellow : chalk.red;
    
    console.log(`\n${statusColor('●')} System Status: ${statusColor(health.status.toUpperCase())}`);
    console.log(`🕐 Uptime: ${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`);
    console.log(`🌍 Environment: ${health.environment}`);
    
    if (health.components) {
        console.log('\n📊 Component Health:');
        const table = new Table({
            head: ['Component', 'Status', 'Details'],
            colWidths: [20, 15, 30]
        });
        
        Object.entries(health.components).forEach(([component, info]) => {
            const status = info.status === 'healthy' ? chalk.green('✓ Healthy') :
                          info.status === 'degraded' ? chalk.yellow('⚠ Degraded') :
                          chalk.red('✗ Unhealthy');
            
            const details = info.responseTime || info.error || 'OK';
            table.push([component, status, details]);
        });
        
        console.log(table.toString());
    }
}

async function interactiveAdmin() {
    const { adminAction } = await inquirer.prompt([
        {
            type: 'list',
            name: 'adminAction',
            message: 'Select admin operation:',
            choices: [
                { name: '📊 View dashboard', value: 'dashboard' },
                { name: '🔄 Sync ICD-11 data', value: 'sync' },
                { name: '🔍 Refresh search index', value: 'refresh' },
                { name: '📈 View statistics', value: 'stats' },
                { name: '📤 Upload NAMASTE file', value: 'upload' },
                { name: '🔍 Test ICD-11 connection', value: 'test-icd11' }
            ]
        }
    ]);
    
    switch (adminAction) {
        case 'dashboard':
            spinner.start('Loading dashboard...');
            const dashboard = await makeRequest('/admin/dashboard');
            spinner.stop();
            
            console.log(chalk.bold('\n📊 Dashboard Overview\n'));
            
            const overviewTable = new Table({
                head: ['Metric', 'Value'],
                colWidths: [25, 15]
            });
            
            const overview = dashboard.overview;
            overviewTable.push(
                ['Code Systems', overview.codeSystems.totalCodeSystems],
                ['Total Concepts', overview.codeSystems.totalConcepts],
                ['Value Sets', overview.valueSets],
                ['Concept Maps', overview.conceptMaps.totalMaps],
                ['Requests (30d)', overview.usage.totalRequests],
                ['Unique Users (30d)', overview.usage.uniqueUserCount]
            );
            
            console.log(overviewTable.toString());
            
            if (dashboard.systemHealth) {
                const healthStatus = dashboard.systemHealth.status === 'healthy' ? 
                    chalk.green('HEALTHY') : 
                    dashboard.systemHealth.status === 'degraded' ? 
                    chalk.yellow('DEGRADED') : 
                    chalk.red('UNHEALTHY');
                console.log(`\nSystem Health: ${healthStatus}`);
            }
            break;
            
        case 'sync':
            const confirmSync = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'proceed',
                    message: 'This will sync data from WHO ICD-11 API. Continue?',
                    default: false
                }
            ]);
            
            if (confirmSync.proceed) {
                spinner.start('Syncing ICD-11 data...');
                const result = await makeRequest('/admin/sync-icd11', { method: 'POST' });
                spinner.stop();
                
                logSuccess('ICD-11 sync completed successfully');
                if (result.result) {
                    console.log(`📚 TM2 Categories: ${result.result.tm2Categories}`);
                    console.log(`🏥 Biomedicine Categories: ${result.result.biomedicineCategories}`);
                }
            }
            break;
            
        case 'refresh':
            spinner.start('Refreshing search index...');
            const refreshResult = await makeRequest('/admin/refresh-search-index', { method: 'POST' });
            spinner.stop();
            
            logSuccess('Search index refreshed successfully');
            if (refreshResult.stats) {
                console.log(`📊 Total entries: ${refreshResult.stats.totalEntries}`);
            }
            break;
            
        case 'stats':
            await interactiveStats();
            break;
            
        case 'upload':
            const { filePath } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'filePath',
                    message: 'Enter path to NAMASTE Excel file:',
                    validate: input => input.length > 0 || 'File path is required'
                }
            ]);
            
            spinner.start('Uploading NAMASTE file...');
            
            try {
                const FormData = require('form-data');
                const form = new FormData();
                const fileStream = require('fs').createReadStream(filePath);
                form.append('namasteFile', fileStream);
                
                const result = await makeRequest('/admin/upload-namaste', {
                    method: 'POST',
                    data: form,
                    headers: {
                        ...form.getHeaders(),
                        ...(authToken && { Authorization: `Bearer ${authToken}` })
                    }
                });
                
                spinner.stop();
                logSuccess('NAMASTE file processed successfully');
                
                if (result.result) {
                    console.log(`📚 Concepts processed: ${result.result.concepts}`);
                    console.log(`📋 Value sets created: ${result.result.valueSets}`);
                }
            } catch (error) {
                spinner.stop();
                logError(`File upload failed: ${error.message}`);
            }
            break;
            
        case 'test-icd11':
            spinner.start('Testing ICD-11 connection...');
            const connectionTest = await makeRequest('/admin/test-icd11-connection');
            spinner.stop();
            
            if (connectionTest.status === 'connected') {
                logSuccess('ICD-11 API connection successful');
                console.log(`🔐 Authenticated: ${connectionTest.authenticated ? 'Yes' : 'No'}`);
                console.log(`🌐 API Responsive: ${connectionTest.apiResponsive ? 'Yes' : 'No'}`);
            } else {
                logError('ICD-11 API connection failed');
                console.log(chalk.gray(`Details: ${connectionTest.error}`));
            }
            break;
    }
}

async function interactiveStats() {
    spinner.start('Loading statistics...');
    const stats = await makeRequest('/admin/stats');
    spinner.stop();
    
    console.log(chalk.bold('\n📈 System Statistics\n'));
    
    const statsTable = new Table({
        head: ['Metric', 'Value'],
        colWidths: [25, 20]
    });
    
    statsTable.push(
        ['Code Systems', stats.codeSystems],
        ['Value Sets', stats.valueSets],
        ['Concept Maps', stats.conceptMaps],
        ['Audit Events', stats.auditEvents],
        ['System Uptime', `${Math.floor(stats.systemUptime / 3600)}h ${Math.floor((stats.systemUptime % 3600) / 60)}m`]
    );
    
    console.log(statsTable.toString());
    
    if (stats.lastSync) {
        console.log(`\n🔄 Last ICD-11 Sync: ${chalk.cyan(new Date(stats.lastSync).toLocaleString())}`);
    }
    
    if (stats.lastNAMASTEUpdate) {
        console.log(`📚 Last NAMASTE Update: ${chalk.cyan(new Date(stats.lastNAMASTEUpdate).toLocaleString())}`);
    }
    
    // Show daily usage if available
    if (stats.usage && stats.usage.daily && stats.usage.daily.length > 0) {
        console.log('\n📊 Daily Usage (Last 7 days):');
        const usageTable = new Table({
            head: ['Date', 'Requests', 'Users'],
            colWidths: [12, 10, 8]
        });
        
        stats.usage.daily.slice(-7).forEach(day => {
            usageTable.push([day.date, day.requests, day.uniqueUsers]);
        });
        
        console.log(usageTable.toString());
    }
}

// ===============================================
// VALIDATION COMMANDS
// ===============================================

program
    .command('validate')
    .description('Validation commands')
    .addCommand(
        program.createCommand('bundle <file>')
            .description('Validate FHIR Bundle file')
            .action(async (file) => {
                spinner.start('Validating Bundle...');
                
                try {
                    const bundleData = await fs.readFile(file, 'utf8');
                    const bundle = JSON.parse(bundleData);
                    
                    const result = await makeRequest('/fhir/Bundle', {
                        method: 'POST',
                        data: bundle
                    });
                    
                    spinner.stop();
                    
                    if (result.resourceType === 'Bundle') {
                        logSuccess('Bundle validation successful');
                        
                        const successCount = result.entry?.filter(e => 
                            e.response?.status?.startsWith('20')
                        ).length || 0;
                        
                        console.log(`✅ ${successCount}/${result.entry?.length || 0} entries processed successfully`);
                    } else {
                        logError('Bundle validation failed');
                    }
                    
                } catch (error) {
                    spinner.stop();
                    logError(`Bundle validation failed: ${error.message}`);
                    process.exit(1);
                }
            })
    )
    .addCommand(
        program.createCommand('coding <system> <code>')
            .description('Validate a coding')
            .action(async (system, code) => {
                spinner.start('Validating coding...');
                
                try {
                    const response = await makeRequest('/fhir/CodeSystem/$lookup', {
                        method: 'POST',
                        data: { system, code }
                    });
                    
                    spinner.stop();
                    
                    const result = response.parameter?.find(p => p.name === 'result')?.valueBoolean;
                    
                    if (result) {
                        logSuccess(`Coding ${system}|${code} is valid`);
                        const display = response.parameter?.find(p => p.name === 'display')?.valueString;
                        if (display) console.log(`Display: ${display}`);
                    } else {
                        logError(`Coding ${system}|${code} is invalid`);
                    }
                    
                } catch (error) {
                    spinner.stop();
                    logError(`Coding validation failed: ${error.message}`);
                    process.exit(1);
                }
            })
    );

// ===============================================
// UTILITY COMMANDS
// ===============================================

program
    .command('generate-token')
    .description('Generate a test JWT token for development')
    .option('-u, --user <user>', 'User ID', 'test-user')
    .option('-r, --role <role>', 'User role', 'practitioner')
    .action(async (options) => {
        try {
            const jwt = require('jsonwebtoken');
            const payload = {
                sub: options.user,
                healthId: '91-1234-5678-9012',
                name: 'Dr. Test User',
                userType: options.role,
                facilityId: 'test-facility',
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
            };
            
            const secret = process.env.JWT_SECRET || 'dev-secret';
            const token = jwt.sign(payload, secret);
            
            console.log(chalk.bold('\n🔑 Generated JWT Token:\n'));
            console.log(chalk.cyan(token));
            console.log(chalk.gray('\nThis token is valid for 24 hours in development mode.'));
            console.log(chalk.gray('Use: export NAMASTE_AUTH_TOKEN="<token>"'));
            
        } catch (error) {
            logError(`Token generation failed: ${error.message}`);
            process.exit(1);
        }
    });

program
    .command('docs')
    .description('Open documentation')
    .action(() => {
        const open = require('open');
        const docsUrl = `${baseUrl}/docs`;
        
        console.log(`Opening documentation: ${docsUrl}`);
        open(docsUrl).catch(() => {
            console.log(`Please open ${docsUrl} in your browser`);
        });
    });

// ===============================================
// LOAD CONFIGURATION & MAIN EXECUTION
// ===============================================

async function loadConfig() {
    try {
        const configPath = path.join(process.env.HOME || process.env.USERPROFILE, '.namaste-cli.json');
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        if (config.baseUrl) baseUrl = config.baseUrl;
        if (config.authToken) authToken = config.authToken;
        
        // Validate connection on config load
        if (process.argv.length > 2 && !['config', 'help', '--help', '-h'].includes(process.argv[2])) {
            try {
                await makeRequest('/health');
            } catch (error) {
                logWarning(`Unable to connect to server at ${baseUrl}`);
                logInfo('Run "namaste-cli config" to update server settings');
            }
        }
    } catch (error) {
        // Config file doesn't exist or is invalid, use defaults
        if (process.argv.length > 2 && !['config', 'help', '--help', '-h'].includes(process.argv[2])) {
            logInfo('No configuration found. Run "namaste-cli config" to set up connection details.');
        }
    }
}

async function main() {
    // Show banner for interactive mode or help
    if (process.argv.length === 2 || process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log(chalk.bold.blue('\n🏥 NAMASTE FHIR Terminology Server CLI'));
        console.log(chalk.gray('A command-line interface for NAMASTE-ICD11 terminology operations\n'));
    }
    
    await loadConfig();
    
    // If no arguments provided, start interactive mode
    if (process.argv.length === 2) {
        process.argv.push('interactive');
    }
    
    program.parse();
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
    logError(`Unexpected error: ${error.message}`);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logError(`Unhandled promise rejection: ${reason}`);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n⚠️  Operation cancelled by user'));
    process.exit(0);
});

if (require.main === module) {
    main().catch(error => {
        logError(`CLI Error: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { program, makeRequest, logSuccess, logError, logWarning, logInfo };