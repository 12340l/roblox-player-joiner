const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Helper to extract the unique Hash from a Roblox CDN URL
const extractHash = (url) => {
    const match = url.match(/rbxcdn\.com\/([a-f0-9]+)/);
    return match ? match[1] : null;
};

app.get('/find-player', async (req, res) => {
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ success: false, error: "Missing username" });
    }

    try {
        // 1. Get UserId from Username
        const userLookup = await axios.post('https://users.roblox.com/v1/usernames/users', {
            usernames: [username],
            excludeBannedUsers: false
        });

        if (!userLookup.data.data.length) {
            return res.json({ success: false, error: "User not found" });
        }

        const userId = userLookup.data.data[0].id;

        // 2. Get the Avatar Headshot Thumbnail
        // We use 48x48 because it matches the size Roblox uses in the server list API
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=48x48&format=Png&isCircular=false`);
        
        if (!thumbRes.data.data.length) {
            return res.json({ success: false, error: "Thumbnail error" });
        }

        const imageUrl = thumbRes.data.data[0].imageUrl;
        const targetHash = extractHash(imageUrl);

        // 3. Return the "Fingerprint" to your Roblox Script
        console.log(`Target: ${username} | ID: ${userId} | Hash: ${targetHash}`);
        
        res.json({
            success: true,
            username: username,
            userId: userId,
            targetHash: targetHash
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Roblox API Connection Failed" });
    }
});

app.listen(PORT, () => {
    console.log(`V13 Engine running on port ${PORT}`);
});
