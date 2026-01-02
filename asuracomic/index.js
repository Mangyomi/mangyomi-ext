const { JSDOM } = require('jsdom');

const BASE_URL = 'https://asuracomic.net';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500;

async function fetchPage(url, retries = 2) {
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
            },
        });

        if (response.status === 429) {
            if (retries > 0) {
                await delay(2000 + Math.random() * 1000);
                return fetchPage(url, retries - 1);
            }
            throw new Error('HTTP 429: Too Many Requests');
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
    const seenIds = new Set();

    // Find all anchor links to individual series pages
    // Selector robust to relative or absolute links
    const mangaLinks = doc.querySelectorAll('a[href*="series/"]');

    for (const link of mangaLinks) {
        try {
            const href = link.getAttribute('href') || '';

            // Format: series/slug-name-hashcode (flexible match)
            const match = href.match(/series\/([a-z0-9][a-z0-9-]*[a-z0-9])$/i);
            if (!match) continue;

            const id = match[1];
            if (seenIds.has(id)) continue;

            // Must have an image (skip text-only links)
            const img = link.querySelector('img');
            if (!img) continue;

            let coverUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
            if (!coverUrl) continue;
            if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
            else if (!coverUrl.startsWith('http')) coverUrl = BASE_URL + (coverUrl.startsWith('/') ? '' : '/') + coverUrl;

            // Get title from spans
            const spans = link.querySelectorAll('span');
            let title = '';

            for (const span of spans) {
                const className = span.className || '';
                // Title usually has font-bold and block
                if (className.includes('font-bold') && className.includes('block')) {
                    title = span.textContent?.trim() || '';
                    break;
                }
            }

            // Fallback: find any span with font-bold
            if (!title) {
                const titleSpan = link.querySelector('span[class*="font-bold"]');
                if (titleSpan) {
                    title = titleSpan.textContent?.trim() || '';
                }
            }

            if (!title || title.length < 2) continue;

            // Skip navigation links and known sidebar items if they get caught
            if (title.toLowerCase().match(/^(home|bookmarks|comics|login|recruitment|popular)$/)) continue;

            seenIds.add(id);

            items.push({
                id,
                title,
                coverUrl,
                url: href.startsWith('http') ? href : BASE_URL + (href.startsWith('/') ? '' : '/') + href,
            });
        } catch (e) {
            console.error('Error parsing manga item:', e);
        }
    }

    return items;
}

function parseLatestManga(doc) {
    const items = [];
    const seenIds = new Set();

    // The homepage "Latest Updates" section uses a specific list layout.
    // Each item is typically in a wrapper with `border-b-[1px]` or `grid-cols-12`.
    // Example structure:
    // <div class="w-full p-1 pt-1 pb-3 border-b-[1px] ...">
    //   <div class="grid grid-rows-1 grid-cols-12 m-2">
    //     <div class="col-span-3"> <a href...><img ...></a> </div>
    //     <div class="col-span-9"> <a href...>Title</a> ... </div>
    //   </div>
    // </div>

    // We select the grid containers directly as they contain both the image and content
    const itemGrids = doc.querySelectorAll('div.grid');

    for (const grid of itemGrids) {
        try {
            // Check if this grid looks like a manga item (has image link and title link)
            const imgLink = grid.querySelector('a[href*="/series/"] img') ? grid.querySelector('a[href*="/series/"]') : null;
            if (!imgLink) continue;

            // Find title link: a separate link to /series/ that has text
            const seriesLinks = grid.querySelectorAll('a[href*="/series/"]');
            let titleLink = null;

            for (const link of seriesLinks) {
                if (link !== imgLink && link.textContent.trim().length > 0) {
                    titleLink = link;
                    break;
                }
            }

            if (!titleLink) continue;

            const href = titleLink.getAttribute('href') || '';
            const match = href.match(/\/series\/([a-z0-9][a-z0-9-]*[a-z0-9])$/i);
            if (!match) continue;

            const id = match[1];
            if (seenIds.has(id)) continue;

            const title = titleLink.textContent.trim();
            if (!title) continue;

            const img = imgLink.querySelector('img');
            let coverUrl = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
            if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
            else if (coverUrl && !coverUrl.startsWith('http')) coverUrl = BASE_URL + (coverUrl.startsWith('/') ? '' : '/') + coverUrl;

            seenIds.add(id);
            items.push({
                id,
                title,
                coverUrl,
                url: href.startsWith('http') ? href : BASE_URL + (href.startsWith('/') ? '' : '/') + href,
            });

        } catch (e) {
            console.error('Error parsing latest manga item:', e);
        }
    }

    return items;
}

