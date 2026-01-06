const express = require('express');
const axios = require('axios');
const noblox = require('noblox.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/find-player', async (req, res) => {
    const { username, placeId } = req.query;

    if (!username || !placeId) {
        return res.status(400).json({ success: false, message: "Missing username or placeId" });
    }

    try {
        console.log(`--- New Search: ${username} in Game ${placeId} ---`);

        // 1. Get the Target's UserId and their unique Headshot Thumbnail
        const userId = await noblox.getIdFromUsername(username);
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
        
        if (!thumbRes.data.data || thumbRes.data.data.length === 0) {
            return res.json({ success: false, message: "Could not find user thumbnail." });
        }
        
        const targetThumbnail = thumbRes.data.data[0].imageUrl;

        // 2. Setup Scanning Variables
        let foundJobId = null;
        let cursor = "";
        let pagesChecked = 0;
        const maxPages = 8; // Scans up to 800 servers. Increasing this too high will cause Render to time out.

        // 3. Start the Pagination Loop
        while (pagesChecked < maxPages) {
            console.log(`Scanning page ${pagesChecked + 1}...`);
            
            const serverUrl = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&cursor=${cursor}`;
            const serverRes = await axios.get(serverUrl);
            const servers = serverRes.data.data;

            for (const server of servers) {
                // Skip servers that are full (so you don't get stuck in a queue)
                if (server.playing >= server.maxPlayers) continue;

                const tokens = server.playerTokens;

                // Request thumbnails for all players in this server batch
                const batchPayload = tokens.map(token => ({
                    token: token,
                    type: "AvatarHeadShot",
                    size: "150x150",
                    format: "Png",
                    isCircular: false
                }));

                const batchRes = await axios.post('https://thumbnails.roblox.com/v1/batch', batchPayload);
                
                // Compare every player in the server to our target's thumbnail
                const match = batchRes.data.data.find(t => t.imageUrl === targetThumbnail);
                
                if (match) {
                    foundJobId = server.id;
                    break;
                }
            }

            if (foundJobId) break; // Stop looking if we found them!
            
            cursor = serverRes.data.nextPageCursor;
            if (!cursor) break; // Stop if there are no more servers
            
            pagesChecked++;
        }

        if (foundJobId) {
            console.log(`Success! Found ${username} in server: ${foundJobId}`);
            res.json({ success: true, jobId: foundJobId });
        } else {
            console.log(`Finished scan: ${username} not found.`);
            res.json({ 
                success: false, 
                message: "User not found. They may be in a private server, a different game, or their joins are hidden." 
            });
        }

    } catch (err) {
        console.error("Error during scan:", err.message);
        res.status(500).json({ success: false, error: "The Roblox API is rate-limiting the scanner. Please wait a minute." });
    }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Joiner Backend Live on Port ${PORT}`);
});
