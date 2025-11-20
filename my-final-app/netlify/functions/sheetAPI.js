const { google } = require('googleapis');

// --- CONFIGURATION ---
// Ensure this is your correct Google Sheet ID.
const SHEET_ID = '1ELPLV4how9HabYL2YbGYHPedT4qK0meeSHDgq9-65Us'; 

// Authenticates with Google Sheets API using your service account credentials.
async function getAuth() {
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        // These credentials must be stored securely as Environment Variables in Netlify.
        // The code reads them from Netlify's system, not from this file.
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
    });
    return await auth.getClient();
}

// This is the main "entry point" for all requests from your frontend.
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { action, params } = JSON.parse(event.body);
        const auth = await getAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        let responseData;

        // A router to call the correct function based on the 'action'.
        switch (action) {
            case 'getCommentOptions':
                responseData = await getCommentOptions(sheets);
                break;
            case 'submitTask':
                responseData = await submitTask(sheets, params.taskData);
                break;
            case 'getRecentEntries':
                responseData = await getRecentEntries(sheets, params.videoLink);
                break;
            case 'getTaskStats':
                responseData = await getTaskStats(sheets, params.userEmail);
                break;
            case 'getRealUsersScoreboard':
                responseData = await getRealUsersScoreboard(sheets);
                break;
            default:
                throw new Error(`Unknown action: ${action}`);
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseData),
        };
    } catch (error) {
        console.error('Error in Netlify function:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, message: error.message }),
        };
    }
};

// --- HELPER FUNCTIONS (Your original Apps Script code, converted to work here) ---

function extractVideoId(url) {
    if (!url) return null;
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    return (url.match(regex) || [])[1] || null;
}

function getCSTDateString() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); // Format: yyyy-MM-dd
}

async function getCommentOptions(sheets) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Comments!A2:A' });
    const values = response.data.values || [];
    return values.flat().filter(v => v && v.toString().trim() !== '');
}

async function submitTask(sheets, taskData) {
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Main!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [[
                `uuid-${Date.now()}`, getCSTDateString(), taskData.ytVideoLink.trim(),
                taskData.userEmail, taskData.comments || '', taskData.screenshot || '',
                taskData.startTime || '', taskData.endTime || '', taskData.duration || '00:00:00',
                taskData.brandName.trim()
            ]],
        },
    });
    return { success: true };
}

async function getRecentEntries(sheets, videoLink) {
    const inputVideoId = extractVideoId(videoLink);
    if (!inputVideoId) return [];

    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Main!B:J' });
    const values = response.data.values || [];
    const matches = [];

    for (let i = values.length - 1; i >= 0; i--) {
        if (matches.length >= 5) break;
        const row = values[i];
        const storedUrl = row[1] || ''; // YT Link is in Column C (index 1 of range B:J)
        if (extractVideoId(storedUrl) === inputVideoId) {
            matches.push({
                date: row[0] ? new Date(row[0]).toLocaleDateString() : 'N/A',
                ldap: row[2] || 'N/A',
                comments: row[3] || 'None',
                brandName: row[8] || 'N/A'
            });
        }
    }
    return matches;
}

async function getTaskStats(sheets, userEmail) {
    if (!userEmail) return { userTasks: 0 };
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Main!B2:D' });
    const values = response.data.values || [];
    const today = getCSTDateString();
    let userTasks = values.filter(row => {
        const dateVal = row[0] ? new Date(row[0]).toLocaleDateCSTDateString('en-CA', { timeZone: 'America/Chicago' }) : '';
        const emailVal = (row[2] || '').toLowerCase();
        return dateVal === today && emailVal === userEmail.toLowerCase();
    }).length;
    return { userTasks };
}

async function getRealUsersScoreboard(sheets) {
    const [userResponse, taskResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Users!B2:C' }),
        sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Main!B2:D' })
    ]);
    
    const users = userResponse.data.values || [];
    const tasks = taskResponse.data.values || [];
    const scoreboard = new Map();

    users.forEach(([name, email]) => {
        if (email) {
            scoreboard.set(email.toLowerCase(), {
                email, name, tasksToday: 0, lastActive: null
            });
        }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    tasks.forEach(([timestamp, _, email]) => {
        const taskTimestamp = new Date(timestamp);
        const userEmail = (email || '').toLowerCase();
        if (taskTimestamp >= today && scoreboard.has(userEmail)) {
            let userData = scoreboard.get(userEmail);
            userData.tasksToday++;
            if (!userData.lastActive || taskTimestamp > userData.lastActive) {
                userData.lastActive = taskTimestamp;
            }
        }
    });

    return Array.from(scoreboard.values()).map(userData => ({
        ...userData,
        lastActive: userData.lastActive ? userData.lastActive.toISOString() : null
    }));
}