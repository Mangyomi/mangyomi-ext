

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_URL = 'https://www.mangakakalot.gg';


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
                await delay(2000 + Math.random() * 1000); // 2-3s delay
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


function parseHTML(html) {
    const dom = new JSDOM(html);
    return dom.window.document;
}


function parseMangaList(doc) {
    const items = [];

    // Try different selectors for manga items (the site uses various layouts)
    const mangaItems = doc.querySelectorAll('.list-comic-item-wrap, .list-truyen-item-wrap, .story_item, .content-genres-item');

    for (const item of mangaItems) {
        try {
            // Skip ads - check for common ad indicators in HTML content
            const itemHtml = item.innerHTML?.toLowerCase() || '';
            const itemClass = item.className?.toLowerCase() || '';
            if (
                itemClass.includes('ad') ||
                itemHtml.includes('advertisement') ||
                itemHtml.includes('sponsor') ||
                itemHtml.includes('promoted') ||
                itemHtml.includes('soulmate') ||
                itemHtml.includes('dating')
            ) {
                continue;
            }

            // Find the story item link (contains cover image)
            const storyItem = item.querySelector('.list-story-item');
            const linkEl = storyItem || item.querySelector('a[href*="/manga/"]');
            if (!linkEl) continue;

            // Find title - can be in h3 a or in the story item title attribute
            const titleEl = item.querySelector('h3 a');

            // Find cover image
            const imgEl = item.querySelector('img');

            const url = linkEl.href || linkEl.getAttribute('href') || '';
            const title = titleEl?.textContent?.trim() || linkEl.getAttribute('title') || linkEl.textContent?.trim() || imgEl?.alt || '';
            let coverUrl = imgEl?.src || imgEl?.getAttribute('data-src') || '';

            // Extract manga ID from URL (slug)
            const match = url.match(/\/manga\/([^\/\?]+)/);
            if (!match) continue;

            const id = match[1];

            // Skip if title is empty or too short
            if (!title || title.length < 2) continue;

            // Skip external/ad URLs (must be mangakakalot link)
            if (url.includes('http') && !url.includes('mangakakalot')) continue;

            // Fix relative or protocol-relative URLs
            if (coverUrl.startsWith('//')) {
                coverUrl = 'https:' + coverUrl;
            } else if (coverUrl.startsWith('/')) {
                coverUrl = BASE_URL + coverUrl;
            }

            // Skip ad network images
            if (
                coverUrl.includes('doubleclick') ||
                coverUrl.includes('googlesyndication') ||
                coverUrl.includes('adservice') ||
                coverUrl.includes('amazon-adsystem') ||
                coverUrl.includes('ads.')
            ) {
                continue;
            }

            items.push({
                id,
                title: title.replace(/\s+/g, ' ').trim(),
                coverUrl,
                url: url.startsWith('http') ? url : BASE_URL + url,
            });
        } catch (e) {
            console.error('Error parsing manga item:', e);
        }
    }

    return items;
}


function hasNextPage(doc) {
    // Look for pagination elements
    const lastPage = doc.querySelector('.page_last, a.page_blue.page_last');
    const nextPage = doc.querySelector('a.page_blue:not(.page_last)');

    return !!(lastPage || nextPage);
}

