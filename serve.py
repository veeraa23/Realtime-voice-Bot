#!/usr/bin/env python3
"""
Simple HTTP server for serving the voice bot frontend
"""

import http.server
import socketserver
import webbrowser
import os
from pathlib import Path

def main():
    # Change to frontend directory
    frontend_dir = Path(__file__).parent / 'frontend'
    os.chdir(frontend_dir)
    
    PORT = 8000
    
    class CustomHandler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            # Add CORS headers
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', '*')
            # Required for audio worklets
            self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            super().end_headers()
    
    try:
        with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
            print(f"🌐 Voice Bot Frontend Server")
            print(f"📡 Server running at http://localhost:{PORT}")
            print(f"📁 Serving files from: {frontend_dir}")
            print(f"🔗 Opening browser...")
            print(f"📝 Press Ctrl+C to stop\n")
            
            # Open browser
            webbrowser.open(f'http://localhost:{PORT}')
            
            print("🎤 Ready!")
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n👋 Server stopped.")
    except OSError as e:
        if 'address already in use' in str(e).lower():
            print(f"\n❌ Port {PORT} is already in use.")
            print(f"💡 Try stopping other servers or use a different port.")
        else:
            raise

if __name__ == "__main__":
    main()
