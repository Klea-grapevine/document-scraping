import puppeteer from 'puppeteer';

export async function handleVergabeNiedersachsen(page: any, url: string): Promise<Map<string, Buffer>> {
    const documents = new Map<string, Buffer>();
    
    try {
        console.log('Detected vergabe.niedersachsen.de - applying special handling...');
        
        // Wait for the page to load completely
        console.log('Waiting for page to fully load...');
        await page.waitForSelector('table, a[href]', { timeout: 15000 });
        
        // Look for the "Alle Dokumente als ZIP-Datei herunterladen" link first
        const zipDownloadLink = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            for (const link of links) {
                const text = (link.textContent || '').trim();
                if (text.includes('Alle Dokumente als ZIP-Datei herunterladen')) {
                    return link.getAttribute('href');
                }
            }
            return null;
        });
        
        if (zipDownloadLink) {
            console.log('Found ZIP download link, downloading all documents as ZIP...');
            const zipUrl = new URL(zipDownloadLink, url).href;
            const zipFile = await fetchFileBufferViaPage(page, zipUrl);
            if (zipFile) {
                documents.set(zipFile.fileName, zipFile.buffer);
                console.log(`Successfully downloaded ZIP file: ${zipFile.fileName}`);
            }
        } else {
            console.log('No ZIP download found, looking for individual document links...');
            
            // Look for individual document download links in tables
            const documentLinks = await page.evaluate(() => {
                const links: string[] = [];
                const tables = Array.from(document.querySelectorAll('table'));
                
                for (const table of tables) {
                    const rows = Array.from(table.querySelectorAll('tr'));
                    for (const row of rows) {
                        const cells = Array.from(row.querySelectorAll('td'));
                        for (const cell of cells) {
                            const fileLinks = Array.from(cell.querySelectorAll('a[href]'));
                            for (const link of fileLinks) {
                                const href = link.getAttribute('href');
                                if (href && (href.includes('.pdf') || href.includes('.docx') || href.includes('.xlsx') || href.includes('.doc'))) {
                                    links.push(href);
                                }
                            }
                        }
                    }
                }
                
                // Also look for any direct document links outside tables
                const allLinks = Array.from(document.querySelectorAll('a[href]'));
                for (const link of allLinks) {
                    const href = link.getAttribute('href');
                    if (href && (href.includes('.pdf') || href.includes('.docx') || href.includes('.xlsx') || href.includes('.doc'))) {
                        const text = (link.textContent || '').trim();
                        // Skip navigation links, only include actual document links
                        if (!text.includes('Zurück') && !text.includes('Schließen') && text.length > 0) {
                            links.push(href);
                        }
                    }
                }
                
                return Array.from(new Set(links)); // Remove duplicates
            });
            
            console.log(`Found ${documentLinks.length} document links to download`);
            
            // Download each document
            for (const link of documentLinks) {
                try {
                    const absoluteUrl = new URL(link, url).href;
                    console.log(`Downloading document from: ${absoluteUrl}`);
                    const docFile = await fetchFileBufferViaPage(page, absoluteUrl);
                    if (docFile) {
                        documents.set(docFile.fileName, docFile.buffer);
                        console.log(`Successfully downloaded: ${docFile.fileName}`);
                    }
                } catch (error) {
                    console.log(`Failed to download document from ${link}:`, error);
                }
            }
        }
        
    } catch (error) {
        console.log('Special vergabe.niedersachsen.de handling failed, continuing with general approach:', error);
    }
    
    return documents;
}

async function fetchFileBufferViaPage(page: any, fileUrl: string): Promise<{ fileName: string; buffer: Buffer } | null> {
    try {
        const result = await page.evaluate(async (u: string) => {
            function arrayBufferToBase64(buf: ArrayBuffer): string {
                let binary = '';
                const bytes = new Uint8Array(buf);
                const chunkSize = 0x8000;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    const sub = bytes.subarray(i, i + chunkSize);
                    binary += String.fromCharCode.apply(null, Array.from(sub) as unknown as number[]);
                }
                return btoa(binary);
            }
            const res = await fetch(u, { credentials: 'include' });
            const ab = await res.arrayBuffer();
            const base64 = arrayBufferToBase64(ab);
            const urlObj = new URL(u, location.href);
            const nameGuess = urlObj.pathname.split('/').filter(Boolean).pop() || 'download';
            return { base64, nameGuess };
        }, fileUrl);
        return { fileName: result.nameGuess, buffer: Buffer.from(result.base64, 'base64') };
    } catch (error) {
        console.error(`Error fetching file via page from ${fileUrl}:`, error);
        return null;
    }
}
