

// Extension runs in sandboxed browser environment
// Available APIs: fetch (domain-whitelisted), parseHTML (browser-native DOMParser)

const BASE_URL = 'https://hentaiforce.net';
const IMAGE_CDN = 'https://m1.hentaiforce.me';


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));


let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 600; // ms


async function fetchPage(url, retries = 2) {
    // Rate limit
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_REQUEST_INTERVAL) {
        await delay(MIN_REQUEST_INTERVAL - timeSinceLast);
    }
    lastRequestTime = Date.now();

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': BASE_URL + '/',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            },
        });

        if (response.status === 429) {
            if (retries > 0) {
                console.warn(`Rate limited on ${url}, waiting 2s...`);
                await delay(2000 + Math.random() * 1000);
                return fetchPage(url, retries - 1);
            }
            throw new Error('HTTP 429: Too Many Requests (Rate Limit Exceeded)');
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.text();
    } catch (error) {
        if (error.cause && (error.cause.code === 'ECONNRESET' || error.cause.code === 'ETIMEDOUT')) {
            if (retries > 0) {
                await delay(1000);
                return fetchPage(url, retries - 1);
            }
        }
        throw error;
    }
}


// parseHTML uses browser-native DOMParser
function parseHTMLDoc(html) {
    const globalParseHTML = typeof parseHTML !== 'undefined' ? parseHTML : null;
    if (globalParseHTML) {
        return globalParseHTML(html);
    }
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
}


function parseGalleryList(doc) {
    const items = [];
    const seenIds = new Set();

    // Debug: log available elements
    console.log('Parsing gallery list...');

    // HentaiForce structure:
    // .gallery-wrapper > .gallery > .gallery-thumb (image link) + .gallery-name > h2 > a (title)

    // Try to find gallery items - prioritize .gallery
    const selectors = [
        '.gallery',           // Main HentaiForce gallery item
        '.gallery-wrapper',
        '.single-column',
        '.gallery-item',
        '.hentai-item',
    ];

    let containers = [];
    for (const selector of selectors) {
        try {
            const found = doc.querySelectorAll(selector);
            if (found.length > 0) {
                console.log(`Found ${found.length} items with selector: ${selector}`);
                containers = found;
                break;
            }
        } catch (e) {
            // :has() might not be supported
        }
    }

    // Process containers
    for (const item of containers) {
        try {
            const linkEl = item.querySelector('a[href*="/view/"]');
            if (!linkEl) continue;

            const href = linkEl.href || linkEl.getAttribute('href') || '';
            const match = href.match(/\/view\/(\d+)/);
            if (!match) continue;

            const id = match[1];
            if (seenIds.has(id)) continue;
            seenIds.add(id);

            const imgEl = item.querySelector('img');

            // Try multiple title sources
            let title = '';

            // 1. Check for caption/title elements - HentaiForce uses .gallery-name h2 a
            const captionSelectors = ['.gallery-name h2 a', '.gallery-name h2', '.gallery-name', '.caption', '.title', 'h2 a', 'h2'];
            for (const sel of captionSelectors) {
                const el = item.querySelector(sel);
                if (el && el.textContent?.trim()) {
                    title = el.textContent.trim();
                    break;
                }
            }

            // 2. Check link title attribute
            if (!title) {
                title = linkEl.getAttribute('title') || '';
            }

            // 3. Check image alt
            if (!title && imgEl) {
                title = imgEl.alt || imgEl.getAttribute('alt') || '';
            }

            // 4. Check link text content (but filter out just whitespace/numbers)
            if (!title) {
                const linkText = linkEl.textContent?.trim() || '';
                if (linkText && linkText.length > 5 && !/^\d+$/.test(linkText)) {
                    title = linkText;
                }
            }

            if (!title || title === id || title.length < 3) {
                title = `Gallery ${id}`;
            }

            let coverUrl = imgEl?.getAttribute('data-src') || imgEl?.src || '';
            if (coverUrl.startsWith('//')) {
                coverUrl = 'https:' + coverUrl;
            } else if (coverUrl.startsWith('/')) {
                coverUrl = IMAGE_CDN + coverUrl;
            }

            if (coverUrl) {
                items.push({
                    id,
                    title: title.replace(/\s+/g, ' ').trim(),
                    coverUrl,
                    url: href.startsWith('http') ? href : BASE_URL + href,
                });
            }
        } catch (e) {
            console.error('Error parsing gallery item:', e);
        }
    }

    // Fallback: Find all /view/ links with images directly
    if (items.length === 0) {
        console.log('No containers found, using fallback link search...');
        const allLinks = doc.querySelectorAll('a[href*="/view/"]');
        console.log(`Found ${allLinks.length} view links`);

        for (const linkEl of allLinks) {
            try {
                const href = linkEl.href || linkEl.getAttribute('href') || '';
                const match = href.match(/\/view\/(\d+)/);
                if (!match) continue;

                const id = match[1];
                if (seenIds.has(id)) continue;

                // Check if this link has an image
                const imgEl = linkEl.querySelector('img');
                if (!imgEl) continue; // Skip text-only links

                seenIds.add(id);

                // Get title from various sources
                let title = linkEl.getAttribute('title')
                    || imgEl?.alt
                    || '';

                // Try to find title in sibling/nearby elements
                if (!title) {
                    const parent = linkEl.parentElement;
                    const nextSibling = linkEl.nextElementSibling;
                    const prevSibling = linkEl.previousElementSibling;

                    // Check siblings for caption text
                    for (const el of [nextSibling, prevSibling]) {
                        if (el && el.textContent?.trim() && el.textContent.trim().length > 3) {
                            title = el.textContent.trim();
                            break;
                        }
                    }

                    // Check parent for caption class
                    if (!title && parent) {
                        const caption = parent.querySelector('.caption, .title, span');
                        if (caption && caption !== linkEl) {
                            title = caption.textContent?.trim() || '';
                        }
                    }
                }

                if (!title || title.length < 3) {
                    title = `Gallery ${id}`;
                }

                let coverUrl = imgEl?.getAttribute('data-src') || imgEl?.src || '';
                if (coverUrl.startsWith('//')) {
                    coverUrl = 'https:' + coverUrl;
                } else if (coverUrl.startsWith('/')) {
                    coverUrl = IMAGE_CDN + coverUrl;
                }

                if (coverUrl) {
                    items.push({
                        id,
                        title: title.replace(/\s+/g, ' ').trim(),
                        coverUrl,
                        url: href.startsWith('http') ? href : BASE_URL + href,
                    });
                }
            } catch (e) {
                console.error('Error parsing gallery link:', e);
            }
        }
    }

    console.log(`Parsed ${items.length} gallery items`);
    return items;
}


