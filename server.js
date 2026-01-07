const express = require('express');
const axios = require('axios');
const noblox = require('noblox.js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

app.get('/find-player', async (req, res) => {
    const startTime = Date.now(); // Start the clock
    const { username, placeId } = req.query;
    const targetPlaceId = parseInt(placeId);

    try {
        const userId = await noblox.getIdFromUsername(username);
        
        // 1. Get Target Thumbnail
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
        const targetUrl = thumbRes.data.data[0].imageUrl;

        let cursor = "";
        let totalServersScanned = 0;

        // Scan up to 10 pages (1000 servers)
        for (let i = 0; i < 10; i++) {
            // TIMEOUT PROTECTION: If we've been scanning for 26 seconds, stop and return "Not Found" 
            // to prevent Render from killing the request.
            if (Date.now() - startTime > 26000) {
                return res.json({ 
                    success: false, 
                    message: "Search timed out. Scanned 1000 servers but found nothing.", 
                    totalServers: totalServersScanned 
                });
            }

            const serverRes = await axios.get(`https://games.roblox.com/v1/games/${targetPlaceId}/servers/Public?limit=100&cursor=${cursor}`);
            const servers = serverRes.data.data;
            if (!servers || servers.length === 0) break;

            // Map tokens to JobIds
            let tokenMap = [];
            servers.forEach(srv => {
                srv.playerTokens.forEach(token => {
                    tokenMap.push({ token, jobId: srv.id });
                });
            });

            // Batch check (100 at a time)
            for (let j = 0; j < tokenMap.length; j += 100) {
                const chunk = tokenMap.slice(j, j + 100);
                const payload = chunk.map(t => ({
                    token: t.token,
                    type: "AvatarHeadShot",
                    size: "150x150",
                    format: "Png"
                }));

                const batchRes = await axios.post('https://thumbnails.roblox.com/v1/batch', payload);
                const foundIndex = batchRes.data.data.findIndex(img => img.imageUrl === targetUrl);
                
                if (foundIndex !== -1) {
                    return res.json({ 
                        success: true, 
                        jobId: chunk[foundIndex].jobId, 
                        totalServers: totalServersScanned + (j/srv_count_estimate || 0) 
                    });
                }
            }

            totalServersScanned += servers.length;
            if (!serverRes.data.nextPageCursor) break;
            cursor = serverRes.data.nextPageCursor;
        }

        res.json({ success: false, message: "End of list reached.", totalServers: totalServersScanned });

    } catch (err) {
        res.status(500).json({ success: false, error: "Target likely has joins off or API is slow." });
    }
});

app.listen(PORT, () => console.log(`1000-Server Scanner Online`));
