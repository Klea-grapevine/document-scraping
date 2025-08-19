const { summarizeText } = require('./dist/utils/ai-summarizer');

// Test the enhanced AI summarizer with detailed content
async function testEnhancedSummarizer() {
    console.log('🧪 Testing Enhanced AI Summarizer\n');
    
    // Sample content with detailed award criteria (similar to what you want to extract)
    const sampleContent = `
    VERGABEUNTERLAGEN
    
    ZUSCHLAGSKRITERIEN
    
    Qualität (max. 100 Punkte, Gewichtung 60%)
    
    Qualität (60%)
    Leistungskonzepte (max. 70 Punkte)
    Rekrutierungskampagne für Schüler (max. 40 Punkte)
    Fragestellungen (Bilderpool, Karriereportal, LinkedIn) (max. 15 Punkte)
    Initiale Aufgaben und Onboarding (max. 15 Punkte)
    Vorstellung und Verhandlung (max. 30 Punkte)
    
    Preis (40%)
    Basis- und Regelleistungen (max. 25 Punkte = 25%)
    Festpreis-Leistungen (max. 60 Punkte = 60%)
    Strategie, Kreation, Kampagne (12 Punkte)
    Bewegtbild, Shooting und Bilderpool (12 Punkte)
    Karriereseite, Landingpage/Microsite (6 Punkte)
    Themen- und Contentplanung (3 Punkte)
    Podcast (3 Punkte)
    Online Marketing-Maßnahmen (9 Punkte)
    Offline-Maßnahmen (9 Punkte) Anzeigen
    Online und Offline (6 Punkte)
    Gewichteter Tagessatz (max. 15 Punkte = 15%)
    
    EIGNUNGSKRITERIEN
    
    Mindestanforderungen:
    - Nachweis der fachlichen Eignung
    - Mindestens 3 Jahre Erfahrung in der Branche
    - Jahresumsatz mindestens 500.000 EUR
    - Haftpflichtversicherung mindestens 1 Mio. EUR
    
    EINZUREICHENDE UNTERLAGEN
    
    - Vollständiger Angebotstext
    - Preisblatt mit detaillierter Aufschlüsselung
    - Referenzliste (mindestens 3 Projekte)
    - Qualitätsnachweise und Zertifikate
    - Finanznachweis der letzten 3 Jahre
    
    ABGABEFRIST
    
    Angebote sind bis zum 15.09.2025, 12:00 Uhr einzureichen.
    
    BUDGET
    
    Das verfügbare Budget beträgt maximal 150.000 EUR (netto).
    
    VERTRAGSLAUFZEIT
    
    Der Vertrag beginnt am 01.10.2025 und läuft bis zum 31.12.2026.
    `;
    
    console.log('📋 Testing with sample content that includes detailed award criteria...');
    console.log('🎯 Expected: Detailed extraction of point values, weightings, and specific criteria\n');
    
    try {
        const summary = await summarizeText(sampleContent);
        console.log('\n' + '='.repeat(80));
        console.log('📋 ENHANCED AI SUMMARY RESULT');
        console.log('='.repeat(80));
        console.log(summary);
        console.log('='.repeat(80));
        console.log('\n✅ Enhanced summarizer test completed!');
    } catch (error) {
        console.error('\n❌ Test failed:', error);
    }
}

testEnhancedSummarizer();
