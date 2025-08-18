const { runDocumentScrapeFromDocumentsPage } = require('./dist/document-scraper');

// Example usage of the new host handlers
async function exampleUsage() {
    console.log('🚀 Document Scraper - New Hosts Example\n');
    
    // Example 1: Vergabe Metropole Ruhr
    console.log('📋 Example 1: Vergabe Metropole Ruhr');
    console.log('URL: https://www.vergabe.metropoleruhr.de/VMPSatellite/public/company/project/CXPSYYWDZ8V/de/documents?1');
    console.log('This will automatically detect and use the handleVergabeMetropoleruhr handler\n');
    
    // Example 2: Vergabemarktplatz Brandenburg
    console.log('📋 Example 2: Vergabemarktplatz Brandenburg');
    console.log('URL: https://vergabemarktplatz.brandenburg.de/VMPSatellite/public/company/project/CXP9YRJHBBJ/de/documents?1');
    console.log('This will automatically detect and use the handleVergabemarktplatzBrandenburg handler\n');
    
    // Example 3: Vergabeportal Baden-Württemberg
    console.log('📋 Example 3: Vergabeportal Baden-Württemberg');
    console.log('URL: https://vergabeportal-bw.de/Satellite/public/company/project/CXRAYY6YHAA/de/documents');
    console.log('This will automatically detect and use the handleVergabeportalBw handler\n');
    
    // Example 4: Evergabe Online
    console.log('📋 Example 4: Evergabe Online');
    console.log('URL: https://www.evergabe-online.de/tenderdocuments.html?1&id=794779');
    console.log('This will automatically detect and use the handleEvergabeOnline handler\n');
    
    console.log('💡 Usage:');
    console.log('npm start "https://www.vergabe.metropoleruhr.de/VMPSatellite/public/company/project/CXPSYYWDZ8V/de/documents?1"');
    console.log('npm start "https://vergabemarktplatz.brandenburg.de/VMPSatellite/public/company/project/CXP9YRJHBBJ/de/documents?1"');
    console.log('npm start "https://vergabeportal-bw.de/Satellite/public/company/project/CXRAYY6YHAA/de/documents"');
    console.log('npm start "https://www.evergabe-online.de/tenderdocuments.html?1&id=794779"');
    
    console.log('\n✨ The system will automatically:');
    console.log('1. Detect the platform type from the URL');
    console.log('2. Use the appropriate host-specific handler');
    console.log('3. Download all available documents');
    console.log('4. Process and summarize the content');
}

exampleUsage();
