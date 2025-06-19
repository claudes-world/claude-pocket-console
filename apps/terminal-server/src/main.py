"""
Main FastAPI application module.

This module initializes the FastAPI app and configures:
- API routes for session management
- WebSocket endpoints for terminal I/O
- Middleware and exception handlers
- Application lifecycle events
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Create FastAPI app instance
app = FastAPI(
    title="Claude Pocket Console Terminal Server",
    version="0.1.0",
    description="WebSocket-based terminal server for Docker container sessions",
)

# TODO: Configure CORS middleware
# TODO: Add exception handlers
# TODO: Add startup/shutdown event handlers
# TODO: Import and include routers from other modules