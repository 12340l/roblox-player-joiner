const express = require('express');
const axios = require('axios');
const noblox = require('noblox.js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Function to scan a batch of tokens for a specific target URL
async function checkServers(tokens, targetUrl, isCircular) {
    const batchPayload = tokens.map(token => ({
        token: token,
        type: "AvatarHeadShot",
        size: "150x150",
        format: "Png",
        isCircular: isCircular
    }));

    try {
        const batchRes = await axios.post('https://thumbnails.roblox.com/v1/batch', batchPayload);
        const match = batchRes.data.data.find(t => t.imageUrl === targetUrl);
        return match ? true : false;
    } catch (e) {
        console.error("Batch error:", e.message);
        return false;
    }
}

app.get('/find-player', async (req, res) => {
    const { username, placeId } = req.query;

    if (!username || !placeId) {
        return res.status(400).json({ success: false, message: "Missing username or placeId" });
    }

    try {
        console.log(`--- Searching: ${username} in ${placeId} ---`);

        // 1. Get User ID
        const userId = await noblox.getIdFromUsername(username);

        // 2. Get BOTH Square and Circular Thumbnails for the target
        const [squareRes, circleRes] = await Promise.all([
            axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`),
            axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`)
        ]);

        const squareUrl = squareRes.data.data[0].imageUrl;
        const circleUrl = circleRes.data.data[0].imageUrl;

        let cursor = "";
        let foundJobId = null;
        let pagesChecked = 0;
        const maxPages = 6; // Keep this low to avoid Render timeouts

        // 3. Start Scanning
        while (pagesChecked < maxPages) {
            console.log(`Scanning Page ${pagesChecked + 1}...`);
            const serverRes = await axios.get(`https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&cursor=${cursor}`);
            const servers = serverRes.data.data;

            if (!servers || servers.length === 0) break;

            for (const server of servers) {
                if (server.playing >= server.maxPlayers) continue; // Skip full servers

                const tokens = server.playerTokens;
                
                // Check against Square Thumbnails
                let isMatch = await checkServers(tokens, squareUrl, false);
                
                // If no square match, check against Circular (Roblox sometimes switches)
                if (!isMatch) {
                    isMatch = await checkServers(tokens, circleUrl, true);
                }

                if (isMatch) {
                    foundJobId = server.id;
                    break;
                }
            }

            if (foundJobId || !serverRes.data.nextPageCursor) break;
            cursor = serverRes.data.nextPageCursor;
            pagesChecked++;
        }

        if (foundJobId) {
            console.log(`FOUND: ${username} in Job ${foundJobId}`);
            res.json({ success: true, jobId: foundJobId });
        } else {
            console.log("Status: User not found in scanned pages.");
            res.json({ success: false, message: "User not found. They may be offline or have joins disabled." });
        }

    } catch (err) {
        console.error("Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
