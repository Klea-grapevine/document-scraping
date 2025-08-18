import puppeteer from 'puppeteer';

export async function handleEvergabeOnline(page: any, url: string): Promise<Map<string, Buffer>> {
    const documents = new Map<string, Buffer>();
    
    try {
        console.log('Detected Evergabe Online - applying special handling...');
        
        // Enable cookies and set proper headers for Evergabe Online
        console.log('Setting up browser for Evergabe Online...');
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': 'https://www.evergabe-online.de/'
        });
        
        // First visit the main site to establish a proper session
        console.log('Establishing session with evergabe-online.de...');
        await page.goto('https://www.evergabe-online.de/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Now navigate to the actual documents page
        console.log(`Navigating to documents page: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Wait for page to stabilize and extract session ID
        let contentLoaded = false;
        let sessionId = '';
        
        // Add retry mechanism for page evaluation
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            try {
                const pageInfo = await page.evaluate(() => {
                    try {
                        const text = document.body.textContent || '';
                        const title = document.title || '';
                        
                        // Extract App-Session-Id if present
                        const sessionIdMatch = text.match(/App-Session-Id:\s*([a-f0-9-]+)/i);
                        const sessionId = sessionIdMatch ? sessionIdMatch[1] : '';
                        
                        // Check for cookie requirement page
                        if (text.includes('Cookies benötigt') || title.includes('Cookies benötigt')) {
                            return { type: 'cookie-required', text: 'Cookie page detected', sessionId };
                        }
                        
                        // Check for expected content
                        if (text.includes('Unterlagen zu dieser Ausschreibung') || 
                            text.includes('Als ZIP-Datei herunterladen') ||
                            text.includes('tenderdocuments') ||
                            text.includes('download')) {
                            return { type: 'content-loaded', text: 'Expected content found', sessionId };
                        }
                        
                        return { type: 'waiting', text: 'Still waiting for content', sessionId };
                    } catch (error) {
                        return { type: 'error', text: 'Evaluation error', sessionId: '' };
                    }
                });
                
                console.log(`Page check ${i + 1}/10: ${pageInfo.type} - ${pageInfo.text}`);
                
                if (pageInfo.sessionId) {
                    sessionId = pageInfo.sessionId;
                    console.log(`Found App-Session-Id: ${sessionId}`);
                }
                
                if (pageInfo.type === 'cookie-required') {
                    console.log('Cookie requirement page detected, will continue...');
                    break;
                }
                
                if (pageInfo.type === 'content-loaded') {
                    contentLoaded = true;
                    console.log(`Page content loaded after ${(i + 1) * 3} seconds`);
                    break;
                }
                
                if (pageInfo.type === 'error') {
                    console.log('Page evaluation error, retrying...');
                    continue;
                }
                
            } catch (error) {
                console.log(`Page evaluation failed on attempt ${i + 1}, retrying...`);
                continue;
            }
        }
        
        if (!contentLoaded) {
            console.log('Content check completed, proceeding with document extraction...');
        }
        
        // Note: Files will be captured via the browser's download directory monitoring in document-scraper.ts
        
        // Look for ZIP download button with improved error handling
        console.log('Looking for ZIP download button...');
        
        let zipButtonResult: { found: boolean; tagName?: string; text?: string; index?: number; onclick?: string; href?: string; id?: string; className?: string; error?: string } = { found: false };
        
        try {
            zipButtonResult = await page.evaluate(() => {
                try {
                    const elements = Array.from(document.querySelectorAll('*'));
                    
                    for (let i = 0; i < elements.length; i++) {
                        const el = elements[i];
                        const text = (el.textContent || '').toLowerCase().trim();
                        
                        if (text.includes('als zip-datei herunterladen') || 
                            text.includes('zip-datei herunterladen') ||
                            text.includes('zip herunterladen')) {
                            
                            // Check if it's clickable (button, a, input, or has onclick)
                            const tagName = el.tagName.toLowerCase();
                            const onclick = el.getAttribute('onclick');
                            const href = (el as HTMLAnchorElement).href;
                            
                            if (tagName === 'button' || tagName === 'a' || tagName === 'input' || onclick || href) {
                                return {
                                    found: true,
                                    index: i,
                                    text: text,
                                    tagName: tagName,
                                    onclick: onclick,
                                    href: href,
                                    id: el.id,
                                    className: el.className
                                };
                            }
                        }
                    }
                    
                    return { found: false };
                } catch (error) {
                    return { found: false, error: String(error) };
                }
            });
        } catch (error) {
            console.log('Error finding ZIP button:', error);
        }
        
        if (zipButtonResult.found && zipButtonResult.tagName && zipButtonResult.index !== undefined) {
            console.log(`Found ZIP download element: ${zipButtonResult.tagName} with text "${zipButtonResult.text}"`);
            
            try {
                // Click the element and wait for downloads
                await page.evaluate((index: number) => {
                    const elements = Array.from(document.querySelectorAll('*'));
                    const el = elements[index] as HTMLElement;
                    if (el) {
                        console.log('Clicking download element...');
                        el.click();
                    }
                }, zipButtonResult.index);
                
                console.log('ZIP download element clicked, waiting for download...');
                
                // Wait for the download to initiate (the actual file will be captured by the download directory)
                console.log('Waiting for download to initiate...');
                await new Promise(resolve => setTimeout(resolve, 8000));
                
                // Note: The actual downloaded files will be captured by the document-scraper's download directory monitoring
                
            } catch (error) {
                console.log('Error clicking ZIP download button:', error);
            }
        } else {
            console.log('No ZIP download button found, looking for individual download links...');
        }
        
        // If no ZIP documents were found, look for individual document download buttons
        if (documents.size === 0) {
            console.log('Looking for individual document download buttons...');
            
            try {
                // Look for download buttons and links in the document sections
                const downloadButtons = await page.evaluate(() => {
                    try {
                        const results: Array<{text: string, index: number, href?: string}> = [];
                        const allElements = Array.from(document.querySelectorAll('*'));
                        
                        for (let i = 0; i < allElements.length; i++) {
                            const el = allElements[i];
                            const text = (el.textContent || '').toLowerCase().trim();
                            const href = (el as HTMLAnchorElement).href;
                            const tagName = el.tagName.toLowerCase();
                            
                            // Look for download links or buttons
                            if ((text === 'download' || text === 'herunterladen' || text.includes('herunterladen')) && 
                                (tagName === 'a' || tagName === 'button' || tagName === 'input')) {
                                results.push({
                                    text: text,
                                    index: i,
                                    href: href
                                });
                            } else if (href && (href.includes('.pdf') || href.includes('.docx') || href.includes('.doc') || href.includes('.zip'))) {
                                results.push({
                                    text: `Direct link: ${text || 'Download'}`,
                                    index: i,
                                    href: href
                                });
                            }
                        }
                        
                        return results;
                    } catch (error) {
                        return [];
                    }
                });
                
                console.log(`Found ${downloadButtons.length} individual download buttons/links`);
                
                // Click each download button
                for (const btn of downloadButtons) {
                    try {
                        console.log(`Clicking: ${btn.text}`);
                        
                        await page.evaluate((buttonIndex: number) => {
                            try {
                                const elements = Array.from(document.querySelectorAll('*'));
                                const el = elements[buttonIndex] as HTMLElement;
                                if (el) {
                                    el.click();
                                }
                            } catch (error) {
                                // Ignore click errors
                            }
                        }, btn.index);
                        
                        // Wait for download to process
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        
                    } catch (error) {
                        console.log(`Failed to download ${btn.text}:`, error);
                    }
                }
                
                // Wait for individual downloads to complete
                await new Promise(resolve => setTimeout(resolve, 5000));
                
            } catch (error) {
                console.log('Error finding individual download buttons:', error);
            }
        }
        
        console.log(`Evergabe Online processing completed. Found ${documents.size} documents.`);
        
    } catch (error) {
        console.log('Special Evergabe Online handling failed:', error);
    }
    
    return documents;
}
