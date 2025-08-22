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
        
        // Set up response interception to capture file downloads BEFORE any clicks
        const captured: Array<{ fileName: string; buffer: Buffer }> = [];
        const contentTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument',
            'application/zip',
            'application/octet-stream',
            'binary/octet-stream'
        ];
        
        const guessName = (respUrl: string, headers: Record<string, string>): string => {
            const cd = headers['content-disposition'] || headers['Content-Disposition'];
            if (cd) {
                const m = /filename\*?=([^;]+)/i.exec(cd);
                if (m) return decodeURIComponent(m[1].replace(/UTF-8''/i, '').replace(/"/g, '').trim());
            }
            const urlObj = new URL(respUrl);
            const pathName = urlObj.pathname.split('/').filter(Boolean).pop() || 'download';
            return pathName;
        };
        
        // Set up response interception immediately
        page.on('response', async (resp: any) => {
            try {
                const headers = resp.headers() as Record<string, string>;
                const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
                const urlStr = resp.url();
                const contentLength = headers['content-length'] || headers['Content-Length'];
                
                // More comprehensive content type checking
                const isDocumentResponse = contentTypes.some(t => ct.includes(t)) || 
                                         /\.(pdf|docx?|zip|xlsx?|txt)(?:[?#].*)?$/i.test(urlStr) ||
                                         (ct.includes('application/') && contentLength && parseInt(contentLength) > 1000);
                
                if (isDocumentResponse) {
                    console.log(`Potential document response detected: ${urlStr}`);
                    console.log(`Content-Type: ${ct}, Content-Length: ${contentLength}`);
                    
                    const buffer = await resp.buffer();
                    if (buffer.length > 1000) { // Only capture files larger than 1KB
                        const name = guessName(urlStr, headers);
                        captured.push({ fileName: name, buffer });
                        console.log(`✅ Captured file via response: ${name} (${buffer.length} bytes)`);
                    }
                }
            } catch (error) {
                console.log('Error capturing response:', error);
            }
        });
        
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
                console.log('Attempting to click ZIP download element...');
                
                // Try multiple click methods
                const clickSuccess = await page.evaluate((index: number) => {
                    try {
                        const elements = Array.from(document.querySelectorAll('*'));
                        const el = elements[index] as HTMLElement;
                        if (el) {
                            console.log('Clicking download element...');
                            
                            // Try different click methods
                            if (el.tagName.toLowerCase() === 'a') {
                                // For links, try to follow the href
                                const href = (el as HTMLAnchorElement).href;
                                if (href) {
                                    console.log('Following link:', href);
                                    window.location.href = href;
                                    return true;
                                }
                            }
                            
                            // Try regular click
                            el.click();
                            return true;
                        }
                        return false;
                    } catch (error) {
                        console.error('Click error:', error);
                        return false;
                    }
                }, zipButtonResult.index);
                
                if (clickSuccess) {
                    console.log('ZIP download element clicked successfully, waiting for download...');
                } else {
                    console.log('Failed to click ZIP download element');
                }
                
                // Wait for the download to be captured by response interception
                await new Promise(resolve => setTimeout(resolve, 10000)); // Increased wait time
                
            } catch (error) {
                console.log('Error clicking ZIP download button:', error);
            }
        } else {
            console.log('No ZIP download button found, looking for individual download links...');
        }
        
        // If we found a ZIP button but no download was captured, try to extract the direct URL
        if (zipButtonResult.found && zipButtonResult.href && captured.length === 0) {
            console.log('ZIP button found but no download captured, trying direct URL...');
            try {
                const directUrl = zipButtonResult.href;
                console.log(`Attempting direct download from: ${directUrl}`);
                
                // Import the fetchFileBufferViaPage function
                const { fetchFileBufferViaPage } = await import('./general');
                
                const fetched = await fetchFileBufferViaPage(page, directUrl);
                if (fetched) {
                    documents.set(fetched.fileName, fetched.buffer);
                    console.log(`✅ Direct download successful: ${fetched.fileName}`);
                }
            } catch (error) {
                console.log('Direct download failed:', error);
            }
        }
        
        // If no ZIP documents were found, look for individual document download buttons
        if (captured.length === 0) {
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
        
        // Also try to find direct document links and fetch them via the page context
        console.log('Looking for direct document links...');
        try {
            const directLinks = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
                const candidates: string[] = [];
                for (const a of anchors) {
                    const href = a.getAttribute('href') || '';
                    const abs = new URL(href, location.href).href;
                    if (/\.(pdf|docx?|zip)(?:[?#].*)?$/i.test(abs)) {
                        candidates.push(abs);
                    }
                }
                return Array.from(new Set(candidates));
            });
            
            console.log(`Found ${directLinks.length} direct document links`);
            
            // Import the fetchFileBufferViaPage function
            const { fetchFileBufferViaPage } = await import('./general');
            
            // Fetch each direct link via the page context
            for (const link of directLinks) {
                try {
                    const fetched = await fetchFileBufferViaPage(page, link);
                    if (fetched) {
                        documents.set(fetched.fileName, fetched.buffer);
                        console.log(`Fetched direct link: ${fetched.fileName}`);
                    }
                } catch (error) {
                    console.log(`Failed to fetch direct link ${link}:`, error);
                }
            }
        } catch (error) {
            console.log('Error processing direct links:', error);
        }
        
        // Consolidate captured responses into documents map
        for (const c of captured) {
            if (!documents.has(c.fileName)) {
                documents.set(c.fileName, c.buffer);
                console.log(`Added captured file: ${c.fileName}`);
            }
        }
        
        console.log(`Evergabe Online processing completed. Found ${documents.size} documents.`);
        
    } catch (error) {
        console.log('Special Evergabe Online handling failed:', error);
    }
    
    return documents;
}
