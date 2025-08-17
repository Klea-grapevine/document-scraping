const { runDocumentScrapeFromDocumentsPage } = require('./dist/document-scraper');

async function testNewHosts() {
    console.log('Testing new host handlers...\n');
    
    const testUrls = [
        'https://www.vergabe.metropoleruhr.de/VMPSatellite/public/company/project/CXPSYYWDZ8V/de/documents?1',
        'https://vergabemarktplatz.brandenburg.de/VMPSatellite/public/company/project/CXP9YRJHBBJ/de/documents?1',
        'https://vergabeportal-bw.de/Satellite/public/company/project/CXRAYY6YHAA/de/documents'
    ];
    
    for (const url of testUrls) {
        console.log(`\n🔍 Testing URL: ${url}`);
        console.log('=' .repeat(80));
        
        try {
            await runDocumentScrapeFromDocumentsPage(url);
            console.log('✅ Test completed successfully');
        } catch (error) {
            console.log('❌ Test failed:', error.message);
        }
        
        console.log('\n' + '=' .repeat(80));
    }
}

// Run the tests
testNewHosts().catch(console.error);
