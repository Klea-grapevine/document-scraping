import puppeteer from 'puppeteer';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export async function handleVergabekooperationBerlin(page: any, url: string): Promise<Map<string, Buffer>> {
    const documents = new Map<string, Buffer>();

    try {
        console.log('Detected Vergabekooperation Berlin - applying special handling...');

        // Wait for the page to load completely
        console.log('Waiting for page to fully load...');
        await page.waitForSelector('body', { timeout: 15000 });

        // Wait for content to appear
        let contentLoaded = false;
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasExpectedContent = await page.evaluate(() => {
                const text = document.body.textContent || '';
                return text.includes('Teilnahmewettbewerbsunterlagen') ||
                       text.includes('Download') ||
                       text.includes('Version') ||
                       text.includes('Nachrichten') ||
                       text.includes('Ausschreibung');
            });

            if (hasExpectedContent) {
                contentLoaded = true;
                console.log(`Page content loaded after ${(i + 1) * 2} seconds`);
                break;
            }
            console.log(`Waiting for content... attempt ${i + 1}/10`);
        }

        if (!contentLoaded) {
            console.log('Content did not load within expected time, proceeding anyway...');
        }

                // Set up download capture for ZIP files specifically
        let zipDownloadCompleted = false;
        
        // Enable downloads with more specific configuration
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: './downloads'
        });

        // Set up download event handlers BEFORE any page interaction
        console.log('Setting up download event handlers...');
        
        // Method 1: Browser context download events (most reliable)
        const context = page.browser().defaultBrowserContext();
        context.on('targetcreated', async (target: any) => {
            if (target.type() === 'page') {
                const newPage = await target.page();
                if (newPage) {
                    newPage.on('download', async (download: any) => {
                        console.log(`Context download event: ${download.url()} -> ${download.suggestedFilename()}`);
                        try {
                            const buffer = await download.buffer();
                            if (buffer.length > 0 && !zipDownloadCompleted) {
                                documents.set(download.suggestedFilename() || 'documents.zip', buffer);
                                zipDownloadCompleted = true;
                                console.log(`Successfully captured context download: ${download.suggestedFilename()} (${buffer.length} bytes)`);
                            }
                        } catch (error) {
                            console.log(`Error processing context download:`, error);
                        }
                    });
                }
            }
        });

        // Method 2: Page download events
        page.on('download', async (download: any) => {
            const fileName = download.suggestedFilename();
            const downloadUrl = download.url();
            
            console.log(`Page download event triggered: ${downloadUrl} -> ${fileName}`);
            
            try {
                const buffer = await download.buffer();
                if (buffer.length > 0 && !zipDownloadCompleted) {
                    documents.set(fileName || 'documents.zip', buffer);
                    zipDownloadCompleted = true;
                    console.log(`Successfully captured page download: ${fileName} (${buffer.length} bytes)`);
                }
            } catch (error) {
                console.log(`Error processing page download event ${fileName}:`, error);
            }
        });

        // Method 3: CDP download events (most low-level)
        client.on('Page.downloadWillBegin', (params: any) => {
            console.log('CDP downloadWillBegin:', params);
        });

        client.on('Page.downloadProgress', (params: any) => {
            console.log('CDP downloadProgress:', params);
            if (params.state === 'completed') {
                console.log(`CDP download completed: ${params.url}`);
            }
        });

        // Method 4: Response interception (backup) - with better error handling
        await page.setRequestInterception(true);
        page.on('request', (request: any) => {
            // Log all requests to see what's happening
            if (request.url().includes('.zip') || request.url().includes('download')) {
                console.log(`Download-related request: ${request.method()} ${request.url()}`);
            }
            request.continue();
        });

        page.on('response', async (response: any) => {
            const responseUrl = response.url();
            const headers = response.headers();
            const contentType = headers['content-type'] || '';
            const contentDisposition = headers['content-disposition'] || '';
            const contentLength = headers['content-length'] || '0';
            const status = response.status();
            const method = response.request().method();

            // Log ALL responses to see what's happening
            if (responseUrl.includes('TenderingProcedureDetails') || 
                contentDisposition.includes('attachment') ||
                contentType.includes('application/zip') ||
                contentType.includes('application/x-zip-compressed') ||
                contentType.includes('application/octet-stream') ||
                responseUrl.includes('.zip') ||
                responseUrl.includes('download')) {
                
                console.log(`Potential download response: ${method} ${responseUrl}`);
                console.log(`  Status: ${status}, Content-Type: ${contentType}`);
                console.log(`  Content-Disposition: ${contentDisposition}`);
                console.log(`  Content-Length: ${contentLength}`);
                console.log(`  All headers:`, headers);

                // Handle redirects
                if (status >= 300 && status < 400) {
                    const location = headers['location'];
                    console.log(`  Redirect to: ${location}`);
                    if (location) {
                        // Follow the redirect manually
                        try {
                            console.log(`  Following redirect to: ${location}`);
                            const redirectResponse = await page.goto(location, { waitUntil: 'networkidle0' });
                            if (redirectResponse) {
                                const redirectBuffer = await redirectResponse.buffer();
                                if (redirectBuffer.length > 0) {
                                    const fileName = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)?.[1]?.replace(/['"]/g, '') || 'documents.zip';
                                    documents.set(fileName, redirectBuffer);
                                    zipDownloadCompleted = true;
                                    console.log(`Successfully captured redirect download: ${fileName} (${redirectBuffer.length} bytes)`);
                                    return;
                                }
                            }
                        } catch (error) {
                            console.log(`  Error following redirect:`, error);
                        }
                    }
                    return;
                }

                // Skip preflight requests and error responses
                if (method === 'OPTIONS' || 
                    status === 204 || 
                    status === 304 || 
                    status < 200 || 
                    status >= 400) {
                    console.log(`  Skipping response (method: ${method}, status: ${status})`);
                    return;
                }
                
                // Don't try to read buffer for POST requests that initiate downloads
                // These typically return empty bodies and just trigger the download
                if (contentDisposition.includes('attachment') && (contentLength === '0' || method === 'POST')) {
                    console.log(`  Download initiation detected (${method} request with attachment header) - skipping buffer read`);
                    // Instead, we'll rely on file system monitoring below
                    return;
                }
                
                try {
                    const buffer = await response.buffer();
                    console.log(`  Buffer size: ${buffer.length} bytes`);
                    
                    // Extract filename from content-disposition or URL
                    let fileName = 'documents.zip';
                    if (contentDisposition) {
                        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                        if (match) {
                            fileName = match[1].replace(/['"]/g, '');
                        }
                    }

                    if (buffer.length > 0 && !zipDownloadCompleted) {
                        documents.set(fileName, buffer);
                        zipDownloadCompleted = true;
                        console.log(`Successfully captured via HTTP response: ${fileName} (${buffer.length} bytes)`);
                    }
                } catch (error) {
                    console.log(`Error processing HTTP download from response ${responseUrl}:`, error);
                    console.log(`  This is expected for download initiation responses - will monitor file system instead`);
                }
            }
        });

        // Method 5: File system monitoring for downloads
        const downloadsDir = path.resolve('./downloads');
        console.log(`Monitoring downloads directory: ${downloadsDir}`);
        
        // Ensure downloads directory exists
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }
        
        // Get initial file list
        const getDownloadFiles = () => {
            try {
                return fs.readdirSync(downloadsDir).filter(file => file.endsWith('.zip'));
            } catch (error) {
                return [];
            }
        };
        
        const initialFiles = getDownloadFiles();
        console.log(`Initial ZIP files in downloads: ${initialFiles.length > 0 ? initialFiles.join(', ') : 'none'}`);
        
        // Function to check for new downloads
        const checkForNewDownloads = async () => {
            const currentFiles = getDownloadFiles();
            const newFiles = currentFiles.filter(file => !initialFiles.includes(file));
            
            // If no new files found, but we haven't captured anything yet, check existing files that might be recent
            if (newFiles.length === 0 && !zipDownloadCompleted && currentFiles.length > 0) {
                console.log('No new files found, checking existing files for recent downloads...');
                for (const fileName of currentFiles) {
                    try {
                        const filePath = path.join(downloadsDir, fileName);
                        const stats = fs.statSync(filePath);
                        
                        // Check if file was modified in the last 5 minutes (indicating recent download)
                        const fileAge = Date.now() - stats.mtime.getTime();
                        if (fileAge < 5 * 60 * 1000) { // Less than 5 minutes old
                            console.log(`Found existing file ${fileName} that was modified recently (${Math.round(fileAge/1000)}s ago), using it...`);
                            
                            // Read the file and add to documents
                            const fileBuffer = fs.readFileSync(filePath);
                            if (fileBuffer.length > 0 && !zipDownloadCompleted) {
                                documents.set(fileName, fileBuffer);
                                zipDownloadCompleted = true;
                                console.log(`Successfully captured existing file: ${fileName} (${fileBuffer.length} bytes)`);
                                return; // Exit early since we found a file
                            }
                        }
                    } catch (error) {
                        console.log(`Error checking existing file ${fileName}:`, error);
                    }
                }
            }
            
            // Process new files
            for (const fileName of newFiles) {
                try {
                    const filePath = path.join(downloadsDir, fileName);
                    const stats = fs.statSync(filePath);
                    
                    // Check if file is very recent (to avoid partial downloads)
                    const fileAge = Date.now() - stats.mtime.getTime();
                    if (fileAge < 3000) { // Less than 3 seconds old, might still be downloading
                        console.log(`Found new file ${fileName} but it's very recent, waiting for completion...`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        continue;
                    }
                    
                    // Read the file and add to documents
                    const fileBuffer = fs.readFileSync(filePath);
                    if (fileBuffer.length > 0 && !zipDownloadCompleted) {
                        documents.set(fileName, fileBuffer);
                        zipDownloadCompleted = true;
                        console.log(`Successfully captured new file from downloads directory: ${fileName} (${fileBuffer.length} bytes)`);
                        
                        // Optionally, remove the file after capturing it
                        // fs.unlinkSync(filePath);
                        // console.log(`Cleaned up downloaded file: ${fileName}`);
                    }
                } catch (error) {
                    console.log(`Error reading downloaded file ${fileName}:`, error);
                }
            }
        };

        // Look for the download button in the Teilnahmewettbewerbsunterlagen table
        console.log('Looking for download button in Teilnahmewettbewerbsunterlagen table...');
        const downloadButton = await page.evaluate(() => {
            const tables = Array.from(document.querySelectorAll('table'));

            for (const table of tables) {
                const tableText = table.textContent || '';
                if (tableText.includes('Teilnahmewettbewerbsunterlagen') || tableText.includes('Version')) {
                    // Look for download button or icon in this table
                    const downloadElements = table.querySelectorAll('a, button, [onclick]');
                    for (let i = 0; i < downloadElements.length; i++) {
                        const el = downloadElements[i];
                        const text = (el.textContent || '').toLowerCase().trim();
                        const hasDownloadIcon = el.innerHTML.includes('download') ||
                                               el.innerHTML.includes('arrow') ||
                                               el.innerHTML.includes('↓') ||
                                               el.getAttribute('title')?.toLowerCase().includes('download');

                        if (text === 'download' || text === '' && hasDownloadIcon || el.getAttribute('onclick')) {
                            return { index: i, text: text || 'download icon', found: true, element: 'download' };
                        }
                    }
                }
            }
            return { found: false };
        });

        if (downloadButton.found) {
            console.log(`Found download button: "${downloadButton.text}", clicking to open popup...`);

            // Click the download button to open the popup
            await page.evaluate((buttonIndex: number) => {
                const tables = Array.from(document.querySelectorAll('table'));
                for (const table of tables) {
                    const tableText = table.textContent || '';
                    if (tableText.includes('Teilnahmewettbewerbsunterlagen') || tableText.includes('Version')) {
                        const downloadElements = table.querySelectorAll('a, button, [onclick]');
                        const el = downloadElements[buttonIndex] as HTMLElement;
                        if (el) {
                            el.click();
                            return true;
                        }
                    }
                }
                return false;
            }, downloadButton.index);

            console.log('Download button clicked, waiting for popup...');

            // Wait for popup to appear and look for the selection buttons
            let popupHandled = false;
            for (let attempt = 0; attempt < 10 && !popupHandled; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Debug: Let's see what's in the popup first
                if (attempt === 0) {
                    const popupInfo = await page.evaluate(() => {
                        // Look for modal or popup elements
                        const modals = Array.from(document.querySelectorAll('.modal, .popup, .dialog, [role="dialog"], .overlay'));
                        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
                        const allButtons = Array.from(document.querySelectorAll('button, a, input[type="button"], span, div'));
                        
                        // Get buttons specifically from the modal
                        const modal = modals.length > 0 ? modals[0] : null;
                        const modalButtons = modal ? Array.from(modal.querySelectorAll('button, a, input[type="button"], span, div, [onclick]')) : [];
                        
                        return {
                            modalCount: modals.length,
                            checkboxCount: checkboxes.length,
                            visibleText: document.body.textContent?.includes('Bestandteile der Teilnahmewettbewerbsunterlagen'),
                            hasCloseButton: allButtons.some(btn => (btn.textContent || '').includes('×')),
                            modalButtonTexts: modalButtons.map(btn => {
                                const text = (btn.textContent || '').trim();
                                const onclick = btn.getAttribute('onclick') || '';
                                const id = btn.getAttribute('id') || '';
                                const className = btn.getAttribute('class') || '';
                                return {
                                    text: text.length < 50 ? text : text.substring(0, 50) + '...',
                                    onclick: onclick.substring(0, 100),
                                    id: id,
                                    className: className,
                                    tagName: btn.tagName
                                };
                            }).slice(0, 25), // Include all buttons, not just ones with text
                            buttonTexts: allButtons.map(btn => (btn.textContent || '').trim()).filter(text => text.length > 0 && text.length < 50).slice(0, 20)
                        };
                    });
                                        console.log('Popup analysis:', popupInfo);
                    
                    // Also look for any buttons at the bottom of the modal
                    const modalFooterButtons = await page.evaluate(() => {
                        // Look for buttons that might be in the footer area or have specific classes
                        const footerButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], .btn, .button'));
                        return footerButtons.map(btn => {
                            const text = (btn.textContent || '').trim();
                            const onclick = btn.getAttribute('onclick') || '';
                            const id = btn.getAttribute('id') || '';
                            const className = btn.getAttribute('class') || '';
                            const value = btn.getAttribute('value') || '';
                            return {
                                text: text.length < 50 ? text : text.substring(0, 50) + '...',
                                onclick: onclick.substring(0, 100),
                                id: id,
                                className: className,
                                value: value,
                                tagName: btn.tagName
                            };
                        }).filter(info => info.text.length > 0 || info.onclick.length > 0 || info.value.length > 0);
                    });
                    console.log('Footer/button elements:', modalFooterButtons);
                }
                
                // First, try to select all checkboxes if they exist
                const checkboxesSelected = await page.evaluate(() => {
                    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
                    if (checkboxes.length > 0) {
                        console.log(`Found ${checkboxes.length} checkboxes, selecting all`);
                        checkboxes.forEach(checkbox => {
                            if (!checkbox.checked) {
                                checkbox.click();
                            }
                        });
                        return true;
                    }
                    return false;
                });

                if (checkboxesSelected) {
                    console.log('Selected all checkboxes in popup');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // After selecting checkboxes, look for "Alles auswählen" button that might appear
                    const selectAllAfterCheckboxes = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], .btn, .button, [onclick]'));
                        for (const btn of buttons) {
                            const text = (btn.textContent || '').toLowerCase().trim();
                            const value = (btn.getAttribute('value') || '').toLowerCase().trim();
                            const title = btn.getAttribute('title') || '';
                            const onclick = btn.getAttribute('onclick') || '';
                            
                            if (text === 'alles auswählen' || 
                                value === 'alles auswählen' ||
                                text.includes('alles auswählen') || 
                                text.includes('select all') || 
                                text.includes('alle auswählen') ||
                                title.toLowerCase().includes('alles auswählen') ||
                                onclick.includes('selectAll') ||
                                onclick.includes('SelectAll')) {
                                (btn as HTMLElement).click();
                                return { found: true, text: text || value || title || 'onclick action' };
                            }
                        }
                        return { found: false };
                    });
                    
                    if (selectAllAfterCheckboxes.found) {
                        console.log(`Found and clicked "Alles auswählen" button: "${selectAllAfterCheckboxes.text}"`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                // Now look for download button - be very specific for this popup
                const downloadSelectionFound = await page.evaluate(() => {
                    // Look specifically for buttons with "Auswahl herunterladen" text
                    const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], .btn, .button, [onclick]'));
                    
                    // First priority: exact text matches for download buttons
                    for (const btn of allButtons) {
                        const text = (btn.textContent || '').toLowerCase().trim();
                        const value = (btn.getAttribute('value') || '').toLowerCase().trim();
                        const title = btn.getAttribute('title') || '';
                        
                        if (text === 'auswahl herunterladen' || 
                            value === 'auswahl herunterladen' ||
                            text === 'download selection' ||
                            value === 'download selection') {
                            (btn as HTMLElement).click();
                            return { found: true, text: text || value || 'exact match', location: 'exact' };
                        }
                    }
                    
                    // Second priority: partial matches for download-related buttons
                    for (const btn of allButtons) {
                        const text = (btn.textContent || '').toLowerCase().trim();
                        const value = (btn.getAttribute('value') || '').toLowerCase().trim();
                        const onclick = btn.getAttribute('onclick') || '';
                        const id = btn.getAttribute('id') || '';
                        
                        if (text.length > 100) continue; // Skip very long text
                        
                        if (text.includes('herunterladen') ||
                            value.includes('herunterladen') ||
                            text.includes('download') ||
                            value.includes('download') ||
                            onclick.includes('download') ||
                            onclick.includes('zip') ||
                            id.toLowerCase().includes('download')) {
                            (btn as HTMLElement).click();
                            return { found: true, text: text || value || id || 'partial match', location: 'partial' };
                        }
                    }
                    
                    // Third priority: submit buttons that might trigger download
                    for (const btn of allButtons) {
                        const type = btn.getAttribute('type') || '';
                        const onclick = btn.getAttribute('onclick') || '';
                        const text = (btn.textContent || '').toLowerCase().trim();
                        
                        if (type === 'submit' || 
                            onclick.includes('submit') ||
                            onclick.includes('window.open') ||
                            onclick.includes('location.href')) {
                            (btn as HTMLElement).click();
                            return { found: true, text: text || type || 'submit action', location: 'submit' };
                        }
                    }
                    
                    return { found: false };
                });

                if (downloadSelectionFound.found) {
                    console.log(`Found and clicked download button: "${downloadSelectionFound.text}" (${downloadSelectionFound.location})`);
                    popupHandled = true;
                    
                                            // Wait for the ZIP download to complete
                        console.log('Waiting for ZIP download to complete...');
                        
                        // Multi-method approach to capture downloads
                        let downloadStarted = false;
                        const downloadPromise = new Promise<void>((resolve) => {
                            const timeoutId = setTimeout(async () => {
                                console.log('Download timeout - no download event detected, checking file system...');
                                await checkForNewDownloads();
                                resolve();
                            }, 15000); // Increased to 15 seconds to account for 10+ second download times
                            
                            const downloadListener = () => {
                                downloadStarted = true;
                                clearTimeout(timeoutId);
                                // Give some extra time for download to complete
                                setTimeout(resolve, 3000);
                            };
                            
                            if (!zipDownloadCompleted) {
                                page.once('download', downloadListener);
                            } else {
                                clearTimeout(timeoutId);
                                resolve();
                            }
                        });
                        
                        await downloadPromise;
                        
                        // Additional file system check even if download event was triggered
                        if (!zipDownloadCompleted) {
                            console.log('Checking file system for downloaded files...');
                            await checkForNewDownloads();
                            
                            // Give file system a bit more time if we still haven't found anything
                            if (!zipDownloadCompleted) {
                                console.log('Waiting additional time for potential file system download...');
                                await new Promise(resolve => setTimeout(resolve, 10000)); // Increased to 10 seconds
                                await checkForNewDownloads();
                            }
                        }
                        
                        if (!zipDownloadCompleted && !downloadStarted) {
                            console.log('No download detected via events or file system. This might be because:');
                            console.log('- The site requires user authentication');
                            console.log('- Downloads are blocked by CORS or other security measures');
                            console.log('- The download uses a different mechanism not captured');
                            console.log('- The ZIP file is being saved to a different location');
                        } else if (zipDownloadCompleted) {
                            console.log('Download completed successfully');
                        }
                } else {
                    console.log(`Attempt ${attempt + 1}: Download button not found`);
                    
                    // If we're past attempt 3 and still can't find buttons, try alternative approach
                    if (attempt >= 3) {
                        console.log('Trying alternative approach: look for any clickable element that might trigger download');
                        const alternativeDownloadTriggered = await page.evaluate(() => {
                            // Look for elements that might trigger a download
                            const elements = Array.from(document.querySelectorAll('*[onclick], a[href*="download"], button, input[type="submit"]'));
                            for (const el of elements) {
                                const onclick = el.getAttribute('onclick') || '';
                                const href = el.getAttribute('href') || '';
                                const text = (el.textContent || '').toLowerCase();
                                
                                if (onclick.includes('zip') || 
                                    onclick.includes('download') || 
                                    href.includes('download') ||
                                    text.includes('download') ||
                                    onclick.includes('export')) {
                                    (el as HTMLElement).click();
                                    return true;
                                }
                            }
                            return false;
                        });
                        
                        if (alternativeDownloadTriggered) {
                            console.log('Alternative download approach triggered');
                            popupHandled = true;
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    }
                }
            }

            if (!popupHandled) {
                console.log('Could not handle popup within expected time - trying alternative approaches...');
                
                // Alternative approach: look for any clickable element that might trigger download
                const alternativeDownload = await page.evaluate(() => {
                    // Look for any element that might trigger a download
                    const clickables = Array.from(document.querySelectorAll('*[onclick], a[href], button, input[type="button"]'));
                    for (const el of clickables) {
                        const text = (el.textContent || '').toLowerCase();
                        const onclick = el.getAttribute('onclick') || '';
                        const href = el.getAttribute('href') || '';
                        
                        if (text.includes('herunterladen') || 
                            text.includes('download') || 
                            onclick.includes('download') ||
                            href.includes('download')) {
                            (el as HTMLElement).click();
                            return true;
                        }
                    }
                    return false;
                });

                if (alternativeDownload) {
                    console.log('Triggered alternative download approach');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

        } else {
            console.log('Download button not found in table, trying to find download links directly...');
            
            // Alternative approach: look for direct download links
            const directDownloadFound = await page.evaluate(() => {
                const allLinks = Array.from(document.querySelectorAll('a[href], button, [onclick]'));
                for (const link of allLinks) {
                    const href = link.getAttribute('href') || '';
                    const onclick = link.getAttribute('onclick') || '';
                    const text = (link.textContent || '').toLowerCase();
                    
                    if (href.includes('download') || 
                        onclick.includes('download') || 
                        text.includes('download') ||
                        text.includes('herunterladen')) {
                        (link as HTMLElement).click();
                        return true;
                    }
                }
                return false;
            });
            
            if (directDownloadFound) {
                console.log('Found and clicked direct download link');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Final wait to ensure any downloads are completed
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Final check for any files that might have been downloaded
        if (documents.size === 0) {
            console.log('Performing final check for downloaded files...');
            await checkForNewDownloads();
        }

        if (documents.size === 0) {
            console.log('No documents were captured. This could be due to:');
            console.log('- The download requires authentication or login');
            console.log('- The popup interaction failed');
            console.log('- The download method is not captured by our listeners');
            console.log('- The page structure has changed');
            console.log('- The ZIP file was saved to a different location than ./downloads');
            
            // List all files in downloads directory for debugging
            try {
                const allFiles = fs.readdirSync(downloadsDir);
                console.log(`Files currently in downloads directory: ${allFiles.length > 0 ? allFiles.join(', ') : 'none'}`);
            } catch (error) {
                console.log('Could not read downloads directory:', error);
            }
        } else {
            console.log(`Successfully captured ${documents.size} document(s) from Vergabekooperation Berlin`);
        }

    } catch (error) {
        console.log('Special Vergabekooperation Berlin handling failed:', error);
    }

    return documents;
}
