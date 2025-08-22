import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import { handleDtvp } from './dtvp';

export function isServiceBundUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return /(^|\.)service\.bund\.de$/i.test(u.hostname);
    } catch {
        return false;
    }
}

export async function extractDocumentsPageFromServiceBund(serviceBundUrl: string): Promise<string | null> {
    try {
        console.log(`Extracting documents page from service.bund.de: ${serviceBundUrl}`);
        
        // First try with axios for static content
        try {
            const response = await axios.get(serviceBundUrl);
            const $ = cheerio.load(response.data);

            // Look for the "Bekanntmachung (HTML-Seite)" link
            let bekanntmachungUrl: string | null = null;
            
            $('a').each((_, el) => {
                const linkText = $(el).text().trim();
                const href = $(el).attr('href');
                
                if (linkText.includes('Bekanntmachung') && 
                    linkText.includes('HTML-Seite') && 
                    href) {
                    bekanntmachungUrl = new URL(href, serviceBundUrl).href;
                    console.log(`Found Bekanntmachung link: ${bekanntmachungUrl}`);
                    return false; // Break the loop
                }
            });

            if (bekanntmachungUrl) {
                // Check if this leads to a DTVP page and convert to documents URL
                return await extractDtvpDocumentsUrl(bekanntmachungUrl);
            }
        } catch (error) {
            console.log('Axios approach failed, trying with Puppeteer:', error);
        }

        // Fallback to Puppeteer for dynamic content
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
            
            await page.goto(serviceBundUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Wait for page to load and look for the Bekanntmachung link
            const bekanntmachungUrl = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                for (const link of links) {
                    const text = link.textContent || '';
                    const href = link.getAttribute('href');
                    
                    if (text.includes('Bekanntmachung') && 
                        text.includes('HTML-Seite') && 
                        href) {
                        return new URL(href, window.location.href).href;
                    }
                }
                return null;
            });

            await browser.close();

            if (bekanntmachungUrl) {
                console.log(`Found Bekanntmachung link via Puppeteer: ${bekanntmachungUrl}`);
                return await extractDtvpDocumentsUrl(bekanntmachungUrl);
            }

        } catch (error) {
            await browser.close();
            console.log('Puppeteer approach failed:', error);
        }

        return null;
    } catch (error) {
        console.error(`Error extracting documents URL from service.bund.de notice ${serviceBundUrl}:`, error);
        return null;
    }
}

async function extractDtvpDocumentsUrl(bekanntmachungUrl: string): Promise<string | null> {
    try {
        console.log(`Following Bekanntmachung URL: ${bekanntmachungUrl}`);
        
        // Check if this is a DTVP URL
        if (!bekanntmachungUrl.includes('dtvp.de')) {
            console.log('Bekanntmachung URL does not lead to DTVP, cannot proceed');
            return null;
        }

        // Navigate to the DTVP page and look for the project structure
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
            
            await page.goto(bekanntmachungUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Wait for the page to load
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Look for the "Teilnahmeunterlagen" link or button in the side menu
            const teilnahmeunterlagenUrl = await page.evaluate(() => {
                // Look for navigation links that contain "Teilnahmeunterlagen"
                const links = Array.from(document.querySelectorAll('a, button'));
                for (const link of links) {
                    const text = (link.textContent || '').trim();
                    const href = link.getAttribute('href');
                    
                    if (text.includes('Teilnahmeunterlagen') && href) {
                        return new URL(href, window.location.href).href;
                    }
                }
                
                // Alternative approach: construct the URL from the current URL
                const currentUrl = window.location.href;
                if (currentUrl.includes('/de/overview') || currentUrl.includes('/de/')) {
                    // Replace the last part with 'documents'
                    return currentUrl.replace(/\/[^\/]*(\?.*)?$/, '/documents');
                }
                
                return null;
            });

            await browser.close();

            if (teilnahmeunterlagenUrl) {
                console.log(`Found Teilnahmeunterlagen URL: ${teilnahmeunterlagenUrl}`);
                return teilnahmeunterlagenUrl;
            } else {
                // Try to construct the documents URL from the overview URL
                const documentsUrl = bekanntmachungUrl.replace(/\/[^\/]*(\?.*)?$/, '/documents');
                console.log(`Constructed documents URL: ${documentsUrl}`);
                return documentsUrl;
            }

        } catch (error) {
            await browser.close();
            throw error;
        }

    } catch (error) {
        console.error(`Error extracting DTVP documents URL from ${bekanntmachungUrl}:`, error);
        return null;
    }
}

export async function handleServiceBund(page: any, url: string): Promise<Map<string, Buffer>> {
    console.log('Detected service.bund.de - extracting documents page and handling via DTVP...');
    
    try {
        // Extract the documents page URL
        const documentsPageUrl = await extractDocumentsPageFromServiceBund(url);
        
        if (!documentsPageUrl) {
            console.log('Could not extract documents page URL from service.bund.de');
            return new Map();
        }

        console.log(`Navigating to documents page: ${documentsPageUrl}`);
        
        // Navigate to the documents page
        await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        // Use the DTVP handler to collect documents since we're now on a DTVP page
        return await handleDtvp(page, documentsPageUrl);
        
    } catch (error) {
        console.error('Error handling service.bund.de:', error);
        return new Map();
    }
}