module.exports = {

    getImageHeaders() {
        return {
            'Referer': BASE_URL + '/',
        };
    },


    async getPopularManga(page) {
        try {
            const url = `${BASE_URL}/manga-list/hot-manga?page=${page}`;
            const html = await fetchPage(url);
            const doc = parseHTML(html);

            return {
                manga: parseMangaList(doc),
                hasNextPage: hasNextPage(doc),
            };
        } catch (e) {
            console.error('getPopularManga failed:', e);
            throw e;
        }
    },


    async getLatestManga(page) {
        const url = `${BASE_URL}/manga-list/latest-manga?page=${page}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        return {
            manga: parseMangaList(doc),
            hasNextPage: hasNextPage(doc),
        };
    },


    async searchManga(query, page) {
        const searchQuery = query.replace(/\s+/g, '_');
        const url = `${BASE_URL}/search/story/${searchQuery}?page=${page}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        return {
            manga: parseMangaList(doc),
            hasNextPage: hasNextPage(doc),
        };
    },


    async getMangaDetails(mangaId) {
        const url = `${BASE_URL}/manga/${mangaId}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        // Extract basic info
        const title = doc.querySelector('h1')?.textContent?.trim() || mangaId;
        const coverImg = doc.querySelector('.manga-info-pic img, .story-info-left img');
        let coverUrl = coverImg?.src || coverImg?.getAttribute('data-src') || '';

        if (coverUrl.startsWith('//')) {
            coverUrl = 'https:' + coverUrl;
        }

        // Extract metadata from info list
        const infoItems = doc.querySelectorAll('.manga-info-text li, .variations-tableInfo tr, .story-info-right-extent p');
        let author = '';
        let artist = '';
        let status = 'unknown';
        const genres = [];

        for (const item of infoItems) {
            const text = item.textContent || '';

            if (text.toLowerCase().includes('author')) {
                const authorLinks = item.querySelectorAll('a');
                author = Array.from(authorLinks).map(a => a.textContent?.trim()).filter(Boolean).join(', ')
                    || text.replace(/Author\s*[:\-]?\s*/i, '').trim();
            }

            if (text.toLowerCase().includes('status')) {
                if (text.toLowerCase().includes('ongoing')) status = 'ongoing';
                else if (text.toLowerCase().includes('completed')) status = 'completed';
            }
        }

        // Extract genres
        const genreContainer = doc.querySelector('.manga-info-text li:last-child, .genres-content');
        if (genreContainer) {
            const genreLinks = genreContainer.querySelectorAll('a');
            for (const link of genreLinks) {
                const genre = link.textContent?.trim();
                if (genre && !genre.toLowerCase().includes('genre')) {
                    genres.push(genre);
                }
            }
        }

        // Extract description
        let textContent = '';

        try {
            const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                const sanitizedJson = script.textContent.replace(/[\x00-\x1F\x7F]/g, (char) => {
                    const escapes = {
                        '\b': '\\b',
                        '\f': '\\f',
                        '\n': '\\n',
                        '\r': '\\r',
                        '\t': '\\t',
                    };
                    return escapes[char] || '';
                });
                const data = JSON.parse(sanitizedJson);
                if (data['@type'] === 'Book' && data.description) {
                    textContent = data.description;
                    break;
                }
                if (data.mainEntity && data.mainEntity['@type'] === 'Book' && data.mainEntity.description) {
                    textContent = data.mainEntity.description;
                    break;
                }
            }
        } catch (e) {
            console.error('Error parsing JSON-LD:', e);
        }

        // 2. Try standard selectors
        if (!textContent) {
            const descEl = doc.querySelector('#panel-story-info-description, #noidungm, .panel-story-info-description, [itemprop="description"], .manga-info-description');
            if (descEl) {
                textContent = descEl.textContent;
            }
        }

        // 2. Fallback: Search for "Description" header and get next element
        if (!textContent) {
            const headers = Array.from(doc.querySelectorAll('h2, h3, h4, strong, b'));
            const descHeader = headers.find(el => (el.textContent || '').trim().match(/^(Description|Summary)/i));
            if (descHeader) {
                // Try next sibling
                let next = descHeader.nextElementSibling;
                if (next && next.tagName !== 'SCRIPT' && next.tagName !== 'STYLE') {
                    textContent = next.textContent;
                } else if (descHeader.parentElement) {
                    // Try parent's next sibling or text content
                    textContent = descHeader.parentElement.textContent;
                }
            }
        }

        // 3. Last resort: Meta description
        if (!textContent) {
            textContent = doc.querySelector('meta[name="description"]')?.content ||
                doc.querySelector('meta[property="og:description"]')?.content || '';
        }

        let description = textContent?.trim() || '';

        // Clean up "Description :" prefix and other common prefixes
        description = description
            .replace(/^(Description|Summary)\s*[:\-]?\s*/i, '')
            .replace(/Read\s+more$/i, '')
            .trim();

        return {
            id: mangaId,
            title,
            coverUrl,
            author,
            artist: artist || author,
            description,
            status,
            genres,
            url,
        };
    },


    async getChapterList(mangaId) {
        const url = `${BASE_URL}/manga/${mangaId}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const chapters = [];
        const chapterLinks = doc.querySelectorAll('.chapter-list a, .row-content-chapter a, a.chapter-name');

        for (const link of chapterLinks) {
            const href = link.href || link.getAttribute('href') || '';
            const text = link.textContent?.trim() || '';

            // Extract chapter number from URL or text
            const chapterMatch = href.match(/chapter[_-]?(\d+(?:[._-]\d+)?)/i)
                || text.match(/chapter\s*(\d+(?:\.\d+)?)/i);

            if (!chapterMatch) continue;

            const chapterNum = chapterMatch[1].replace(/[_-]/g, '.');
            const chapterNumber = parseFloat(chapterNum);
            const chapterId = `${mangaId}/chapter-${chapterMatch[1]}`;

            // Try to get upload date
            const parentRow = link.closest('.row, li, tr');
            const timeEl = parentRow?.querySelector('.chapter-time, span[title], .chapter-time-text');
            const timeText = timeEl?.textContent || timeEl?.getAttribute('title') || '';
            const uploadDate = timeText ? Date.parse(timeText) : undefined;

            chapters.push({
                id: chapterId,
                title: text || `Chapter ${chapterNumber}`,
                chapterNumber,
                url: href.startsWith('http') ? href : BASE_URL + href,
                uploadDate: isNaN(uploadDate) ? undefined : uploadDate,
            });
        }

        // Sort by chapter number descending (latest first) and remove duplicates
        const uniqueChapters = chapters.reduce((acc, ch) => {
            if (!acc.find(c => c.chapterNumber === ch.chapterNumber)) {
                acc.push(ch);
            }
            return acc;
        }, []);

        uniqueChapters.sort((a, b) => b.chapterNumber - a.chapterNumber);

        return uniqueChapters;
    },


    async getChapterPages(chapterId) {
        const url = `${BASE_URL}/manga/${chapterId}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const pages = [];
        const container = doc.querySelector('.container-chapter-reader, .vung-doc, #vungdoc');

        if (!container) {
            console.error('Chapter reader container not found');
            // Try finding images in the whole document
            const allImages = doc.querySelectorAll('img[src*="storage"], img[data-src*="storage"]');
            for (const img of allImages) {
                const src = img.src || img.getAttribute('data-src') || '';
                if (src) {
                    pages.push(src.startsWith('//') ? 'https:' + src : src);
                }
            }
            return pages;
        }

        const images = container.querySelectorAll('img');

        for (const img of images) {
            // Check both src and data-src for lazy loaded images
            let src = img.src || img.getAttribute('data-src') || '';
            const alt = (img.getAttribute('alt') || '').toLowerCase();
            const title = (img.getAttribute('title') || '').toLowerCase();
            const srcLower = src.toLowerCase();

            // Ad filtering
            if (
                srcLower.includes('soulmate') ||
                srcLower.includes('webnovel') ||
                srcLower.includes('dating') ||
                srcLower.includes('betting') ||
                srcLower.includes('casino') ||
                srcLower.includes('banner') ||
                srcLower.includes('ad.') ||
                srcLower.includes('ads.') ||
                srcLower.includes('doubleclick') ||
                srcLower.includes('googlesyndication') ||
                srcLower.includes('adservice') ||
                srcLower.includes('amazon-adsystem') ||
                srcLower.includes('/images/bns/') ||
                alt.includes('soulmate') ||
                alt.includes('webnovel') ||
                title.includes('soulmate') ||
                title.includes('webnovel')
            ) {
                continue;
            }

            // Check parent/ancestors for ad classes
            const parent = img.closest('.ad, .banner, .advertisement, .ads, .facebook-share, .twitter-share, .banner-owner');
            if (parent) continue;

            if (src) {
                // Fix protocol-relative URLs
                if (src.startsWith('//')) {
                    src = 'https:' + src;
                }
                if (src.includes('http')) {
                    pages.push(src);
                }
            }
        }

        return pages;
    },
};
