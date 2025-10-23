"""
Production-ready WebSocket proxy server for Azure OpenAI Realtime API
- Hides API keys from frontend
- Provides authentication and session management
- Enables rate limiting and usage tracking
- Low-latency audio proxying
"""

import asyncio
import websockets
import json
import os
import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, Set, Optional
from dotenv import load_dotenv
from collections import defaultdict

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Azure OpenAI Configuration (server-side only, never exposed to client)
AZURE_ENDPOINT = os.getenv('AZURE_ENDPOINT', '').rstrip('/')
AZURE_API_KEY = os.getenv('AZURE_API_KEY', '')
AZURE_DEPLOYMENT = os.getenv('AZURE_DEPLOYMENT', 'gpt-realtime')
API_VERSION = os.getenv('API_VERSION', '2024-10-01-preview')

# Server Configuration
SERVER_HOST = '0.0.0.0'
SERVER_PORT = 8001

# Session Management
sessions: Dict[str, dict] = {}  # session_id -> {user_id, created_at, azure_ws, client_ws}
user_connections: Dict[str, Set[str]] = defaultdict(set)  # user_id -> set of session_ids
user_requests: Dict[str, list] = defaultdict(list)  # user_id -> list of timestamps

# Rate Limiting Configuration
MAX_CONNECTIONS_PER_USER = 3
MAX_REQUESTS_PER_MINUTE = 60
RATE_LIMIT_WINDOW = 60  # seconds


def validate_azure_config():
    """Validate Azure configuration on startup"""
    if not AZURE_ENDPOINT or not AZURE_API_KEY or not AZURE_DEPLOYMENT:
        logger.error("Missing Azure configuration. Check .env file.")
        logger.error(f"AZURE_ENDPOINT: {'✓' if AZURE_ENDPOINT else '✗'}")
        logger.error(f"AZURE_API_KEY: {'✓' if AZURE_API_KEY else '✗'}")
        logger.error(f"AZURE_DEPLOYMENT: {'✓' if AZURE_DEPLOYMENT else '✗'}")
        raise ValueError("Azure configuration incomplete")
    logger.info(f"✓ Azure endpoint: {AZURE_ENDPOINT}")
    logger.info(f"✓ Azure deployment: {AZURE_DEPLOYMENT}")


def build_azure_websocket_url():
    """Build Azure WebSocket URL with authentication"""
    # Remove https:// and replace with wss://
    ws_endpoint = AZURE_ENDPOINT.replace('https://', 'wss://')
    # Ensure proper path formatting
    if not ws_endpoint.endswith('/'):
        ws_endpoint += '/'
    
    url = (
        f"{ws_endpoint}openai/realtime"
        f"?api-version={API_VERSION}"
        f"&deployment={AZURE_DEPLOYMENT}"
        f"&api-key={AZURE_API_KEY}"
    )
    return url


def create_session(user_id: str) -> str:
    """Create a new session for a user"""
    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        'user_id': user_id,
        'created_at': datetime.now(),
        'azure_ws': None,
        'client_ws': None,
        'message_count': 0
    }
    user_connections[user_id].add(session_id)
    logger.info(f"✓ Created session {session_id} for user {user_id}")
    return session_id


def cleanup_session(session_id: str):
    """Clean up session data"""
    if session_id in sessions:
        session = sessions[session_id]
        user_id = session['user_id']
        user_connections[user_id].discard(session_id)
        del sessions[session_id]
        logger.info(f"✓ Cleaned up session {session_id}")


def check_rate_limit(user_id: str) -> tuple[bool, str]:
    """Check if user is within rate limits"""
    now = datetime.now()
    
    # Check connection limit
    if len(user_connections[user_id]) >= MAX_CONNECTIONS_PER_USER:
        return False, f"Maximum {MAX_CONNECTIONS_PER_USER} concurrent connections exceeded"
    
    # Check request rate limit
    user_requests[user_id] = [
        ts for ts in user_requests[user_id]
        if (now - ts).total_seconds() < RATE_LIMIT_WINDOW
    ]
    
    if len(user_requests[user_id]) >= MAX_REQUESTS_PER_MINUTE:
        return False, f"Rate limit exceeded: {MAX_REQUESTS_PER_MINUTE} requests per minute"
    
    user_requests[user_id].append(now)
    return True, "OK"


def authenticate_user(headers: dict) -> Optional[str]:
    """
    Authenticate user from WebSocket headers.
    In production, replace this with your actual authentication:
    - JWT token validation
    - OAuth2 bearer tokens
    - API key validation
    - Session cookie validation
    """
    # Example: Extract authorization header
    auth_header = headers.get('Authorization', '')
    
    # For demo purposes, accept any authorization or create anonymous user
    if auth_header.startswith('Bearer '):
        user_id = auth_header.replace('Bearer ', '').strip()
    else:
        # For development: create anonymous user
        user_id = f"anonymous-{uuid.uuid4().hex[:8]}"
    
    logger.info(f"✓ Authenticated user: {user_id}")
    return user_id


