const { runDocumentScrapeFromDocumentsPage } = require('./dist/document-scraper');

// Test the new Evergabe Online host
async function testEvergabeOnline() {
    console.log('🧪 Testing Evergabe Online Host Handler\n');
    
    const testUrl = 'https://www.evergabe-online.de/tenderdocuments.html?0&id=794779&cookieCheck';
    
    console.log(`📋 Testing URL: ${testUrl}`);
    console.log('🎯 Expected behavior:');
    console.log('1. Detect Evergabe Online platform');
    console.log('2. Look for "Als ZIP-Datei herunterladen" button next to "Unterlagen zu dieser Ausschreibung"');
    console.log('3. Click the ZIP download button');
    console.log('4. Capture and process downloaded documents');
    console.log('\n🚀 Starting test...\n');
    
    try {
        await runDocumentScrapeFromDocumentsPage(testUrl);
        console.log('\n✅ Test completed successfully!');
    } catch (error) {
        console.error('\n❌ Test failed:', error);
    }
}

testEvergabeOnline();
