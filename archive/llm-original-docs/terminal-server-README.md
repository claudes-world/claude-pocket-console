# **Terminal Server (apps/terminal-server)**

>Author: Gemini 2.5

This application is a high-performance Python service built with FastAPI. Its primary role is to act as a secure gateway for creating and interacting with isolated terminal sessions running inside hardened Docker containers.

## **Core Responsibilities**

* **Session Management:** Exposes REST endpoints to create and destroy secure container sessions.  
* **Real-time I/O Streaming:** Provides a WebSocket endpoint to stream stdin, stdout, and stderr between the client's terminal UI and the container's shell process.  
* **Security Enforcement:** Ensures that every container is launched with strict, non-permissive security settings (e.g., no network access, read-only filesystem, resource limits).

## **API Endpoints**

The service exposes the following endpoints:

| Method | Path | Description |
| :---- | :---- | :---- |
| POST | /session | Creates a new sandboxed Docker container session. |
| DELETE | /session/{id} | Gracefully stops and removes the specified container session. |
| WS | /session/{id} | Establishes a WebSocket for real-time I/O streaming. |

## **Local Development**

### **Prerequisites**

* **Python 3.12**  
* **uv** package manager  
* A running **Docker daemon**

### **Setup & Running**

1. **Navigate to the service directory:**  
   cd apps/terminal-server

2. Create a virtual environment:  
   This command creates a .venv folder in the current directory.  
   uv venv

3. Install dependencies:  
   This syncs the dependencies listed in pyproject.toml (and requirements.lock).  
   uv pip sync requirements.txt

4. Run the development server:  
   This starts the FastAPI server with hot-reloading enabled.  
   uv run uvicorn src.main:app \--reload \--host 0.0.0.0 \--port 8000

The server will be available at http://localhost:8000.

## **Testing**

To run the test suite for this service, navigate to the service directory and use the following command:

cd apps/terminal-server  
uv run pytest  
