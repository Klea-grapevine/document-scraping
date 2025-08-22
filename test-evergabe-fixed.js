const { runDocumentScrapeFromDocumentsPage } = require('./dist/document-scraper');

// Test URL for evergabe-online (you can replace this with a real URL)
const testUrl = 'https://www.evergabe-online.de/example-documents-page';

console.log('Testing fixed evergabe-online handler...');
console.log('This should now work without file system downloads');

runDocumentScrapeFromDocumentsPage(testUrl)
    .then(() => {
        console.log('Test completed successfully!');
    })
    .catch((error) => {
        console.error('Test failed:', error);
    });