function hasNextPage(doc) {
    const pagination = doc.querySelector('.pagination');
    if (!pagination) return false;

    // Check for next page link using valid CSS selectors
    const nextLink = pagination.querySelector('a.next, a[rel="next"]');
    if (nextLink) return true;

    // Fallback: check if any link contains "Next" text
    const links = pagination.querySelectorAll('a');
    for (const link of links) {
        if (link.textContent?.toLowerCase().includes('next')) {
            return true;
        }
    }
    return false;
}

module.exports = {

    getImageHeaders() {
        return {
            'Referer': BASE_URL + '/',
        };
    },


    async getPopularManga(page) {
        try {
            const url = page === 1 ? BASE_URL : `${BASE_URL}/?page=${page}`;
            const html = await fetchPage(url);
            const doc = parseHTMLDoc(html);

            return {
                manga: parseGalleryList(doc),
                hasNextPage: hasNextPage(doc),
            };
        } catch (e) {
            console.error('getPopularManga failed:', e);
            throw e;
        }
    },


    async getLatestManga(page) {
        const url = page === 1 ? BASE_URL : `${BASE_URL}/?page=${page}`;
        const html = await fetchPage(url);
        const doc = parseHTMLDoc(html);

        return {
            manga: parseGalleryList(doc),
            hasNextPage: hasNextPage(doc),
        };
    },


    async searchManga(query, page) {
        const searchQuery = encodeURIComponent(query);
        const url = `${BASE_URL}/search?q=${searchQuery}&page=${page}`;
        const html = await fetchPage(url);
        const doc = parseHTMLDoc(html);

        return {
            manga: parseGalleryList(doc),
            hasNextPage: hasNextPage(doc),
        };
    },


    async getMangaDetails(mangaId) {
        const url = `${BASE_URL}/view/${mangaId}`;
        const html = await fetchPage(url);
        const doc = parseHTMLDoc(html);

        // Extract title from h1
        const title = doc.querySelector('h1')?.textContent?.trim() || `Gallery ${mangaId}`;

        // Extract cover image
        const coverImg = doc.querySelector('#gallery-main-cover img');
        let coverUrl = coverImg?.getAttribute('data-src') || coverImg?.src || '';
        if (coverUrl.startsWith('//')) {
            coverUrl = 'https:' + coverUrl;
        }

        // Extract metadata from tag containers
        let artist = '';
        let group = '';
        const genres = [];
        let language = 'english';

        const tagContainers = doc.querySelectorAll('.tag-container');
        for (const container of tagContainers) {
            const fieldName = container.textContent?.toLowerCase() || '';
            const tagButtons = container.querySelectorAll('.tag-btn');
            const tags = Array.from(tagButtons).map(btn => {
                // Get text without the badge number
                const badge = btn.querySelector('.badge');
                if (badge) badge.remove();
                return btn.textContent?.trim();
            }).filter(Boolean);

            if (fieldName.includes('tags:')) {
                genres.push(...tags);
            } else if (fieldName.includes('artists:')) {
                artist = tags.join(', ');
            } else if (fieldName.includes('groups:')) {
                group = tags.join(', ');
            } else if (fieldName.includes('languages:')) {
                language = tags.find(t => t !== 'translated') || 'english';
            }
        }

        // Get page count
        let pageCount = 0;
        const pageCountEl = Array.from(doc.querySelectorAll('.tag-container')).find(
            el => el.textContent?.includes('Pages:')
        );
        if (pageCountEl) {
            const match = pageCountEl.textContent.match(/Pages:\s*(\d+)/);
            if (match) pageCount = parseInt(match[1], 10);
        }

        return {
            id: mangaId,
            title,
            coverUrl,
            author: artist || group || 'Unknown',
            artist: artist || 'Unknown',
            description: '', // HentaiForce doesn't have a traditional description
            details: [
                { label: 'Pages', value: pageCount },
                { label: 'Language', value: language.charAt(0).toUpperCase() + language.slice(1) }
            ],
            status: 'completed', // Doujins are always complete
            genres,
            url,
        };
    },


    async getChapterList(mangaId) {
        // HentaiForce doesn't have chapters, the whole gallery is one "chapter"
        return [{
            id: mangaId,
            title: 'Full Gallery',
            chapterNumber: 1,
            url: `${BASE_URL}/view/${mangaId}/1`,
        }];
    },


    async getChapterPages(chapterId) {
        const url = `${BASE_URL}/view/${chapterId}`;
        const html = await fetchPage(url);
        const doc = parseHTMLDoc(html);

        const pages = [];

        // Find the data ID from the cover image URL pattern
        // Cover URL: https://m1.hentaiforce.me/img/2126714-cover.jpg
        // Page URL:  https://m1.hentaiforce.me/img/2126714-1.jpg (full) or 2126714-1t.jpg (thumb)

        const coverImg = doc.querySelector('#gallery-main-cover img');
        const coverUrl = coverImg?.getAttribute('data-src') || coverImg?.src || '';
        const dataIdMatch = coverUrl.match(/\/img\/(\d+)-/);

        if (!dataIdMatch) {
            console.error('Could not extract data ID from cover URL:', coverUrl);
            return pages;
        }

        const dataId = dataIdMatch[1];

        // Count pages from thumbnails
        const thumbnails = doc.querySelectorAll('#gallery-pages .single-thumb img');
        const pageCount = thumbnails.length;

        if (pageCount === 0) {
            console.error('No thumbnails found');
            return pages;
        }

        // Generate full image URLs
        // Pattern: https://m1.hentaiforce.me/img/{dataId}-{pageNum}.jpg
        for (let i = 1; i <= pageCount; i++) {
            pages.push(`${IMAGE_CDN}/img/${dataId}-${i}.jpg`);
        }

        return pages;
    },
};
