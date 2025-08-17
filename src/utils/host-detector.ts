export interface HostInfo {
    type: 'dtvp' | 'vergabe-niedersachsen' | 'subreport-elvis' | 'evergabe' | 'cosinex' | 'vergabemarktplatz' | 'vergabe24' | 'bund' | 'bieteportal' | 'bieterportal' | 'b2g' | 'vergabekooperation-berlin' | 'general';
    name: string;
    url: string;
}

export function detectHostFromUrl(url: string): HostInfo {
    const urlLower = url.toLowerCase();
    
    // DTVP (Deutsches Vergabeportal)
    if (urlLower.includes('dtvp.de')) {
        return {
            type: 'dtvp',
            name: 'Deutsches Vergabeportal (DTVP)',
            url: url
        };
    }
    
    // Vergabe Niedersachsen
    if (urlLower.includes('vergabe.niedersachsen.de')) {
        return {
            type: 'vergabe-niedersachsen',
            name: 'Vergabe Niedersachsen',
            url: url
        };
    }
    
    // Subreport Elvis
    if (urlLower.includes('subreport-elvis.de') || urlLower.includes('subreport')) {
        return {
            type: 'subreport-elvis',
            name: 'Subreport Elvis',
            url: url
        };
    }
    
    // Evergabe
    if (urlLower.includes('evergabe') || urlLower.includes('e-vergabe')) {
        return {
            type: 'evergabe',
            name: 'Evergabe',
            url: url
        };
    }
    
    // Cosinex
    if (urlLower.includes('cosinex')) {
        return {
            type: 'cosinex',
            name: 'Cosinex',
            url: url
        };
    }
    
    // Vergabemarktplatz
    if (urlLower.includes('vergabemarktplatz')) {
        return {
            type: 'vergabemarktplatz',
            name: 'Vergabemarktplatz',
            url: url
        };
    }
    
    // Vergabe24
    if (urlLower.includes('vergabe24')) {
        return {
            type: 'vergabe24',
            name: 'Vergabe24',
            url: url
        };
    }
    
    // Bund.de
    if (urlLower.includes('bund.de')) {
        return {
            type: 'bund',
            name: 'Bund.de',
            url: url
        };
    }
    
    // Bieteportal
    if (urlLower.includes('bieteportal')) {
        return {
            type: 'bieteportal',
            name: 'Bieteportal',
            url: url
        };
    }
    
    // Bieterportal
    if (urlLower.includes('bieterportal')) {
        return {
            type: 'bieterportal',
            name: 'Bieterportal',
            url: url
        };
    }
    
    // B2G
    if (urlLower.includes('b2g')) {
        return {
            type: 'b2g',
            name: 'B2G',
            url: url
        };
    }
    
    // Vergabekooperation Berlin
    if (urlLower.includes('vergabekooperation.berlin')) {
        return {
            type: 'vergabekooperation-berlin',
            name: 'Vergabekooperation Berlin',
            url: url
        };
    }
    
    // Default to general handler
    return {
        type: 'general',
        name: 'General Handler',
        url: url
    };
}

export function getHostHandlerName(hostInfo: HostInfo): string {
    switch (hostInfo.type) {
        case 'dtvp':
            return 'handleDtvp';
        case 'vergabe-niedersachsen':
            return 'handleVergabeNiedersachsen';
        case 'subreport-elvis':
            return 'handleSubreportElvis';
        case 'evergabe':
            return 'handleEvergabe';
        case 'cosinex':
            return 'handleCosinex';
        case 'vergabemarktplatz':
            return 'handleVergabemarktplatz';
        case 'vergabe24':
            return 'handleVergabe24';
        case 'bund':
            return 'handleBund';
        case 'bieteportal':
            return 'handleBieteportal';
        case 'bieterportal':
            return 'handleBieterportal';
        case 'b2g':
            return 'handleB2g';
        case 'vergabekooperation-berlin':
            return 'handleVergabekooperationBerlin';
        default:
            return 'general';
    }
}
