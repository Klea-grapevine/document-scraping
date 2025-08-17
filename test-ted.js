const { exec } = require('child_process');

// Test with the TED URL from the example
const tedUrl = 'https://ted.europa.eu/de/notice/-/detail/488905-2025';

console.log('🧪 Testing TED URL extraction and document scraping...\n');
console.log(`📋 TED URL: ${tedUrl}\n`);

// Run the scraper
const command = `npm start "${tedUrl}"`;

console.log(`🚀 Running: ${command}\n`);

exec(command, (error, stdout, stderr) => {
    if (error) {
        console.error('❌ Error:', error);
        return;
    }
    
    if (stderr) {
        console.error('⚠️ Stderr:', stderr);
    }
    
    console.log('📤 Output:');
    console.log(stdout);
});

