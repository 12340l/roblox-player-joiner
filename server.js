const express = require('express');
const axios = require('axios');
const noblox = require('noblox.js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

// Helper: Extracts the unique Asset ID from a Roblox CDN URL
// This prevents the "No Access to Asset" error because we compare the ID, not the link.
const getAssetId = (url) => {
    if (!url) return null;
    const match = url.match(/assetid=(\d+)/i) || url.match(/hash=([a-f0-9]+)/i);
    return match ? match[1] : url;
};

const wait = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchWithRetry(url, options = {}, retries = 3) {
    try {
        return await axios(url, options);
    } catch (err) {
        if (retries > 0 && err.response?.status === 429) {
            await wait(1500);
            return fetchWithRetry(url, options, retries - 1);
        }
        throw err;
    }
}

app.get('/find-player', async (req, res) => {
    const { username, placeId } = req.query;
    const startTime = Date.now();

    try {
        // 1. Get Target Info
        const userId = await noblox.getIdFromUsername(username);
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=48x48&format=Png&isCircular=false`);
        
        if (!thumbRes.data.data[0]) {
            return res.json({ success: false, message: "Target profile is private or hidden." });
        }
        
        const targetAssetId = getAssetId(thumbRes.data.data[0].imageUrl);
        let cursor = "";
        let foundJobId = null;
        let playersChecked = 0;

        // 2. High-Capacity Scanner Loop
        // We scan up to 40 pages (4,000 players) in blocks of 5
        for (let i = 0; i < 40 && !foundJobId; i += 5) {
            if (Date.now() - startTime > 27000) break; // Render Timeout Guard (27s)

            const pageRequests = [];
            for (let p = 0; p < 5; p++) {
                let url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&sortOrder=Desc&cursor=${cursor}`;
                pageRequests.push(fetchWithRetry(url).then(r => {
                    cursor = r.data.nextPageCursor;
                    return r.data.data;
                }).catch(() => []));
                if (!cursor) break;
            }

            const pages = await Promise.all(pageRequests);
            const allServers = pages.flat();

            // 3. Optimized Batch Post
            const batchRequests = [];
            allServers.forEach(server => {
                if (!server || !server.playerTokens) return;
                playersChecked += server.playing;

                const payload = server.playerTokens.map(token => ({
                    token,
                    type: "AvatarHeadShot",
                    size: "48x48", // Smaller size = faster response from Roblox
                    requestId: server.id 
                }));

                // Process in chunks of 100
                for (let j = 0; j < payload.length; j += 100) {
                    batchRequests.push(
                        fetchWithRetry('https://thumbnails.roblox.com/v1/batch', {
                            method: 'POST',
                            data: payload.slice(j, j + 100)
                        }).then(r => {
                            const match = r.data.data.find(img => getAssetId(img.imageUrl) === targetAssetId);
                            return match ? match.requestId.split(':')[0] : null;
                        }).catch(() => null)
                    );
                }
            });

            const results = await Promise.all(batchRequests);
            foundJobId = results.find(id => id !== null);
            if (!cursor) break;
        }

        res.json({ 
            success: !!foundJobId, 
            jobId: foundJobId, 
            scanned: playersChecked,
            targetChecked: username
        });

    } catch (err) {
        console.error("Sniper Error:", err.message);
        res.status(500).json({ success: false, error: "Engine timeout or API block." });
    }
});

app.listen(PORT, () => console.log(`Potato Sniper V7 (Anti-Patch) listening on ${PORT}`));
