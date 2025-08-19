const { runDocumentScrapeFromDocumentsPage } = require('./dist/document-scraper');

async function testEvergabeSachsen() {
    console.log('Testing Evergabe Sachsen host handler...');
    
    const testUrl = 'https://www.evergabe.sachsen.de/NetServer/TenderingProcedureDetails?function=_Details&TenderOID=54321-NetTender-198be01883c-401ac803880a4ec8&thContext=publications';
    
    try {
        await runDocumentScrapeFromDocumentsPage(testUrl);
        console.log('Test completed successfully!');
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testEvergabeSachsen();