async def proxy_client_to_azure(client_ws, azure_ws, session_id: str):
    """Forward messages from client browser to Azure"""
    try:
        async for message in client_ws:
            if isinstance(message, str):
                # JSON messages (configuration, events)
                logger.debug(f"Client → Azure [session {session_id[:8]}]: {message[:100]}...")
                await azure_ws.send(message)
                sessions[session_id]['message_count'] += 1
            elif isinstance(message, bytes):
                # Binary audio data
                logger.debug(f"Client → Azure [session {session_id[:8]}]: {len(message)} bytes audio")
                await azure_ws.send(message)
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Client disconnected [session {session_id[:8]}]")
    except Exception as e:
        logger.error(f"Error proxying client to Azure: {e}")


async def proxy_azure_to_client(azure_ws, client_ws, session_id: str):
    """Forward messages from Azure back to client browser"""
    try:
        async for message in azure_ws:
            if isinstance(message, str):
                # JSON messages (transcripts, events)
                logger.debug(f"Azure → Client [session {session_id[:8]}]: {message[:100]}...")
                await client_ws.send(message)
            elif isinstance(message, bytes):
                # Binary audio data
                logger.debug(f"Azure → Client [session {session_id[:8]}]: {len(message)} bytes audio")
                await client_ws.send(message)
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Azure disconnected [session {session_id[:8]}]")
    except Exception as e:
        logger.error(f"Error proxying Azure to client: {e}")


async def handle_client_connection(websocket, path):
    """Handle incoming WebSocket connection from client browser"""
    session_id = None
    azure_ws = None
    
    try:
        # Authenticate user
        user_id = authenticate_user(websocket.request_headers)
        if not user_id:
            await websocket.close(1008, "Authentication failed")
            return
        
        # Check rate limits
        allowed, reason = check_rate_limit(user_id)
        if not allowed:
            logger.warning(f"Rate limit exceeded for user {user_id}: {reason}")
            await websocket.close(1008, reason)
            return
        
        # Create session
        session_id = create_session(user_id)
        sessions[session_id]['client_ws'] = websocket
        
        logger.info(f"✓ Client connected: user={user_id}, session={session_id[:8]}")
        
        # Connect to Azure OpenAI
        azure_url = build_azure_websocket_url()
        logger.info(f"Connecting to Azure for session {session_id[:8]}...")
        
        async with websockets.connect(
            azure_url,
            extra_headers={
                'User-Agent': 'Realtime-Voice-Bot/1.0'
            },
            max_size=10 * 1024 * 1024,  # 10MB max message size
            ping_interval=20,
            ping_timeout=20
        ) as azure_ws:
            sessions[session_id]['azure_ws'] = azure_ws
            logger.info(f"✓ Connected to Azure for session {session_id[:8]}")
            
            # Start bidirectional proxying
            await asyncio.gather(
                proxy_client_to_azure(websocket, azure_ws, session_id),
                proxy_azure_to_client(azure_ws, websocket, session_id),
                return_exceptions=True
            )
    
    except websockets.exceptions.InvalidStatusCode as e:
        logger.error(f"Azure connection failed: {e.status_code}")
        try:
            await websocket.send(json.dumps({
                'type': 'error',
                'error': f'Failed to connect to Azure: {e.status_code}'
            }))
        except:
            pass
    except Exception as e:
        logger.error(f"Error in client connection: {e}", exc_info=True)
        try:
            await websocket.send(json.dumps({
                'type': 'error',
                'error': str(e)
            }))
        except:
            pass
    finally:
        # Cleanup
        if session_id:
            session = sessions.get(session_id)
            if session:
                logger.info(f"Session {session_id[:8]} stats: {session['message_count']} messages")
            cleanup_session(session_id)
        
        try:
            await websocket.close()
        except:
            pass


async def periodic_cleanup():
    """Periodically clean up stale sessions"""
    while True:
        await asyncio.sleep(300)  # Every 5 minutes
        now = datetime.now()
        stale_sessions = [
            sid for sid, session in sessions.items()
            if (now - session['created_at']).total_seconds() > 3600  # 1 hour
        ]
        for sid in stale_sessions:
            logger.warning(f"Cleaning up stale session {sid[:8]}")
            cleanup_session(sid)


async def main():
    """Start the WebSocket server"""
    validate_azure_config()
    
    logger.info("=" * 60)
    logger.info("🚀 Starting Production WebSocket Proxy Server")
    logger.info("=" * 60)
    logger.info(f"Server: ws://{SERVER_HOST}:{SERVER_PORT}")
    logger.info(f"Azure: {AZURE_ENDPOINT}")
    logger.info(f"Deployment: {AZURE_DEPLOYMENT}")
    logger.info(f"Rate Limit: {MAX_REQUESTS_PER_MINUTE} req/min, {MAX_CONNECTIONS_PER_USER} concurrent")
    logger.info("=" * 60)
    
    # Start cleanup task
    cleanup_task = asyncio.create_task(periodic_cleanup())
    
    # Start WebSocket server
    async with websockets.serve(
        handle_client_connection,
        SERVER_HOST,
        SERVER_PORT,
        max_size=10 * 1024 * 1024,  # 10MB max message size
        ping_interval=20,
        ping_timeout=20
    ):
        logger.info("✓ Server ready for connections")
        await asyncio.Future()  # Run forever


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n👋 Server shutting down...")
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
