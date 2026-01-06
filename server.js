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
        console.log(`Searching for ${username} in Place ${placeId}...`);

        // 1. Get the Target's UserId and Thumbnail
        const userId = await noblox.getIdFromUsername(username);
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
        const targetThumbnail = thumbRes.data.data[0].imageUrl;

        // 2. Fetch the first page of Public Servers (top 100)
        const serverRes = await axios.get(`https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100`);
        const servers = serverRes.data.data;

        let foundJobId = null;

        // 3. Scan each server in the list
        for (const server of servers) {
            const tokens = server.playerTokens;

            // Request thumbnails for all players in this specific server batch
            const batchPayload = tokens.map(token => ({
                token: token,
                type: "AvatarHeadShot",
                size: "150x150",
                format: "Png",
                isCircular: false
            }));

            const batchRes = await axios.post('https://thumbnails.roblox.com/v1/batch', batchPayload);
            
            // Look for a match
            const match = batchRes.data.data.find(t => t.imageUrl === targetThumbnail);
            
            if (match) {
                foundJobId = server.id;
                console.log(`Found ${username} in server: ${foundJobId}`);
                break;
            }
        }

        if (foundJobId) {
            res.json({ success: true, jobId: foundJobId });
        } else {
            res.json({ success: false, message: "User not found in top 100 servers. They might be in a private server or a different game." });
        }

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, error: "Server error or user does not exist." });
    }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Joiner Backend running on port ${PORT}`);
});
