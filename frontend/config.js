// Backend Server Configuration (Production-ready)
// NO API KEYS HERE - they stay on the server!
window.SERVER_CONFIG = {
    // Connect to our secure backend server instead of Azure directly
    websocketUrl: 'ws://localhost:8001',
    
    // Optional: Add your authentication token here
    // In production, get this from your login system
    authToken: null  // Will use anonymous mode if null
};