function hasNextPage(doc, currentPage) {
    // Check for explicit pagination links with page=N
    const nextLinks = doc.querySelectorAll('a[href*="page="]');
    for (const link of nextLinks) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/page=(\d+)/);
        if (match && parseInt(match[1]) > currentPage) {
            return true;
        }
    }

    // Check for "Next" button by text content or class
    // Homepage uses: <a href="/page/2" ...>Next</a>
    const buttons = Array.from(doc.querySelectorAll('a, button'));
    for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        // Check text
        if (text === 'next' || text.includes('»') || text.includes('next')) {
            if (btn.disabled) return false;

            const style = btn.getAttribute('style') || '';
            const className = btn.getAttribute('class') || '';

            // Check for disabled styles
            if (style.includes('display:none') || style.includes('display: none')) return false;
            if (style.includes('pointer-events:none') || style.includes('pointer-events: none')) return false;
            if (className.includes('disabled') || className.includes('opacity-50')) return false;

            return true;
        }
    }

    // Explicit check for homepage's "/page/N" link
    const homepageNext = doc.querySelector(`a[href="/page/${currentPage + 1}"]`);
    if (homepageNext) return true;

    return false;
}

module.exports = {
    getImageHeaders() {
        return {
            'Referer': BASE_URL + '/',
        };
    },

    async getPopularManga(page) {
        // Use series list for popular/all view with order=popular
        const url = `${BASE_URL}/series?page=${page}&order=popular`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        return {
            manga: parseMangaList(doc),
            hasNextPage: hasNextPage(doc, page),
        };
    },

    async getLatestManga(page) {
        // Use the homepage feed which supports pagination via /page/N
        const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        return {
            manga: parseLatestManga(doc),
            hasNextPage: hasNextPage(doc, page),
        };
    },

    async searchManga(query, page) {
        const url = `${BASE_URL}/series?page=${page}&name=${encodeURIComponent(query)}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        return {
            manga: parseMangaList(doc),
            hasNextPage: hasNextPage(doc, page),
        };
    },

    async getMangaDetails(mangaId) {
        const url = `${BASE_URL}/series/${mangaId}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        // Title - look for the specific title span (text-xl font-bold)
        let title = '';
        const titleEl = doc.querySelector('span.text-xl.font-bold');
        if (titleEl) {
            title = titleEl.textContent?.trim() || '';
        }

        // Fallback to og:title if DOM selector fails
        if (!title) {
            const ogTitle = doc.querySelector('meta[property="og:title"]');
            const ogContent = ogTitle?.getAttribute('content') || '';
            // Remove " - Asura Scans" suffix
            title = ogContent.replace(/ - Asura Scans$/i, '').trim() || mangaId;
        }

        // Cover from img[alt="poster"] or og:image
        let coverUrl = '';
        const posterImg = doc.querySelector('img[alt="poster"]');
        if (posterImg) {
            coverUrl = posterImg.getAttribute('src') || posterImg.getAttribute('data-src') || '';
        }
        if (!coverUrl) {
            const ogImage = doc.querySelector('meta[property="og:image"]');
            coverUrl = ogImage?.getAttribute('content') || '';
        }
        if (!coverUrl) {
            const img = doc.querySelector('img[src*="storage"]');
            coverUrl = img?.getAttribute('src') || '';
        }
        if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
        else if (coverUrl && !coverUrl.startsWith('http')) coverUrl = BASE_URL + (coverUrl.startsWith('/') ? '' : '/') + coverUrl;

        // Synopsis
        let description = '';
        const headers = doc.querySelectorAll('h3');
        for (const h of headers) {
            if (h.textContent?.toLowerCase().includes('synopsis')) {
                // Try parent's paragraph (common in their layout)
                const parent = h.parentElement;
                if (parent) {
                    const p = parent.querySelector('p');
                    if (p) {
                        description = p.textContent?.trim() || '';
                        break;
                    }
                }

                // Fallback to next sibling
                let next = h.nextElementSibling;
                while (next && next.tagName !== 'H3') {
                    const text = next.textContent?.trim();
                    if (text && text.length > 20 && !text.toLowerCase().includes('keywords')) {
                        description = text;
                        break;
                    }
                    next = next.nextElementSibling;
                }
                break;
            }
        }
        if (!description) {
            const metaDesc = doc.querySelector('meta[name="description"]');
            description = metaDesc?.getAttribute('content') || '';
        }
        description = description.trim();

        // Genres
        const genres = [];
        const genreButtons = doc.querySelectorAll('button');
        for (const btn of genreButtons) {
            const genre = btn.textContent?.trim();
            if (genre && genre.length > 1 && genre.length < 30 &&
                !genre.toLowerCase().includes('start') &&
                !genre.toLowerCase().includes('add') &&
                !genre.toLowerCase().includes('chapter') &&
                !genres.includes(genre)) {
                genres.push(genre);
            }
        }

        // Status
        let status = 'unknown';
        const statusLabel = Array.from(doc.querySelectorAll('h3')).find(el => el.textContent?.trim() === 'Status');
        if (statusLabel && statusLabel.nextElementSibling) {
            status = statusLabel.nextElementSibling.textContent?.trim().toLowerCase() || 'unknown';
        } else {
            const statusMatch = html.match(/>\s*(Ongoing|Completed|Hiatus|Dropped)\s*</i);
            if (statusMatch) status = statusMatch[1].toLowerCase();
        }

        // Author
        let author = '';
        const authorLabel = Array.from(doc.querySelectorAll('h3')).find(el => el.textContent?.trim() === 'Author');
        if (authorLabel && authorLabel.nextElementSibling) {
            author = authorLabel.nextElementSibling.textContent?.trim() || '';
        } else {
            const authorMatch = html.match(/Author[:\s]+([^<\n]+)/i);
            if (authorMatch) author = authorMatch[1].trim();
        }

        return {
            id: mangaId,
            title,
            coverUrl,
            author: author || 'Unknown',
            artist: author || 'Unknown',
            description,
            status,
            genres,
            url,
        };
    },

    async getChapterList(mangaId) {
        const url = `${BASE_URL}/series/${mangaId}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const chapters = [];
        const seenChapters = new Set();

        const chapterLinks = doc.querySelectorAll('a[href*="/chapter/"]');

        for (const link of chapterLinks) {
            const href = link.getAttribute('href') || '';

            const chapterMatch = href.match(/\/chapter\/(\d+(?:\.\d+)?)/i);
            if (!chapterMatch) continue;

            const chapterNum = chapterMatch[1];
            const chapterNumber = parseFloat(chapterNum);

            if (seenChapters.has(chapterNumber)) continue;
            seenChapters.add(chapterNumber);

            const chapterId = `${mangaId}/chapter/${chapterNum}`;
            let title = link.textContent?.trim() || `Chapter ${chapterNumber}`;

            // Clean up the title
            title = title.replace(/\s+/g, ' ').trim();
            // Remove "New Chapter" or "First Chapter" prefix
            title = title.replace(/^(New|First)\s*Chapter\s*/i, '');
            // Remove date patterns like "December 30th 2025", "January 1st 2026", etc.
            title = title.replace(/\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}\s*$/i, '');
            title = title.trim();

            let uploadDate;
            const parent = link.closest('div, a');
            if (parent) {
                const dateText = parent.textContent || '';
                const dateMatch = dateText.match(/(\w+ \d+(?:st|nd|rd|th)?,? \d{4})/i);
                if (dateMatch) uploadDate = Date.parse(dateMatch[1]);
            }

            // Force strict URL construction: BASE_URL/series/MANGA_ID/chapter/CHAPTER_NUM
            const chapterUrl = `${BASE_URL}/series/${mangaId}/chapter/${chapterNum}`;

            chapters.push({
                id: chapterId,
                title: title.includes('Chapter') ? title : `Chapter ${chapterNumber}`,
                chapterNumber,
                url: chapterUrl,
                uploadDate: isNaN(uploadDate) ? undefined : uploadDate,
            });
        }

        chapters.sort((a, b) => b.chapterNumber - a.chapterNumber);
        return chapters;
    },

    async getChapterPages(chapterId) {
        // console.log(`[Asura] Fetching pages for chapterId: ${chapterId}`);
        const url = `${BASE_URL}/series/${chapterId}`;
        const html = await fetchPage(url);

        const regex = /https?:\\?\/\\?\/[^"'\s\\]+\.(?:webp|jpg|png|jpeg)/gi;
        const matches = html.match(regex) || [];
        // console.log(`[Asura] Found ${matches.length} regex matches`);

        const items = [];
        const seen = new Set();

        matches.forEach(m => {
            let src = m.replace(/\\/g, '');
            if (src.startsWith('//')) src = 'https:' + src;
            if (!src.startsWith('http')) return;
            if (!src.includes('gg.asuracomic.net') && !src.includes('storage')) return;

            // Filter obvious junk
            if (src.includes('logo') || src.includes('avatar') || src.includes('icon') || src.includes('banner')) return;

            if (seen.has(src)) return;
            seen.add(src);

            // Extract Media ID (e.g., .../media/393435/...)
            const idMatch = src.match(/\/media\/(\d+)\//);
            const mediaId = idMatch ? parseInt(idMatch[1], 10) : 0;

            if (mediaId === 0) return; // Skip if no ID found

            // Check for numeric filename for secondary sorting
            let filename = src.split('/').pop().split('.')[0];
            filename = filename.replace(/-optimized$/, '');
            const pageNum = /^\d+$/.test(filename) ? parseInt(filename, 10) : null;

            items.push({ src, mediaId, pageNum });
        });

        if (items.length === 0) return [];

        // Sort by Media ID to identify sequences
        items.sort((a, b) => a.mediaId - b.mediaId);

        // Cluster items by sequential Media IDs (strict increment)
        const clusters = [];
        let currentCluster = [items[0]];
        // User requested strict increment of 1. If gap > 1, break cluster.
        const GAP_TOLERANCE = 1;

        for (let i = 1; i < items.length; i++) {
            const prev = items[i - 1];
            const curr = items[i];

            if (curr.mediaId - prev.mediaId <= GAP_TOLERANCE) {
                currentCluster.push(curr);
            } else {
                clusters.push(currentCluster);
                currentCluster = [curr];
            }
        }
        clusters.push(currentCluster);

        // Select the largest cluster (the chapter content)
        // If there's a tie, prefer the one with higher Media IDs (likely newer/chapter content vs old assets)? 
        // Usually chapter content is the largest group.
        let mainCluster = clusters[0];
        for (const cluster of clusters) {
            if (cluster.length > mainCluster.length) {
                mainCluster = cluster;
            }
        }

        // console.log(`[Asura] Identify ${clusters.length} clusters. Largest has ${mainCluster.length} images.`);

        // Sort the main cluster
        // If pageNum exists, use it (safest for order). Else use mediaId.
        const useNumericSort = mainCluster.every(item => item.pageNum !== null);

        if (useNumericSort) {
            mainCluster.sort((a, b) => a.pageNum - b.pageNum);
        } else {
            mainCluster.sort((a, b) => a.mediaId - b.mediaId);
        }

        return mainCluster.map(p => p.src);
    },
};
