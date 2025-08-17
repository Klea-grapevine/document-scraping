const { exec } = require('child_process');

console.log('🎯 Document Scraper & Summarizer - Example Usage\n');

// Example 1: TED.eu notice URL
console.log('📋 Example 1: Processing TED.eu notice');
console.log('URL: https://ted.europa.eu/de/notice/-/detail/488905-2025');
console.log('Command: npm start "https://ted.europa.eu/de/notice/-/detail/488905-2025"\n');

// Example 2: Direct DTVP document URL
console.log('📄 Example 2: Processing direct DTVP document URL');
console.log('URL: https://www.dtvp.de/Satellite/notice/CXP4YDK5GK4/documents');
console.log('Command: npm start "https://www.dtvp.de/Satellite/notice/CXP4YDK5GK4/documents"\n');

// Example 3: Other platform URLs
console.log('🌐 Example 3: Other supported platforms');
console.log('- Vergabe Niedersachsen: npm start "https://vergabe.niedersachsen.de/..."');
console.log('- Subreport Elvis: npm start "https://subreport-elvis.de/..."');
console.log('- Evergabe: npm start "https://evergabe.de/..."\n');

console.log('🚀 Quick Test Commands:');
console.log('npm run test:ted    # Test TED notice processing');
console.log('npm run test:dtvp   # Test DTVP document processing');
console.log('npm run test:vergabe # Test Vergabe Niedersachsen\n');

console.log('📊 Expected Output Format:');
console.log('1. Übersicht:');
console.log('   • Abgabefrist: [Deadline]');
console.log('   • Budget: [Amount]');
console.log('   • Vertragslaufzeit: [Duration]');
console.log('   • Vergabeart: [Type]');
console.log('   • Status: [Current Status]');
console.log('');
console.log('2. Zusammenfassung:');
console.log('   • Geforderte Leistungen: [Required Services]');
console.log('   • Eignungskriterien: [Eligibility Criteria]');
console.log('   • Zuschlagskriterien: [Award Criteria]');
console.log('   • Einzureichende Unterlagen: [Required Documents]');
console.log('   • Formalitäten: [Formalities]\n');

console.log('💡 Tips:');
console.log('- Make sure you have set up your OpenAI API key in .env');
console.log('- The system automatically detects the platform type');
console.log('- Documents are downloaded and processed automatically');
console.log('- AI generates structured summaries in German');
console.log('- Supports PDF, DOCX, and ZIP files\n');

console.log('🔧 Troubleshooting:');
console.log('- If TED extraction fails, the notice might not have document links yet');
console.log('- If downloads fail, documents might require authentication');
console.log('- Check console output for detailed error messages');
console.log('- Some platforms may have changed their structure\n');

