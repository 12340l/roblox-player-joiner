const express = require('express');
const axios = require('axios');
const noblox = require('noblox.js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

const wait = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchWithRetry(url, options = {}, retries = 3) {
    try {
        return await axios(url, options);
    } catch (err) {
        if (retries > 0 && err.response?.status === 429) {
            await wait(1000); // Backoff for rate limits
            return fetchWithRetry(url, options, retries - 1);
        }
        throw err;
    }
}

app.get('/find-player', async (req, res) => {
    const { username, placeId } = req.query;
    const startTime = Date.now();

    try {
        const userId = await noblox.getIdFromUsername(username);
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`);
        const targetUrl = thumbRes.data.data[0].imageUrl;

        let cursor = "";
        let foundJobId = null;
        let playersChecked = 0;

        // Scans in parallel chunks for maximum speed
        for (let i = 0; i < 20 && !foundJobId; i += 4) {
            if (Date.now() - startTime > 26000) break; // Render timeout guard

            const pageRequests = [];
            for (let p = 0; p < 4; p++) {
                let url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&sortOrder=Desc&cursor=${cursor}`;
                pageRequests.push(fetchWithRetry(url).then(r => {
                    cursor = r.data.nextPageCursor;
                    return r.data.data;
                }).catch(() => []));
                if (!cursor) break;
            }

            const pages = await Promise.all(pageRequests);
            const servers = pages.flat();

            const batchRequests = [];
            servers.forEach(server => {
                playersChecked += server.playing;
                const payload = server.playerTokens.map(token => ({
                    token,
                    type: "AvatarHeadShot",
                    size: "150x150",
                    requestId: server.id 
                }));

                for (let j = 0; j < payload.length; j += 100) {
                    batchRequests.push(
                        fetchWithRetry('https://thumbnails.roblox.com/v1/batch', {
                            method: 'POST',
                            data: payload.slice(j, j + 100)
                        }).then(r => {
                            const match = r.data.data.find(img => img.imageUrl === targetUrl);
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
            scanned: playersChecked 
        });

    } catch (err) {
        res.status(500).json({ success: false, error: "Scan timed out." });
    }
});

app.listen(PORT, () => console.log("Potato Sniper V6 Engine Online"));
