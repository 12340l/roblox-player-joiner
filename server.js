const express = require('express');
const axios = require('axios');
const noblox = require('noblox.js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

app.get('/find-player', async (req, res) => {
    const startTime = Date.now();
    const { username, placeId } = req.query;
    const targetPlaceId = parseInt(placeId);

    try {
        const userId = await noblox.getIdFromUsername(username);
        
        // Get Target's Headshot for verification
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
        const targetUrl = thumbRes.data.data[0].imageUrl;

        // --- PHASE 1: SMART FRIEND BEACON ---
        console.log("Phase 1: Analyzing friends...");
        const friendsRes = await axios.get(`https://friends.roblox.com/v1/users/${userId}/friends`);
        const friendIds = friendsRes.data.data.map(f => f.id);

        if (friendIds.length > 0) {
            const presenceRes = await axios.post('https://presence.roblox.com/v1/presence/users', { userIds: friendIds });
            const activeBeacons = presenceRes.data.userPresences.filter(p => p.placeId === targetPlaceId && p.gameId);
            
            for (const beacon of activeBeacons) {
                console.log(`Checking if target is actually with friend: ${beacon.lastUserName}`);
                
                // Fetch the specific server the friend is in
                const serverDetails = await axios.get(`https://games.roblox.com/v1/games/${targetPlaceId}/servers/Public?limit=100`);
                const specificServer = serverDetails.data.data.find(s => s.id === beacon.gameId);

                if (specificServer) {
                    // Check players in that friend's server for our target
                    const batchPayload = specificServer.playerTokens.map(token => ({
                        token, type: "AvatarHeadShot", size: "150x150", format: "Png"
                    }));
                    
                    const batchRes = await axios.post('https://thumbnails.roblox.com/v1/batch', batchPayload);
                    const isTargetPresent = batchRes.data.data.find(img => img.imageUrl === targetUrl);

                    if (isTargetPresent) {
                        console.log("Target confirmed in friend's server!");
                        return res.json({ success: true, jobId: beacon.gameId, method: "Verified Friend Beacon" });
                    }
                }
            }
        }

        // --- PHASE 2: THUMBNAIL SCAN (1000 SERVERS) ---
        console.log("Phase 2: Target not with friends. Starting full scan...");
        let cursor = "";
        let totalServersScanned = 0;

        for (let i = 0; i < 10; i++) {
            if (Date.now() - startTime > 26000) {
                return res.json({ success: false, message: "Timed out", totalServers: totalServersScanned });
            }

            const serverRes = await axios.get(`https://games.roblox.com/v1/games/${targetPlaceId}/servers/Public?limit=100&cursor=${cursor}`);
            const servers = serverRes.data.data;
            if (!servers || servers.length === 0) break;

            let tokenMap = [];
            servers.forEach(srv => srv.playerTokens.forEach(t => tokenMap.push({ token: t, jobId: srv.id })));

            for (let j = 0; j < tokenMap.length; j += 100) {
                const chunk = tokenMap.slice(j, j + 100);
                const payload = chunk.map(t => ({ token: t.token, type: "AvatarHeadShot", size: "150x150", format: "Png" }));
                const batchRes = await axios.post('https://thumbnails.roblox.com/v1/batch', payload);
                const foundIndex = batchRes.data.data.findIndex(img => img.imageUrl === targetUrl);
                
                if (foundIndex !== -1) {
                    return res.json({ success: true, jobId: chunk[foundIndex].jobId, totalServers: totalServersScanned + servers.length });
                }
            }

            totalServersScanned += servers.length;
            if (!serverRes.data.nextPageCursor) break;
            cursor = serverRes.data.nextPageCursor;
        }

        res.json({ success: false, message: "Not found", totalServers: totalServersScanned });

    } catch (err) {
        res.status(500).json({ success: false, error: "API Error" });
    }
});

app.listen(PORT, () => console.log(`Smart Hybrid Joiner Online`));
