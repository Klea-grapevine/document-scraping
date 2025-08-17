# Document Scraper & Summarizer

A powerful tool to automatically scrape tender documents from TED.eu notices and various German procurement platforms, then generate AI-powered summaries.

## 🚀 Features

- **TED.eu Integration**: Automatically extracts document URLs from TED notices
- **Multi-Platform Support**: Handles various German procurement platforms:
  - DTVP (Deutsches Vergabeportal)
  - Vergabe Niedersachsen
  - Subreport Elvis
  - Evergabe
  - Cosinex
  - And many more...
- **Document Processing**: Supports PDF, DOCX, and ZIP files
- **AI Summarization**: Generates structured summaries with key information
- **Host-Specific Handling**: Custom logic for each platform's unique structure

## 📋 Supported Document Types

- **PDF Documents**: Full text extraction and processing
- **DOCX/DOC Files**: Microsoft Word document processing
- **ZIP Archives**: Automatic extraction and processing of nested documents

## 🎯 Summary Format

The AI generates summaries in the following structured format:

### 1. Übersicht (Overview)
- Abgabefrist (Submission deadline)
- Budget/Finanzvolumen (Budget/Financial volume)
- Vertragslaufzeit (Contract duration)
- Vergabeart (Procurement type)
- Status

### 2. Zusammenfassung (Summary)
- Geforderte Leistungen (Required services)
- Eignungskriterien (Eligibility criteria)
- Zuschlagskriterien (Award criteria)
- Einzureichende Unterlagen (Required documents)
- Formalitäten und Besonderheiten (Formalities and special requirements)

## 🛠️ Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd document-scraping
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env and add your OpenAI API key
```

## 🚀 Usage

### Basic Usage

```bash
# Process a TED.eu notice
npm start "https://ted.europa.eu/de/notice/-/detail/488905-2025"

# Process a direct document URL
npm start "https://www.dtvp.de/Satellite/notice/CXP4YDK5GK4/documents"
```

### Test Scripts

```bash
# Test with TED notice
npm run test:ted

# Test with DTVP documents
npm run test:dtvp

# Test with Vergabe Niedersachsen
npm run test:vergabe
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

### Supported Hosts

The system automatically detects and handles these platforms:

| Platform | URL Pattern | Handler |
|----------|-------------|---------|
| DTVP | `dtvp.de` | `handleDtvp` |
| Vergabe Niedersachsen | `vergabe.niedersachsen.de` | `handleVergabeNiedersachsen` |
| Subreport Elvis | `subreport-elvis.de` | `handleSubreportElvis` |
| Evergabe | `evergabe` | `handleEvergabe` |
| Cosinex | `cosinex` | `handleCosinex` |
| General | Other URLs | `general` |

## 📁 Project Structure

```
src/
├── hosts/                 # Platform-specific handlers
│   ├── ted.ts            # TED.eu URL extraction
│   ├── dtvp.ts           # DTVP platform handler
│   ├── vergabe-niedersachsen.ts
│   ├── subreport-elvis.ts
│   └── general.ts        # General document handling
├── utils/
│   ├── document-parsers.ts  # PDF/DOCX parsing
│   ├── ai-summarizer.ts     # OpenAI integration
│   └── host-detector.ts     # Host detection logic
├── document-scraper.ts   # Main scraping logic
└── index.ts             # Entry point
```

## 🔍 How It Works

1. **URL Detection**: Determines if the input is a TED notice or direct document URL
2. **Document URL Extraction**: For TED notices, extracts the document URL from the "Internetadresse der Auftragsunterlagen" section
3. **Host Detection**: Identifies the platform type and routes to appropriate handler
4. **Document Download**: Downloads all available documents using platform-specific logic
5. **Content Extraction**: Parses PDF, DOCX, and ZIP files to extract text content
6. **AI Summarization**: Generates structured summary using OpenAI API

## 🎯 Example Workflow

```bash
# Input: TED notice URL
https://ted.europa.eu/de/notice/-/detail/488905-2025

# System extracts document URL:
https://www.dtvp.de/Satellite/notice/CXP4YDK5GK4/documents

# Downloads documents:
- A0_Teilnahmebedingungen.pdf
- B2_Leistungsbeschreibung.pdf
- A1_Formblaetter TNA.docx
- B1_Vertrag.pdf
- etc.

# Generates summary:
1. Übersicht:
   • Abgabefrist: 15.09.2025
   • Budget: 150.000 EUR
   • Vertragslaufzeit: 24 Monate
   ...

2. Zusammenfassung:
   • Geforderte Leistungen: Employer Branding...
   • Eignungskriterien: ...
   ...
```

## 🐛 Troubleshooting

### Common Issues

1. **"Could not extract documents URL from TED"**
   - The notice might not have document links yet
   - Check if the TED page structure has changed
   - Try accessing the TED notice manually first

2. **"No documents downloaded"**
   - Documents might require authentication
   - Platform structure might have changed
   - Check if the document URL is still valid

3. **"Failed to process PDF"**
   - PDF might be password protected
   - PDF might be corrupted
   - Try downloading manually to verify

### Debug Mode

For detailed logging, you can modify the code to run in debug mode or check the console output for specific error messages.

## 🤝 Contributing

To add support for new platforms:

1. Create a new handler in `src/hosts/`
2. Add host detection logic in `src/utils/host-detector.ts`
3. Update the main scraper to use your handler
4. Test with sample URLs

## 📄 License

This project is licensed under the ISC License.

## 🔗 Links

- [TED.eu](https://ted.europa.eu/) - European procurement notices
- [DTVP](https://www.dtvp.de/) - Deutsches Vergabeportal
- [OpenAI API](https://openai.com/api/) - AI summarization
