const { exec } = require('child_process');

// Test with the Berlin Vergabekooperation URL provided by the user
const berlinUrl = 'https://vergabekooperation.berlin/NetServer/TenderingProcedureDetails?function=_Details&TenderOID=54321-Tender-19851afca1f-517308fe22105a7c';

console.log('🧪 Testing Berlin Vergabekooperation handler...\n');
console.log(`📋 Berlin URL: ${berlinUrl}\n`);

// Run the scraper
const command = `npm start "${berlinUrl}"`;

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

