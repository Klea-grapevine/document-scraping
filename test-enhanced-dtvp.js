const { runDocumentScrapeFromDocumentsPage } = require('./dist/document-scraper');

// Test the enhanced DTVP scraper with the specific URL
async function testEnhancedDtvp() {
    console.log('🚀 Testing Enhanced DTVP Scraper with Tab Content...\n');
    
    const dtvpUrl = 'https://www.dtvp.de/Satellite/public/company/project/CXP4YDK5GK4/de/documents';
    
    console.log(`Testing URL: ${dtvpUrl}`);
    console.log('This test will:');
    console.log('1. Extract information from Übersicht tab');
    console.log('2. Extract information from Verfahrensangaben tab');
    console.log('3. Download and process all documents');
    console.log('4. Create a comprehensive summary from ALL information\n');
    
    try {
        await runDocumentScrapeFromDocumentsPage(dtvpUrl);
        console.log('\n✅ Enhanced DTVP scraping completed successfully!');
    } catch (error) {
        console.error('❌ Error during enhanced DTVP scraping:', error);
    }
}

// Run the test
testEnhancedDtvp();
